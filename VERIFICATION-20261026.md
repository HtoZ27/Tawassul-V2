# Claim verification ledger — 2026-10-26

Scope: the six independent agent evaluations of the v2 cutover
(`analyst-mimo`, `analyst-pickle`, `analyst-deepseek`, `analyst-gemini`,
`analyst-beam-free`, `analyst-glm-5.3-flash-free`), checked against HEAD
`3471fe3` plus the working tree. Round 2 re-checked the fixes on HEAD
`26567e5` plus the uncommitted DB-protection work and is recorded at the end
of this file.

Method: every claim was re-checked against the source, the live state files,
the installed host protocol, and runtime probes. The full gate was re-run on
2026-10-26. A claim is "confirmed" only when the cited code or a runtime probe
shows it; "refuted" means the cited code shows the opposite; "partial" means
the mechanism is real but the stated impact or number is wrong. Several agents
could not execute commands and reported on-disk claims as unverifiable; this
ledger re-checked every on-disk claim with shell access.

All IDs in this file are local (`V-01` ... `V-52`). Where an item already
exists in `ISSUES.md`, the heading names that ID (`register: B-03`). Where the
verification found a new defect, the heading names the new register ID
(`new: C-01`).

Result: 50 entries checked. 34 confirmed, 5 partially confirmed, 8 refuted or
not observed, 3 verified sound.

One critical defect was under-reported: analyst-deepseek noted that
command-level guards are keyed on `bash`, but no report traced the
consequence for the consent gate. Verification confirmed it and found the
blast radius wider: every `bash`-keyed guard was bypassed, not only consent.

---

## Gate evidence (2026-10-26)

Latest round-2 run: `npm run ci` exited 0.

- fast: 6 steps, pass.
- proofs: 28 steps, 27,344 ms, `GATE PASS: proofs`.
- catalog: the 29th `PROOF PASS` (28 proof steps plus the catalog).
- smoke: `SMOKE PASS: host v2.1.4, scratch boot, 42 tools, model reply,
  health + help`, 12,494 ms.
- the smoke actually received a model reply in this run
  (`scratch boot loaded the plugin and replied`). The boot-only path now
  prints `SMOKE PASS (no model reply)` and can be made fatal with
  `TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=1` (V-11).

The green gate proves boot health, tool registration, health, and help. It
does not prove that a model round trip always happens.

---

## A. Confirmed defects

### A1. Critical

#### V-01 Consent gating is dead on the v2 host (new: C-01)

Claim (analyst-deepseek): command-level guards are keyed on `bash`, while the
v2 host calls the tool `shell`.

Verdict: CONFIRMED, P0. Fixed in `8ccdd9a`; `prove-shell-alias` now covers
the alias, consent, the dangerous-command guard, and the tawa block.

Evidence at audit time:

- `src/hooks/guards/shared/limits.ts:29` defines
  `CONSENT_TOOLS = new Set(["bash", "delete", "kick"])`.
- `:42-49` returns `false` for every other tool name.
- The installed host protocol names the command tool `shell`:
  `node_modules/@opencode/protocol/dist/client.d.ts:53`
  (`"server.shell": "shell"`) and the session schema tag `"shell"`.
- The plugin's own metrics record real calls as `"tool": "shell"`
  (`.opencode/activity-metrics.json:35`).
- `src/utils/name-utils.ts:44-55` does not alias `shell` to `bash`.

Impact: `git push --force`, `rm -rf /`, `sudo`, `mkfs`, `dd if=` and the other
patterns in `CONSENT_DANGEROUS_PATTERNS` never reach the consent gate. The
host's own permission layer is the only remaining protection. This violates
the product rule that the agent must not act destructively on the user's
behalf.

Resolution: `shell` is now canonicalized to `bash` at the hook boundary and
in the v2 bridge, the consent set also accepts the raw alias, and
`prove-shell-alias` fails the gate if any of those links regress.

#### V-02 AskChannel select/input still return `undefined` (register: P-01/E-03)

Claim: select/multiselect/input elicitations are not bridged.

Verdict: CONFIRMED, P0. `src/v2/ask.ts:40-43` logged a warning and returned
`undefined` for every type except `confirm`.

Impact: a tool that needs a choice silently proceeded without an answer.

Fixed in `ccb2cb6`: unbridged types now throw a visible error instead of
returning `undefined`; `prove-v2-ask-bridge` covers the block.

#### V-03 `noReply` still becomes a queued user turn (register: P-01/E-03)

Claim: `body.noReply === true` maps to `delivery: "queue"`.

Verdict: CONFIRMED, P0. `src/v2/client-shim.ts:47` and `:55` mapped it in both
`prompt` and `promptAsync`.

Impact: a consent question became a real model turn, so the agent could
answer on the user's behalf and burn quota.

Fixed in `ccb2cb6`: `noReply` now uses `session.synthetic` (display without a
model turn), and drops the message with a warning if that host method is
missing; it never queues a user turn. `prove-v2-ask-bridge` covers both
paths.

#### V-04 Three database paths still coexist (register: D-01)

Claim: sidecar, shared, and launcher databases carry different session sets.

Verdict: CONFIRMED, P0. Re-measured 2026-10-26:

| DB | Size | `session_v2` |
|---|---|---|
| `~/.local/share/opencode/tawassul-v2/opencode.db` (sidecar) | 25,378,816 | 19 |
| `~/.local/share/opencode/opencode.db` (shared) | 24,780,800 | 14 (plus 2 legacy `session`) |
| `~/.local/share/tawassul-v2/opencode-v2.db` (launcher) | 13,627,392 | 14 |

The register said 13/14/14 on 2026-10-25; the sidecar had grown to 19 at
audit time and 21 at the final check. The split is worsening, not
stabilizing. Owner decision still pending.

Round 2 (2026-10-26 05:28): sidecar 22 `session_v2` / 2,541
`session_message`, 29,343,744 bytes + 10,460,712 WAL; shared 14 / 2 legacy
/ 1,268, 24,780,800 bytes; launcher 14, 13,627,392 bytes. The owner adopted
the role assignment: sidecar canonical, shared legacy read-only, launcher
test-only. The doctor now passes with `one canonical session DB` and warns
that the 14+14 copies are retained read-only; D-02 imported them on
2026-10-26 (26 sessions, 384 messages). The live v2 schema has no
`message`/`part`; history is `session_message` (register D-04).

#### V-05 Sidecar session count drifted (register: D-01)

The count moved from 13 to 19 in one day while the other two stayed at 14.
Recorded as new evidence under D-01; no separate action.

### A2. Major

#### V-06 The two backup schemes collide and the prune keeps the wrong files (new: B-06)

Claim (analyst-mimo): `utils/atomic.ts` prunes by prefix and can evict the
`StateManager` numbered chain; `.bak.orphan-*` is kept preferentially.

Verdict: CONFIRMED by runtime probe, P1.

Probe: seed `f.json.bak.0`, `f.json.bak.1`, `f.json.bak.orphan-1792900000000`,
then one `atomicWriteFile("f.json", ..., { backup: true })`.

Remaining files:

```
f.json
f.json.bak.1792985110796.89fc1b8485c6
f.json.bak.orphan-1792900000000
```

The two numbered backups were deleted; the orphan was kept. Cause:
`src/utils/atomic.ts:24-27` filters every `${base}.bak.` entry, sorts
lexicographically descending, and keeps the first two. `orphan-` sorts after
digits, and the timestamped name sorts before `.bak.0`/`.bak.1`.

Impact: one atomic write to a base that also has a `StateManager` chain
destroyed the recovery chain and replaced it with an orphan plus one snapshot.
The owner's "never more than two" rule was met numerically while the useful
backups were lost.

Fixed in `d012c55`: the atomic prune matches only its own
`.bak.<timestamp>.<hex>` names, so numbered backups and orphans are never
evicted. `prove-backup-cap` seeds both schemes and asserts the numbered chain
survives two atomic writes.

#### V-07 `.bak.orphan-*` files are never pruned (new: B-07)

Claim (analyst-mimo): `cleanOrphanedTmp` only removes `*.tmp` and `*.delta`.

Verdict: CONFIRMED, P1. `StateManager.cleanOrphanedTmp` at
`src/context/managers/StateManager.ts:319-338` matches `\.(tmp|delta)$` only.
`src/services/lifecycle-controller.ts:229` creates
`<state>.bak.orphan-<ts>` at shutdown when a `.tmp` survives.

Impact: every crash could leave one orphan forever, and V-06 showed those
orphans outranked real backups in the atomic prune. Zero orphans existed at
audit time, so this was latent.

Fixed in `d012c55`: `cleanOrphanedTmp` now keeps only the newest orphan
(`MAX_BACKUPS`) and removes older ones, while leaving the numbered chain
untouched. `prove-backup-cap` covers the prune.

#### V-08 A state file above 5 MB gets no backup at all (new: B-08)

Claim (analyst-mimo): `MAX_BACKUP_FILE_SIZE` skips the numbered backup.

Verdict: CONFIRMED, P1 latent. `src/context/managers/StateManager.ts:92`
set the cap to 5 MB; `:232-234` returned without rotating when the file was
larger. The live `tawassul-state.json` was 49,853 bytes, so the cap was not
active. A growing file would silently stop refreshing recovery copies.

Fixed in `6564ac1`: 5 MB is a warning threshold only; rotation always
backs up. `prove-backup-cap` writes a 5 MB+ state file and asserts the full
copy exists.

#### V-09 No gate proof covers the backup cap (new: B-09)

Claim (analyst-mimo): the cap is a one-off probe, not a gate proof.

Verdict: CONFIRMED, P2 at audit time. No `scripts/prove-*.ts` referenced
`MAX_BACKUPS`, and no proof wrote repeatedly into a directory and asserted
the backup count.

Fixed in `d012c55`: `prove-backup-cap` now seeds both schemes, performs two
atomic writes, asserts exactly two atomic backups remain, and asserts the
numbered chain and newest orphan survive. It runs in `gate:proofs`.

#### V-10 `tool-run-log.json` is 2.72 MB, not 2.2 MB (register: B-03)

Claim (analyst-mimo): the size figure is stale and the file keeps growing.

Verdict: CONFIRMED, P2. Measured 2026-10-26: 2,717,354 bytes, 1,908 runs.
`src/services/tool-run-log.ts:88` parses the whole file at load and `:105`
serializes with `JSON.stringify(..., null, 2)`.

Impact: boot cost and disk growth; the register understates it by 0.5 MB and
the file has grown 270 KB since the report.

Round 2 (05:28): 3,288,019 bytes and 1,909 runs (3,245,127 / 1,867 at 05:24).
The file is still growing.

#### V-11 The smoke can pass without a model round trip (register: G-09)

Claim (analyst-mimo): `"text":"SMOKE"` is checked only when `BOOT_RC=0`; the
tolerance regex is too broad.

Verdict: CONFIRMED as a gate weakening, P1. `scripts/release-smoke.sh:99-110`
accepts any non-zero exit whose output matches `provider\.[a-z-]+`,
`FreeUsageLimitError`, `429`, `ECONNRESET`, `timed out`, or the unanchored
word `timeout`, provided the boot markers exist. `:122-124` checks
`"text":"SMOKE"` only on `BOOT_RC=0`.

Today's run did get a reply, so the branch was not used. The branch remains a
path where `SMOKE PASS` is printed without a successful model call.

Round 2: the branch is now labelled. A boot-only run prints
`SMOKE PASS (no model reply)`, never the plain `SMOKE PASS` line, and
`TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=1` turns a missing reply into exit 5
(`scripts/release-smoke.sh`). The default stays boot-tolerant by design.

#### V-12 `plugin.config` is still not invoked on v2 (register: E-02)

Claim (analyst-deepseek): the hook is only logged.

Verdict: CONFIRMED, P1. `src/v2/setup.ts:374-379` logs that the hook "has no
host channel"; the hook itself is registered in
`src/bootstrap/plugin-init.ts:837-840` but never called by the v2 adapter.

Impact: model-sentinel and permission repair that depend on this hook do not
run through the host. See V-13 for the part that is mitigated.

#### V-13 Permission repair does not run at boot; model repair only covers the project config (register: E-02)

Claim (analyst-deepseek): dynamic model resolution and addagent permission
repair never run.

Verdict: PARTIALLY CONFIRMED, P1.

- `src/utils/opencode-config.ts:376-385` (`applyBootRepairs`) rewrites dynamic
  model sentinels and is called at `src/bootstrap/plugin-init.ts:479` via
  `repairProjectConfigBoot`.
- It does not call `ensureTawaToolPermissions` or
  `ensureAddAgentToolPermissions`; those are only in the uninvoked `config`
  hook (`plugin-init.ts:838-840`).
- It only looks at `opencode.json`/`opencode.jsonc` in the project directory,
  not the global config.

So model repair survives for project configs; permission repair does not run
at boot at all, and a global config is never repaired.

#### V-14 The two foreign v1 entries are full v1 trees (register: P-07)

Claim (analyst-gemini): `gtttt` and `paassss` still expose a v1-only
`index.ts` that the host discovers and fails to load.

Verdict: CONFIRMED and larger than reported, P1.

`/home/htoz/Desktop/gtttt/.opencode/plugins/tawassul/` is a 664 KB directory
with the full v1 source tree (26 top-level entries, `bootstrap/`, `services/`,
`plugin.ts`). Its `plugin.ts:12` exports `{ id: "tawassul", server: tawassul }`
with no `setup`/`effect`, which the v2 host rejects. The same tree exists in
`paassss`.

Impact: every boot in those workspaces logs a plugin-load failure; a v1 tree
is also one edit away from loading. This violates D-00 (`ISSUES.md:13`).
Renaming the entry or removing the directory is needed.

Resolved 2026-10-26: the owner deleted both package directories. Neither
workspace has an `.opencode` directory now, and `doctor-v2.sh` prints
`PASS  external tree has no live v1 entry` for both. Six inert
`tawassul.js.retired-20261024` files remain in other workspaces; they are not
discovered as active entries.

#### V-15 No automated check for the H-09 rename (new: G-10)

Claim (analyst-gemini): the closure depends on a manual rename and has no
gate.

Verdict: PARTIALLY CONFIRMED, P2. The register has a manual isolated-boot
transcript, so "no proof" is too strong. There is no automated check: no
`prove-*` or `tests/` file references `retired-20261025`.

Impact: a restore or copy can reintroduce the entry silently.

#### V-16 Stale wasm assets are not pruned on upgrade (register: I-04)

Claim (analyst-pickle).

Verdict: CONFIRMED, P2. `scripts/install-global.ts:345-352` writes the new
bundle and assets and writes a new marker; `:276-300` records only the new
assets. No code removes files under `WASM_DIR` that are absent from the new
set.

#### V-17 `--force` overwrites an unmarked target without a backup (register: I-05)

Claim (analyst-pickle).

Verdict: CONFIRMED, P2. `scripts/install-global.ts:347` calls
`writeAtomic(TARGET, bundle.bytes)` after the `--force` bypass at `:325-326`;
there is no copy of the pre-existing file.

#### V-18 The installer is Linux-only despite a cross-platform claim (register: I-02)

Claim (analyst-pickle).

Verdict: CONFIRMED, P2 if cross-platform is in scope. `hostCandidates()` at
`scripts/install-global.ts:126-133` splits `PATH` on `":"`, probes the bare
name `opencode`, and hardcodes `~/.config/ai.opencode.desktop/cli`. Windows
uses `";"` and `opencode.exe`/`opencode.cmd`; macOS paths differ.

#### V-19 Global boot cost is unmeasured and the live boot is manual (register: I-08/I-10)

Claim (analyst-pickle).

Verdict: CONFIRMED, P2. The baseline records a manual isolated-HOME boot and
no timing; `npm run ci` never boots the installed global file.

#### V-20 Coexistence is unit-level only (register: I-09)

Claim (analyst-pickle).

Verdict: CONFIRMED, P2. The register itself says the coexistence claim is
unit-level; no live two-copy boot is in the gate.

#### V-21 No pin agreement check in the fast tier (register: G-07)

Claim (analyst-deepseek): the fast tier has no pin check.

Verdict: CONFIRMED, P3. `scripts/gate.ts fast` runs rules, shell syntax,
typecheck, config, facts, catalog. The pins agree today
(`package.json:57`, `doctor-v2.sh:187`, `opencode-v2-iso.sh:176`,
`release-smoke.sh:25` all 2.1.4) but nothing asserts it.

#### V-22 No Desktop-wide plugin-entry census (register: G-08)

Claim (analyst-gemini): no scan for `plugins/*/index.{ts,js}`.

Verdict: CONFIRMED, P2. The proof walks the repo for exactly `tawassul.js`
(`scripts/prove-v2-independence.ts:96-107`) and never scans the Desktop
workspaces where V-14 lives.

#### V-23 Later rejected-state copies are dropped (new: P-08)

Claim (analyst-mimo): `preserveRejectedState` keeps only the first rejection.

Verdict: CONFIRMED, P2. `src/services/persist-utils.ts:111-113` returns early
when any `${base}.rejected.` file already exists in the quarantine directory.
The first corrupt state is preserved; every later distinct one is lost. No
`.rejected.*` file exists today under `.opencode/`, the global v2 state dir,
or the legacy state dir, so the reported `timeline-meta.json.rejected.*`
artifact is not present on this machine; the defect is in the code path.

#### V-24 Legacy state lookup prefers the v1 directory (new: P-09)

Claim (analyst-mimo): `tawassyl` is checked before `tawassul`, first existing
wins, no staleness comparison.

Verdict: CONFIRMED, P2. `src/utils/state-paths.ts:7-9` names the v1 dir
`tawassyl` and the router dir `tawassul`; `:44-45` orders v1 first;
`:70-72` returns the first existing candidate.

Impact: if both legacy dirs exist, the retired tree's state wins even when it
is older. The register's legacy fallback is deliberate but not ordered by
freshness.

#### V-25 Boot-repair backups are uncapped (new: B-10)

`src/utils/opencode-config.ts:425` wrote `configPath + ".bak." + ts` with no
prune. Exactly two `opencode.json.bak.*` existed at audit time (within the
cap), but repeated repairs could exceed it. P3.

Fixed in `6564ac1`: the manual backup is gone; both repair paths use
`atomicWriteFile` and its two-copy cap. `prove-backup-cap` runs three repairs
and asserts two backups with no uncapped timestamped file.

#### V-26 Schema refresh is delayed, not permanently skipped (register: B-01/B-02)

Claim (analyst-deepseek): `collectToolSchemas` is refreshed only when the
initial ready probe succeeds.

Verdict: PARTIAL, P2. The initial branch at `src/v2/setup.ts:164-178` does
skip schema collection when the 750 ms probe is not ready. But the retry loop
at `:196-224` calls `readyProbe()`, `refreshSchemas()`, and `ctx.tool.reload()`
as soon as the host becomes ready. The exposed window is the placeholder
period, not a permanent empty schema set; during that window the tools carry
placeholder schemas and no per-tool warning is logged.

#### V-27 Placeholder window is about 10.25 s, not 10.75 s (register: B-02)

Claim (analyst-deepseek): worst case is 750 ms + 20 x 500 ms = 10.75 s.

Verdict: PARTIAL, P3. The loop sleeps after attempts 0 through 18 and returns
after the 20th probe (`setup.ts:198-220`), so the built-in delay is
750 + 19 x 500 = 10,250 ms, plus the probe latency. The user-visible window is
still about 10 seconds and worth reducing.

#### V-28 Tool schema payload is still unmeasured (register: B-05)

Claim (analyst-beam-free).

Verdict: CONFIRMED, P2. No file records the schema bytes per request; the
register keeps B-05 open.

#### V-51 Schemas are collected twice and the tool set is reloaded (register: B-01)

Claim (analyst-beam-free): schema collection is duplicated around
`ctx.tool.reload()`.

Verdict: CONFIRMED, P2. When the host is ready at boot,
`src/v2/setup.ts:164-178` collects schemas before registration; the retry
loop at `:198-224` collects them again and calls `ctx.tool.reload()`. The
second pass is needed for a late-ready host, but the ready path pays for both.

#### V-29 Unknown schemas proceed on positive evidence (register: E-05)

Claim (analyst-glm): `guard-db-generation.sh:229` proceeds when no v1 marker
is present.

Verdict: CONFIRMED but bounded, P2. The `warn` branch runs only after the
`event`/`message`/`part`/`session` table probes pass, so a completely foreign
database is still refused by the table census.

#### V-30 Auto `npm install` is not covered (register: I-06)

Claim (analyst-pickle).

Verdict: CONFIRMED, P3. The path exists at `install-global.ts:239-245`, but
`prove-global-install.ts` never exercises a missing wasm package.

#### V-31 No committed CI transcript (new: I-11)

Claim (analyst-pickle).

Verdict: CONFIRMED, P3 process gap. The gate result is not an artifact in the
tree; today's run is recorded in this file instead.

#### V-52 High-stakes closures rest on manual transcripts (new: G-12)

Claim (analyst-mimo): H-02, H-06, H-07, P-05, P-07, and E-09 rest on one-off
transcripts with no CI artifact.

Verdict: PARTIALLY CONFIRMED, P2. `grep` over `scripts/` and `tests/` finds no
gate step for H-02, H-07, P-05, or P-07; those closures are prose evidence.
H-06 has a live doctor warning (`doctor-v2.sh:202`), and E-09 has four pins but
no agreement assertion (V-21). The risk is silent regression, not a false
closure.

### A3. Minor

#### V-32 Register drift (new: G-11)

Confirmed:

- The status date at the top of `ISSUES.md` is 2026-10-25; it is now
  2026-10-26.
- The H-02 evidence bullet (line 82) says 25 `PROOF PASS`, while the baseline
  `npm run ci` bullet says 26 (25 steps plus the catalog, which is correct).
- The audit baseline paragraph (line 653) cites HEAD `d740865` while HEAD is
  `3471fe3`.
- The E-07 text (lines 615-617) says the independence proof skips
  `scripts/*.sh`, but `scripts/prove-v2-independence.ts:71-75` scans `.ts` and
  `.sh`.
- The pending-decision list was numbered 1,2,3,4,7,5,6; it is now 1-7.
- The catalog counts itself and asserts floors (`>=25`, `>=24`), so the exact
  total is not pinned (`scripts/prove-proof-catalog.ts:66-67`).

#### V-33 B-04 cleanup arithmetic (register: B-04)

`ISSUES.md` says "41 redundant files removed — 33 `.bak.*` plus 75 `*.tmp`";
33 + 75 = 108. The total and the components cannot both be right. P3
documentation.

#### V-34 E-05 line drift (register: E-05)

The E-05 text (line 704) cites `guard-db-generation.sh:236-243`; the refusal
is at `:245`. P3.

#### V-35 H-03 evidence text still reads as a current hazard (register: H-03)

The heading says "done", but the evidence block at `ISSUES.md:99-101`
describes the attach hazard in the present tense ("If the client sees a
service descriptor, it can attach ... Dev runs would then write to the live
DB"). The resolution explains the fix; the evidence needs a "before" label.
P3 documentation.

#### V-36 Root leftovers are real and already covered (register: D-03)

`cost-transparency.json` plus two backups, `collective-memory-515c5c5d.json`
plus one backup, and `opencode.json` plus two backups are present. The D-03
text (lines 590-591) already names the `cost-transparency*` scan as missing,
so the agent's "undercount" claim is refuted (see R-07). P3.

#### V-37 E-10 HEAD citation is stale (register: E-10)

The E-10 text (line 744) cites `d740865`; HEAD is `3471fe3`. The tree is
clean apart from the five known untracked files. P3.

---

## B. Refuted claims

#### R-01 State recovery is dead (analyst-mimo)

Refuted as stated. `src/context/managers/StateManager.ts:680-699` reads only
the numbered chain and the legacy `.bak`, but the live
`.opencode/tawassul-state.json` has a valid `.bak.0`, and `StateManager`
itself writes numbered backups via `rotateBackups` (`:222-257`). Recovery
works for the main state file. The unread timestamped backups belong to
files written through `utils/atomic.ts` (router, goals, timeline), which have
their own loaders. The real risk is V-06, not a dead main state.

#### R-02 Dynamic model resolution never runs (analyst-deepseek)

Refuted. `repairProjectConfigBoot` calls `applyBootRepairs`, which calls
`rewriteDynamicAgentModels` (`src/utils/opencode-config.ts:376-385`), and the
repair runs at boot (`src/bootstrap/plugin-init.ts:479`). The gap is narrower:
permission repair and global-config repair do not run (V-13).

#### R-03 `plugin.config` is wired at `plugin-init.ts:479` (analyst-deepseek)

Refuted. `:479` is the `repairProjectConfigBoot` call. The `config` hook is at
`:837-840`. The hook is still uninvoked on v2, so the underlying E-02 finding
stands, but the citation is wrong.

#### R-04 The retention refusal citation `:82` is wrong (analyst-deepseek)

Refuted. The G-06/E-05 text (line 478) cites `prove-db-retention.ts:82`, and
the assertion is exactly at line 82 (`assert(refused.output.includes(
"generation guard refused"))`). No drift.

#### R-05 `--purge` keeps agent files without warning (analyst-pickle)

Refuted as stated. `scripts/install-global.ts:377-383` counts the agent files
and prints `kept N agent file(s) ... remove them manually if unwanted`. The
files are kept, but the user is warned. P3 documentation only.

#### R-06 There is no bundle freshness check (analyst-pickle)

Refuted as stated. The marker records `bundle.sha256`, `bytes`, `version`,
`host`, and the wasm hashes (`install-global.ts:276-300`); `upToDate`
compares version, host, and bundle sha (`:292-310`). What is missing is a link
to the source git commit, not freshness of the installed bundle.

#### R-07 D-03 omits the cost-transparency leftovers (analyst-mimo)

Refuted. `ISSUES.md:585-587` explicitly names `cost-transparency*` as part of
the missing scan.

#### R-08 The smoke passed with zero model round trips in the observed run

Not observed on 2026-10-26. The run logged `scratch boot loaded the plugin and
replied`, and `"text":"SMOKE"` was checked. The code path that permits a pass
without a model call still exists (V-11); the claim is about the gate design,
not today's transcript.

---

## C. Verified sound (no action)

#### V-48 E-09 pins agree

`package.json:57`, `doctor-v2.sh:187`, `opencode-v2-iso.sh:176`,
`release-smoke.sh:25` all pin 2.1.4. The finding is a coverage gap (V-21), not
a mismatch.

#### V-49 B-04 code constants

`atomic.ts:9` is 2 and `StateManager.ts:91` is 1, so the named rotation keeps
`.bak.0` plus `.bak.1`. The cap is correct; the cross-scheme interaction is
the defect (V-06/V-09).

#### V-50 AskChannel confirm path works

`ask.ts:25-38` registers the permission evaluate hook and `:50-67` asserts it.
Only select/input are unbridged.

---

## D. New or materially corrected findings

1. **V-01** consent gating is dead for `shell` (critical).
2. **V-06** atomic prune evicts `.bak.0`/`.bak.1` and keeps `.bak.orphan-*`
   (runtime-proven).
3. **V-07** orphans are never cleaned.
4. **V-08** a state file above 5 MB gets no backup.
5. **V-09** no gate proof for the backup cap.
6. **V-25** boot-repair backups have no cap.
7. **V-23** later rejected-state copies are dropped.
8. **V-24** legacy state lookup prefers the retired v1 directory.
9. **V-05** sidecar sessions grew from 13 to 19 (and 21 by the final check)
   in one day.
10. **V-14** the two foreign entries are full v1 trees, not single files.
11. **V-10** the tool-run log is 2.72 MB and 1,908 runs, not 2.2 MB.
12. **V-11** today's smoke did reply, so the weakened branch was not
    exercised; the register should distinguish "the gate can pass without a
    model call" from "the gate passed without one".

---

## E. Agent-by-agent disposition

### analyst-mimo

| Finding | Verdict | ID |
|---|---|---|
| `.bak.orphan-*` latent eviction | Confirmed, runtime-proven | V-06 |
| State recovery dead | Refuted; main state has `.bak.0` | R-01 |
| `preserveRejectedState` drops later rejections | Confirmed | V-23 |
| Legacy candidate order `tawassyl` first | Confirmed | V-24 |
| Independence proof counts only `tawassul.js` | Confirmed | V-22 |
| Guard unknown-schema positive-evidence | Confirmed, bounded | V-29 |
| B-03 is 2.45 MB | Confirmed, now 2.72 MB | V-10 |
| B-04 arithmetic 41 vs 108 | Confirmed | V-33 |
| G-09 tolerance too broad | Confirmed | V-11 |
| ISSUES 25 vs 26 | Confirmed cosmetic | V-32 |
| 5 MB backup skip | Confirmed latent | V-08 |
| No backup-cap proof | Confirmed | V-09 |
| Six closures rest on manual transcripts | Partial | V-52 |

### analyst-pickle

| Finding | Verdict | ID |
|---|---|---|
| PATH split on `:` | Confirmed | V-18 |
| `--purge` keeps agents without warning | Refuted; warning exists | R-05 |
| Stale wasm not pruned | Confirmed | V-16 |
| `--force` no backup | Confirmed | V-17 |
| Auto npm install untested | Confirmed | V-30 |
| No bundle freshness | Refuted; sha marker exists | R-06 |
| Global boot cost unmeasured | Confirmed | V-19 |
| Coexistence unit-level only | Confirmed | V-20 |
| Manual boot not in CI | Confirmed | V-19 |
| No CI transcript | Confirmed process gap | V-31 |

### analyst-deepseek

| Finding | Verdict | ID |
|---|---|---|
| Consent gate keyed on `bash` | Confirmed, critical, missed by others | V-01 |
| Schema refresh only on initial ready | Partial; retry loop | V-26 |
| Worst case 10.75 s | Partial; 10.25 s | V-27 |
| `plugin.config` wired at `:479` | Refuted; hook at `:837-840` | R-03 |
| Retention citation `:82` drift | Refuted | R-04 |

### analyst-gemini

| Finding | Verdict | ID |
|---|---|---|
| P-07 entries still discovered | Confirmed; full v1 trees | V-14 |
| H-09 manual rename, no gate | Partial; transcript exists, gate missing | V-15 |

### analyst-beam-free

| Finding | Verdict | ID |
|---|---|---|
| B-01 schema duplication plus reload | Confirmed | V-51 |
| B-05 never measured | Confirmed | V-28 |
| D-01 three DB paths | Confirmed; 21/14/14 at final check | V-04 |
| E-02 config hook unbridged | Confirmed; nuance in V-13 | V-12 |

### analyst-glm-5.3-flash-free

| Finding | Verdict | ID |
|---|---|---|
| E-05 marker at `:245` not `236-243` | Confirmed | V-34 |
| E-09 pins agree | Confirmed sound | V-48 |
| E-10 register one commit behind | Confirmed | V-37 |
| Independence proof scans `scripts/*.sh` | Confirmed; register wrong | V-32 |
| Counts only `tawassul.js` | Confirmed | V-22 |
| Guard unknown-schema policy | Confirmed | V-29 |

---

## F. Impact ranking (end-user harm)

1. **V-01** destructive commands bypass consent entirely.
2. **V-04** a session written to the wrong DB is unrecoverable.
3. **V-02 / V-03** the agent can decide for the user and burn quota.
4. **V-06 / V-07 / V-08** recovery copies can be silently destroyed or never
   written.
5. **V-12 / V-13** roster permissions are not repaired at boot.
6. **V-14** every boot in two workspaces fails to load a v1 plugin.
7. **V-11** the gate can certify a boot with no model round trip.
8. **V-10 / V-26 / V-27** boot cost and placeholder delay.
9. **V-16 / V-17 / V-18** global install can leave stale or overwritten files.
10. **Register drift** (V-32, V-33, V-34, V-35, V-37) makes future audits
    unreliable.

---

## G. Next actions

1. Fix V-01: add `shell` to the consent set, normalize host aliases, and add a
   live blocked-command proof.
2. Fix V-06/V-07: namespace the backup schemes, exclude `.bak.orphan-*` from
   the atomic prune, clean orphans, and add a gate proof for the cap.
3. Fix V-02/V-03: bridge select/multiselect onto `permission.assert` or fail
   closed with a visible error; never map `noReply` to a queued turn.
4. Execute the DB protection plan (protected tables, fail-closed detection,
   isolated proof) before any maintenance touches the sidecar.
5. Decide D-01 canonical DB, then enforce a single write path.
6. Rename or remove the two full v1 trees in `gtttt` and `paassss`.
7. Correct the register: V-10 size, V-33 arithmetic, V-32 HEAD and proof
   counts, V-34 line number, and the independence-proof wording.
8. Add the missing proofs: backup cap, `shell` consent, live blocked tool,
   pin agreement, and the global boot.

---

## H. Round 2 reconciliation (2026-10-26 05:35)

The two external reports and the round-1 ledger are stale on the items below.
Every status was re-checked against HEAD `26567e5` plus the uncommitted
DB-protection work, and the full `npm run ci` passed (fast 6, proofs 28,
smoke 42 tools with a model reply).

| Item | Round-1 state | Round-2 status | Evidence |
|---|---|---|---|
| C-01 `shell` bypasses consent | Confirmed critical | Fixed `8ccdd9a` | `prove-shell-alias` PASS |
| V-02/V-03 select/input + `noReply` | Confirmed | Fixed `ccb2cb6` | `prove-v2-ask-bridge` PASS |
| B-06/B-07/B-09 backup collision, orphans, no proof | Confirmed | Fixed `d012c55` | `prove-backup-cap` PASS |
| B-08 >5 MB state gets no backup | Confirmed latent | Fixed `6564ac1` | large-file backup asserts |
| B-10 boot-repair backups uncapped | Confirmed | Fixed `6564ac1` | exactly two backups |
| G-09 smoke passes without a reply | Confirmed | Tightened; labelled pass + opt-in exit 5 | `release-smoke.sh` |
| D-04 maintenance target/schema | New in round 2 | Fixed: explicit target, allowlist, census, cap | `prove-db-retention` PASS |
| B-03 log size | 2.72 MB / 1,908 runs | 3,288,019 bytes / 1,909 runs | live file |
| D-01 three DBs | 19/14/14 → 21/14/14 | Roles adopted: canonical/legacy/test; doctor passes with a warning | `doctor-v2.sh` |
| H-04 descriptor | Done | Live PID 1537214, URL `127.0.0.1:49374` | `service.json` + `/proc` |
| E-01 `blockTool` | Fixed | 8 occurrences: 1 definition + 7 calls | `tool-execute.ts` |
| D-03 root leftovers | Open, scan missing | Five root files deleted; 1.09 GB `/tmp` cleaned | `stat`, `du`, `git status` |

### D-04 DB protection evidence

The maintenance lane now has a single explicit target, a four-table mutation
allowlist, a protected-table census, a 4 GiB DB+WAL cap, and a v2-schema
prune. `scripts/prove-db-retention.ts` passes 44 assertions, including:

- implicit DB selection is refused with exit 2 and names D-01;
- `--plan` lists the mutation and protected tables;
- a v2-only schema (`session_v2` + `session_message`, no `message`/`part`)
  is detected and pruned without touching sessions;
- `project`, `permission`, `credential`, and `migration` rows survive;
- the backup carries every `session_message` row;
- event-only exits 9 when the cap remains.

A real-schema copy of the live sidecar completed full maintenance: backup
verified `session_v2=21`, `session=0`, `session_message=2519`; protected
counts unchanged; 38 MB → 22 MB DB+WAL. The live file was not mutated.

Remaining owner decision: the real global install (I-01), deferred by the
owner on 2026-10-26. D-01 roles, D-02 import, D-03 cleanup, and P-07 were
executed on 2026-10-26.

## I. Round 3 — D-02 import, P-07, and global-install verification

Run 2026-10-26 05:51-05:55 against the live sidecar and host v2.1.4.

### D-02 import

| Check | Result |
|---|---|
| Pre-import backup | 31,125,504 bytes, `integrity_check=ok`, 22 sessions / 2,712 messages |
| Backup SHA-256 | `71766f6346d1...e9c90f5d`, stored in the adjacent `.sha256` file |
| Sources | shared 12 new (342 messages) + launcher 14 new (42 messages) |
| Imported | 26 sessions / 384 messages |
| Canonical after commit | 48 sessions / 3,100 messages (3,110 after host writes) |
| Integrity | `integrity_check=ok`, `foreign_key_check` empty |
| Duplicates | 0 session IDs, 0 message IDs, 0 `(session_id, seq)` pairs, 0 orphans |
| Protected tables | project 5, credential 6, instruction_blob 22, instruction_state 22, worktree 2, event 0, event_sequence 24 — unchanged |
| Host visibility | `GET /api/session` returns 48 rows and all three spot-checked imported IDs |
| Doctor | `PASS  one canonical session DB: OPENCODE_DB 48/48` |
| Sources untouched | shared mtime 2026-10-25 16:55, launcher 2026-10-25 04:46 |

Not imported: the shared DB's two legacy `session` rows (4 `message`, 2
`part`) and the v1 archives under `/home/htoz/Videos/New Folder/` (223 and
280 `session` rows, no `session_v2`). They use the v1 schema and stay
read-only.

### P-07

`/home/htoz/Desktop/gtttt` and `/home/htoz/Desktop/paassss` no longer have an
`.opencode` directory. `doctor-v2.sh` passes both external-tree checks; the
only remaining `tawassul.js` copies outside this tree are six
`.retired-20261024` files that the host does not discover.

### Global install

No global install exists at the v1 or v2 paths: `~/.opencode`,
`~/.config/opencode/plugins/`, `~/.config/opencode/tawassul-runtime/`, and
the v1 Bun package are all absent. The v1 docs use
`~/.config/opencode/plugins/` (or `~/.opencode`); v2 uses the flat
`~/.config/opencode/plugins/tawassul.js` plus the runtime directory.

`bun scripts/install-global.ts --dry-run` exits 0 with the v2.1.4 host and
would write a 2,297,954-byte self-contained bundle (SHA-256 prefix
`4c867fa0`) plus four wasm assets; all assets resolve, and no v1 artifact
blocks it. Scope detection returns `global` for the projected path and
`project` for the project bundle. The config directory is unchanged, and the
install remains deferred under I-01.
