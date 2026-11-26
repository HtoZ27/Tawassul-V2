#!/usr/bin/env bash
# boot-scorecard-v2 — N1..N5 verdicts for one v2 boot window (M3.1 protocol).
#
# Reads the two real log streams (no probing, no state writes):
#   ${TAWASSUL_LOG_FILE:-<v2-data-root>/tawassul/tawassul.log} → N3, N4
#   $XDG_DATA_HOME/opencode/log/opencode.log                   → N1, N5
# <v2-data-root> is $XDG_DATA_HOME (single-nested when already tawassul-v2),
# matching src/utils/state-paths.ts so the launcher, the plugin sink, and this
# scorecard read one file.
# A window with no parseable lines is INCOMPLETE, never a vacuous PASS.
# N2 (time to first LLM stream) is a click-run observation: pass --n2 <seconds>
# to fold a recorded measurement in, or --n2 auto to read the plugin's
# n2-auto.jsonl. Auto N2 requires an explicit --since <boot-t0> and discards
# records that predate the assistant-role gate (no role_gate marker).
# N5 is N/A when the host log shows no project-copy refresh support at all
# (OpenCode 2.2.0 retired the v1 watcher metric); the watcher gate is then the
# launcher line plus N1. A host that logs the signal but has no pair in-window
# stays INCOMPLETE.
#
# Usage: boot-scorecard-v2.sh [--since ISO|@epoch_ms] [--until ISO|@epoch_ms] [--hours N]
#                             [--host-pids PID[,PID...]] [--n2 seconds|auto]
#                             [--case N] [--append FILE] [--json]
# Exit: 0 all measured pass · 1 any measured FAIL · 2 INCOMPLETE (N2 skipped or
# any criterion lacking in-window evidence) · 64 usage · 69 python3 missing.
set -u

usage() {
  echo "usage: boot-scorecard-v2.sh [--since ISO|@epoch_ms] [--until ISO|@epoch_ms] [--hours N] [--host-pids PID[,PID...]] [--n2 seconds|auto] [--case N] [--append FILE] [--json]" >&2
}

SINCE=""; SINCE_EXPLICIT=0; UNTIL=""; HOURS=24; HOSTPIDS=""; N2=""; CASE=""; APPEND=""; JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --since)  [ $# -ge 2 ] || { usage; exit 64; }; SINCE="$2"; SINCE_EXPLICIT=1; shift 2 ;;
    --until)  [ $# -ge 2 ] || { usage; exit 64; }; UNTIL="$2"; shift 2 ;;
    --hours)  [ $# -ge 2 ] || { usage; exit 64; }; HOURS="$2"; shift 2 ;;
    --host-pids) [ $# -ge 2 ] || { usage; exit 64; }; HOSTPIDS="$2"; shift 2 ;;
    --n2)     [ $# -ge 2 ] || { usage; exit 64; }; N2="$2"; shift 2 ;;
    --case)   [ $# -ge 2 ] || { usage; exit 64; }; CASE="$2"; shift 2 ;;
    --append) [ $# -ge 2 ] || { usage; exit 64; }; APPEND="$2"; shift 2 ;;
    --json)   JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
case "$DATA" in
  /*) ;;
  *) echo "boot-scorecard-v2: XDG_DATA_HOME relative — refusing (fail-closed)." >&2; exit 64 ;;
esac
ROOT="$DATA"
[ "$(basename "$ROOT")" = "tawassul-v2" ] || ROOT="$ROOT/tawassul-v2"
if [ "${TAWASSUL_LOG_FILE+x}" = "x" ]; then TLOG="$TAWASSUL_LOG_FILE"; else TLOG="$ROOT/tawassul/tawassul.log"; fi
OLOG="$DATA/opencode/log/opencode.log"
N2LOG="${TAWASSUL_N2_LOG:-$ROOT/n2-auto.jsonl}"

command -v python3 >/dev/null 2>&1 || { echo "boot-scorecard-v2: python3 required." >&2; exit 69; }

python3 - "$SINCE" "$HOURS" "$N2" "$APPEND" "$JSON" "$TLOG" "$OLOG" "$CASE" "$SINCE_EXPLICIT" "$N2LOG" "$UNTIL" "$HOSTPIDS" <<'PY'
import datetime
import json as jsonlib
import math
import re
import sys

since_arg, hours_arg, n2_arg, append_path, json_raw, tlog, olog, case_arg, since_explicit, n2log, until_arg, hostpids_arg = sys.argv[1:13]
json_out = json_raw == "1"


def resolve_since():
    if since_arg:
        s = since_arg
        if s.startswith("@"):
            try:
                return float(s[1:]) / 1000.0
            except ValueError:
                s = s[1:]
        try:
            return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
        except ValueError:
            sys.stderr.write(f"boot-scorecard-v2: bad --since {since_arg!r}\n")
            sys.exit(64)
    try:
        h = float(hours_arg)
    except ValueError:
        h = 24.0
    return datetime.datetime.now(datetime.timezone.utc).timestamp() - h * 3600.0


SINCE = resolve_since()


def resolve_until():
    if not until_arg:
        return None
    s = until_arg
    if s.startswith("@"):
        try:
            return float(s[1:]) / 1000.0
        except ValueError:
            s = s[1:]
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        sys.stderr.write(f"boot-scorecard-v2: bad --until {until_arg!r}\n")
        sys.exit(64)


UNTIL = resolve_until()
HOST_PIDS = set()
for part in hostpids_arg.split(","):
    part = part.strip()
    if part.isdigit():
        HOST_PIDS.add(int(part))


def iso_to_epoch(t):
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            dt = datetime.datetime.strptime(t, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt.timestamp()
        except ValueError:
            pass
    try:
        return datetime.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def tail_text(path, limit=8 * 1024 * 1024):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - limit))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return None


TS_JSON = re.compile(r'"ts":"(\S+?)"')
TS_TEXT = re.compile(r"^(\d{4}-\d{2}-\d{2}T\S+?) ")


def line_ts(line):
    m = TS_JSON.search(line)
    if m:
        return iso_to_epoch(m.group(1))
    m = TS_TEXT.match(line)
    if m:
        return iso_to_epoch(m.group(1))
    return None


STATE_FAILURE = "State validation failed"


def is_state_failure(line):
    if STATE_FAILURE not in line:
        return False
    body = re.sub(r"^\d{4}-\d{2}-\d{2}T\S+\s+", "", line)
    if body.startswith("{"):
        try:
            rec = jsonlib.loads(body)
        except ValueError:
            return False
        level = str(rec.get("level", "")).lower()
        msg = str(rec.get("msg", ""))
        return level in ("warn", "error") and msg.startswith(STATE_FAILURE)
    if not body.startswith("[tawassul] "):
        return False
    body = body[len("[tawassul] ") :]
    if body.startswith("[bash]") or "pattern=" in body:
        return False
    return body.startswith(STATE_FAILURE)


init_main, init_alt, init_sync, n4 = [], [], [], 0
t_seen = 0
blob = tail_text(tlog)
if blob is not None:
    for line in blob.splitlines():
        ts = line_ts(line)
        if ts is None or ts < SINCE:
            continue
        if UNTIL is not None and ts > UNTIL:
            continue
        t_seen += 1
        mm = re.search(r"initPlugin=([\d.]+)ms", line)
        if mm:
            init_main.append(float(mm.group(1)))
        ma = re.search(r"initPromise\(\) total[=: ]+([\d.]+)ms", line)
        if ma:
            init_alt.append(float(ma.group(1)))
        ms = re.search(r"v2 init sync gen=\d+ pid=(\d+) ms=([\d.]+)", line)
        if ms:
            init_sync.append((int(ms.group(1)), float(ms.group(2))))
        if is_state_failure(line):
            n4 += 1
if HOST_PIDS:
    init = [value for pid, value in init_sync if pid in HOST_PIDS]
    population = "host-only pids=" + ",".join(str(pid) for pid in sorted(HOST_PIDS))
elif init_main:
    init = init_main
    population = "all processes (legacy initPlugin lines)"
else:
    init = [value for _pid, value in init_sync] or init_alt
    population = "all processes (v2 init sync lines)"

sub_errors = 0
starts = {}
durations = []
o_seen = 0
host_has_refresh = False
blob = tail_text(olog)
if blob is not None:
    host_has_refresh = "project copy refresh" in blob
    for line in blob.splitlines():
        m = re.search(r"timestamp=(\S+)", line)
        if not m:
            continue
        ts = iso_to_epoch(m.group(1))
        if ts is None or ts < SINCE:
            continue
        if UNTIL is not None and ts > UNTIL:
            continue
        o_seen += 1
        if re.match(r"^\s*timestamp=\S+\s+level=ERROR(?:\s|$)", line) and re.search(
            r'message="?failed to subscribe', line
        ):
            sub_errors += 1
        if "project copy refresh started" in line:
            p = re.search(r"projectID=(\S+)", line)
            if p:
                starts[p.group(1)] = ts
        elif "project copy refresh done" in line:
            p = re.search(r"projectID=(\S+)", line)
            if p and p.group(1) in starts:
                durations.append(ts - starts.pop(p.group(1)))
durations = [d for d in durations if d >= 0]

n2 = None
n2_note = None
pre_gate = 0


def resolve_n2_auto():
    global pre_gate
    try:
        with open(n2log, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = jsonlib.loads(line)
                except ValueError:
                    continue
                if rec.get("role_gate") is not True:
                    pre_gate += 1
                    continue
                ts = rec.get("ts_ms")
                ps = rec.get("process_start_ms")
                if not isinstance(ts, (int, float)) or not isinstance(ps, (int, float)):
                    continue
                if ts < SINCE * 1000.0:
                    continue
                if ps < SINCE * 1000.0 - 5000:
                    continue
                if not isinstance(rec.get("len"), (int, float)) or rec.get("len", 0) <= 0:
                    continue
                return (ts - SINCE * 1000.0) / 1000.0, (
                    f"auto: first visible part at +{(ts - SINCE * 1000.0) / 1000.0:.1f}s "
                    f"(session {rec.get('session_id')}, {int(rec.get('len', 0))} chars, role_gate)"
                )
    except OSError as e:
        return None, f"no n2-auto log readable at {n2log} ({e})"
    if pre_gate:
        return None, f"no post-gate n2-auto record within the window ({pre_gate} pre-gate record(s) discarded; checked {n2log})"
    return None, f"no n2-auto record within the window (checked {n2log})"


if n2_arg == "auto":
    if since_explicit != "1":
        n2, n2_note = None, "auto N2 needs an explicit --since <boot-t0>; a --hours window cannot identify one boot"
    else:
        n2, n2_note = resolve_n2_auto()
elif n2_arg:
    try:
        n2 = float(n2_arg)
    except ValueError:
        sys.stderr.write(f"boot-scorecard-v2: bad --n2 {n2_arg!r} (use seconds or 'auto')\n")
        sys.exit(64)

results = []
overall_fail = False
incomplete = False


def add(nid, state, data, text):
    global overall_fail, incomplete
    if state == "FAIL":
        overall_fail = True
    if state == "INCOMPLETE":
        incomplete = True
    results.append({"id": nid, "state": state, "value": data, "text": text})


add("N1", "INCOMPLETE" if o_seen == 0 else ("PASS" if sub_errors == 0 else "FAIL"), sub_errors,
    f"subscribe errors (level=ERROR) in window: {sub_errors} (target 0)"
    if o_seen else "no parseable opencode.log lines in window (missing/stale file?)")
if n2 is None:
    add("N2", "INCOMPLETE", None, n2_note or "first LLM stream — record manually, then pass --n2 <seconds> (or --n2 auto with --since)")
else:
    add("N2", "INFO", n2, f"first stream: {n2:.1f}s (report only; model-dominated, no target)" + (f" — {n2_note}" if n2_note else ""))
if t_seen == 0:
    add("N3", "INCOMPLETE", None, "no parseable tawassul.log lines in window (missing/stale file?)")
    add("N4", "INCOMPLETE", None, "same window blindness — zero failures cannot be asserted")
elif not init:
    add("N3", "INCOMPLETE", None, f"no init samples for {population} in window (one info line per init expected)")
    add("N4", "PASS" if n4 == 0 else "FAIL", n4, f'"State validation failed": {n4} (target 0)')
else:
    srt = sorted(init)
    p95 = srt[max(0, math.ceil(0.95 * len(srt)) - 1)]
    add("N3", "PASS" if p95 <= 2000 else "FAIL", round(p95, 1),
        f"init p95: {p95:.0f}ms (n={len(init)}, max={max(init):.0f}ms; population={population}; target <=2000ms)")
    add("N4", "PASS" if n4 == 0 else "FAIL", n4, f'"State validation failed": {n4} (target 0)')
if not durations:
    if o_seen > 0 and not host_has_refresh:
        add("N5", "N/A", None, "host 2.2.0 emits no project-copy refresh lines (v1 watcher metric retired; watcher gate = launcher line + N1)")
    else:
        add("N5", "INCOMPLETE", None, "no project-copy refresh pairs in window")
else:
    mean = sum(durations) / len(durations)
    add("N5", "PASS" if mean <= 5 else "FAIL", round(mean, 2),
        f"refresh mean: {mean:.1f}s (n={len(durations)}, target <=5s)")

overall = "FAIL" if overall_fail else ("INCOMPLETE" if incomplete else "PASS")
since_iso = datetime.datetime.fromtimestamp(SINCE, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

if json_out:
    doc = {"since": since_iso, "overall": overall, "criteria": results}
    if case_arg:
        doc["case"] = case_arg
    print(jsonlib.dumps(doc))
else:
    print(f"== boot-scorecard-v2 == window since {since_iso}")
    for r in results:
        print(f"{r['id']} {r['state']:<10} {r['text']}")
    print(f"overall: {overall}")

if append_path:
    row = " | ".join([since_iso] + [f"{r['id']}={r['state']}" for r in results] + [f"overall={overall}"])
    if case_arg:
        row += f" | case={case_arg}"
    try:
        with open(append_path, "a", encoding="utf-8") as f:
            f.write(row + "\n")
    except OSError as e:
        sys.stderr.write(f"boot-scorecard-v2: append failed: {e}\n")

sys.exit(1 if overall == "FAIL" else (2 if overall == "INCOMPLETE" else 0))
PY
exit $?
