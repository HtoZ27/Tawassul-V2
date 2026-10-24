# Development Rules — prevent host freezes

These rules are mandatory. They replace the retired v1 rules file.

## Memory cap: 1.5GB available

If available memory drops below 1.5GB, stop and clean up before continuing.
Running a heavy command under the cap can freeze OpenCode and the machine.

Check before every heavy step:

```
free -m | awk '/^Mem:/ {print $7}'
```

## Rule 1 — measure before heavy work

Do not start `npm test`, `tsc`, a build, or a lint run while `MemAvailable`
is below 1500 MB. Free memory first.

## Rule 2 — clean temporary files after every run

Temporary test and boot artifacts must not accumulate:

```
rm -rf /tmp/opencode/*
```

Remove task-specific scratch directories in a `finally` block or an `EXIT`
trap so cleanup runs even when the command fails.

## Rule 3 — heavy operations are sequential

Light operations may run in parallel:

- agent calls (remote, no local memory cost)
- reads, greps, globs, web fetches

Heavy operations must run one at a time:

- `npm test`, `tsc`, lint, build, release smoke
- file writes and edits
- `Promise.all` / `Promise.allSettled` over heavy local work

## Rule 4 — failure means cleanup

After a failure, clean twice: temporary directories, rejected state copies,
scratch databases, and boot logs. A failed heavy command that leaves work
behind is a leak, not a completed step.

## Rule 5 — one plugin copy

This tree is the only runnable Tawassul plugin. Do not run, build, or
re-enable the retired v1 tree. Its state is reference-only and must never be
copied into v2.
