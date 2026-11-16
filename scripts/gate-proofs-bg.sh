#!/usr/bin/env bash
set -u

SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")
REPO=$(cd "$(dirname "$SELF")/.." && pwd)
RUN_ROOT=${TAWASSUL_GATE_BG_DIR:-/tmp/opencode/gate-proofs}
LOCK_DIR="$RUN_ROOT/lock"
LATEST="$RUN_ROOT/latest"
KEEP_RUNS=5

usage() {
  cat <<'USAGE'
usage: gate-proofs-bg.sh start [shard ...]
       gate-proofs-bg.sh status
       gate-proofs-bg.sh wait
       gate-proofs-bg.sh stop

Runs the balanced proof shards sequentially in a detached process.
Shards are 1-4 (default: all four). Each shard uses its npm script;
shards 1, 2 and 4 run at niceness 10 and shard 3 runs at normal
priority for the boot timing contract. Logs live under
/tmp/opencode/gate-proofs unless TAWASSUL_GATE_BG_DIR points elsewhere.
USAGE
}

fail() {
  echo "gate-proofs-bg: $*" >&2
  exit 1
}

latest_run() {
  if [ -L "$LATEST" ]; then
    readlink "$LATEST"
    return 0
  fi
  ls -1dt "$RUN_ROOT"/run-* 2>/dev/null | head -n 1
}

read_pid() {
  cat "$LOCK_DIR/pid" 2>/dev/null || true
}

is_worker() {
  local pid=$1
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q "gate-proofs-bg.sh __run"
    return $?
  fi
  ps -p "$pid" -o command= 2>/dev/null | grep -q "gate-proofs-bg.sh __run"
}

read_state() {
  local dir=$1
  head -n 1 "$dir/state" 2>/dev/null || echo unknown
}

print_summary() {
  local dir=$1
  local state
  state=$(read_state "$dir")
  [ -n "$state" ] || state=unknown
  local pid
  pid=$(read_pid)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "state: running"
    echo "pid: $pid"
  elif [ "$state" = running ]; then
    echo "state: stale"
  else
    echo "state: $state"
  fi
  echo "run: $dir"
  if [ -f "$dir/summary.tsv" ]; then
    while IFS=$'\t' read -r shard result elapsed log; do
      echo "shard $shard: $result ($elapsed) $log"
    done < "$dir/summary.tsv"
  fi
}

prune_runs() {
  local keep=$1
  local old
  old=$(ls -1dt "$RUN_ROOT"/run-* 2>/dev/null | tail -n +$((keep + 1)) || true)
  [ -z "$old" ] && return 0
  printf '%s\n' "$old" | while IFS= read -r dir; do
    [ -n "$dir" ] && rm -rf "$dir"
  done
}

start_run() {
  local shards=()
  local raw=("$@")
  local item
  if [ "${#raw[@]}" -eq 0 ]; then
    shards=(1 2 3 4)
  else
    for item in "${raw[@]}"; do
      case "$item" in
        all) shards+=(1 2 3 4) ;;
        1|2|3|4) shards+=("$item") ;;
        *) fail "unknown shard $item (expected 1-4 or all)" ;;
      esac
    done
  fi

  local unique=()
  local seen
  for item in "${shards[@]}"; do
    seen=no
    for existing in "${unique[@]:-}"; do
      [ "$existing" = "$item" ] && seen=yes
    done
    [ "$seen" = no ] && unique+=("$item")
  done
  shards=("${unique[@]}")

  mkdir -p "$RUN_ROOT"
  local busy
  busy=$(pgrep -f "scripts/gate.ts proofs --shard" 2>/dev/null | head -n 1 || true)
  if [ -n "$busy" ]; then
    fail "a proof shard is already running (pid $busy)"
  fi
  if [ -d "$LOCK_DIR" ]; then
    local old
    old=$(read_pid)
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
      if is_worker "$old"; then
        fail "already running (pid $old); use: npm run gate:proofs:bg:status"
      fi
      fail "lock pid $old is not the background worker; remove $LOCK_DIR after checking it"
    fi
    rm -rf "$LOCK_DIR"
  fi
  mkdir "$LOCK_DIR" || fail "could not take the run lock"

  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  local run_dir="$RUN_ROOT/run-$stamp-$$"
  mkdir -p "$run_dir" || fail "could not create $run_dir"
  printf 'started=%s\nshards=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${shards[*]}" > "$run_dir/meta"

  if command -v setsid >/dev/null 2>&1; then
    nohup setsid bash "$SELF" __run "$run_dir" "${shards[@]}" > "$run_dir/worker.log" 2>&1 &
  else
    nohup bash "$SELF" __run "$run_dir" "${shards[@]}" > "$run_dir/worker.log" 2>&1 &
  fi

  ln -sfn "$run_dir" "$LATEST"
  local attempt pid=""
  for attempt in $(seq 1 20); do
    pid=$(read_pid)
    [ -n "$pid" ] && break
    sleep 0.1
  done

  echo "gate-proofs-bg: started"
  echo "run: $run_dir"
  [ -n "$pid" ] && echo "pid: $pid"
  echo "shards: ${shards[*]}"
  echo "status: npm run gate:proofs:bg:status"
  echo "wait: npm run gate:proofs:bg:wait"
}

run_shards() {
  local run_dir=$1
  shift
  mkdir -p "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
  trap 'exit 143' INT TERM
  printf 'running\n' > "$run_dir/state"
  : > "$run_dir/summary.tsv"

  local shard failed=""
  local started elapsed result
  for shard in "$@"; do
    started=$(date +%s)
    if ( cd "$REPO" && npm run --silent "gate:proofs:$shard" ) > "$run_dir/shard-$shard.log" 2>&1; then
      result=pass
    else
      result=fail
      failed=$shard
    fi
    elapsed=$(( $(date +%s) - started ))
    printf '%s\t%s\t%ss\t%s\n' "$shard" "$result" "$elapsed" "$run_dir/shard-$shard.log" >> "$run_dir/summary.tsv"
    [ -n "$failed" ] && break
  done

  if [ -n "$failed" ]; then
    printf 'fail:%s\n' "$failed" > "$run_dir/state"
    exit 1
  fi
  printf 'pass\n' > "$run_dir/state"
  prune_runs "$KEEP_RUNS"
}

status_run() {
  local dir
  dir=$(latest_run)
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then
    echo "gate-proofs-bg: no run yet"
    exit 0
  fi
  print_summary "$dir"
  case "$(read_state "$dir")" in
    fail:*) exit 1 ;;
    *) exit 0 ;;
  esac
}

wait_run() {
  local dir
  dir=$(latest_run)
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then
    echo "gate-proofs-bg: no run yet"
    exit 0
  fi
  local pid
  while :; do
    pid=$(read_pid)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      sleep 2
      continue
    fi
    if pgrep -f "scripts/gate.ts proofs --shard" >/dev/null 2>&1; then
      sleep 2
      continue
    fi
    break
  done
  print_summary "$dir"
  case "$(read_state "$dir")" in
    pass) exit 0 ;;
    *) exit 1 ;;
  esac
}

stop_run() {
  local dir
  dir=$(latest_run)
  local pid
  pid=$(read_pid)
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    local orphan
    orphan=$(pgrep -f "scripts/gate.ts proofs --shard" 2>/dev/null | head -n 1 || true)
    if [ -n "$orphan" ]; then
      kill -TERM "$orphan" 2>/dev/null || true
      echo "gate-proofs-bg: stopped orphan shard pid $orphan"
    else
      echo "gate-proofs-bg: no active run"
    fi
    rm -rf "$LOCK_DIR"
    exit 0
  fi
  if ! is_worker "$pid"; then
    fail "pid $pid is not the background worker; refusing to kill it"
  fi
  if command -v setsid >/dev/null 2>&1; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
  local attempt
  for attempt in $(seq 1 25); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  if [ -n "$dir" ] && [ -d "$dir" ]; then
    printf 'stopped\n' > "$dir/state"
  fi
  rm -rf "$LOCK_DIR"
  echo "gate-proofs-bg: stopped pid $pid"
}

cmd=${1:-}
if [ -z "$cmd" ]; then
  usage
  exit 2
fi
shift

case "$cmd" in
  start) start_run "$@" ;;
  __run) run_shards "$@" ;;
  status) status_run ;;
  wait) wait_run ;;
  stop) stop_run ;;
  help|-h|--help) usage ;;
  *) usage; exit 2 ;;
esac
