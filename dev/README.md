# Development record

This folder holds the development record of Tawassul V2: repair plans, audits,
host evaluations, live end-to-end records and working drafts. None of it is
published. The public tree is built from the allow-list in
`scripts/release/public-files.json`, and every file in this folder is declared
internal there.

`docs/` carries the shipped documentation. Four internal documents remain in
`docs/` because a gate or proof reads them by path:

| Document | Reader |
| --- | --- |
| `docs/CI-TRANSCRIPT.md` | `scripts/gate.ts` |
| `docs/SHARED-PARITY.md` | `scripts/check-shared-parity.ts` |
| `docs/portable-context-handoff.md` | `scripts/generate-proof-count.ts` |
| `docs/plan-token-burn-control.md` | `scripts/prove-usage-shadow.ts` |

## Tracked records

| Document | What it is | Outcome |
| --- | --- | --- |
| `E2E-THREAD-2026-10-31.md` | Live end-to-end record of the portable context handoff | PASS on 2026-10-31, host 2.2.2 |
| `REPAIR.md` | Wave record of the in-place V2 repair | Waves 0-4 closed; the release track moved to the release plan |
| `STATE-ROOT-DESIGN.md` | State-root naming key | Approved and implemented 2026-11-01 |
| `UPSTREAM-EVAL-2.2.3-2.2.5.md` | Host evaluation across 2.2.3 to 2.2.5 | Findings live in `ISSUES.md` and `UPSTREAM.md` |
| `historical-plan-first-install-db-repair.md` | First-install database contract analysis | Proposed, never executed; kept as the analysis record |
| `plan-agent-visibility-2026-11-14.md` | Constructed agent list during reload | See the document header for the final state |
| `plan-dispatch-defects-2026-11-13.md` | Host 2.2.6-2.3.0 dispatch defects | Phases 0-4 complete; phase 5 open and deferred |
| `plan-freeze-hardening-2026-11-15.md` | Host freeze hardening | See the document header for the final state |
| `plan-goal-ledger-truth.md` | Goal ledger counting and migration | Implemented; goal G-008 verified |
| `plan-intelligence-continuity.md` | Shared project intelligence and continuity | Implemented; goal G-008 verified |
| `plan-orientation-channel-2026-11-15.md` | Orientation channel | Shipped 2026-11-15; the orientation skill was withdrawn by its probe |
| `plan-report-path-to-tawa.md` | Report path to the coordinator | Shipped; covered by the report-path proof |
| `plan-runtime-npm-free.md` | Runtime npm-free checks | Shipped; the project checks run without npm |

The headers of the older documents carry their own revision status and should be
read with the outcome column above, because several headers still say "draft"
or "await approval" for work that has since landed.

## Local-only drafts

These files are gitignored on purpose: they are working documents that the
repository does not track.

| Document | State |
| --- | --- |
| `RELEASE-0.1.0-PLAN.md` | Active; drives goal G-006, work packages 13 and 14 remain |
| `FUTURE-WORK-PLAN.md` | Closed 2026-11-01; G-005 verified |
| `continuity-brief-v1.md` | Superseded by the continuity plan |
| `plan-npm-parity-draft.md` | Draft v4; goal G-010 has not started |
| `tawassul-v2-code-first-plan.md` | Commits 0, A and B landed (`db589b1`, `ee287ec`, `860a8cf`) |
| `tawassul-v2-minimal-fix-plan.md` | Frozen 2026-11-09; historical record |
| `tawassul-v2-fix-plan.md` | Reference only; superseded on 2026-11-08 |

## Where the durable outcomes live

- Product behavior and guarantees: the documents under `docs/`.
- Open and closed work: the goal ledger, records and handoff ledger.
- Project rules: `AGENTS.md` and `RULES.md`.
- Release scope: `RELEASE-0.1.0-PLAN.md` in this folder.
