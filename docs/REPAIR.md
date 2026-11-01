# REPAIR — Tawassul V2 wave record

- Status: Waves 0, 1a, 2, 3 and 4 closed; release track open
- Last revised: 2026-11-01
- Scope: the in-place repair of the running V2 tree. The sibling-tree alternative is
  cancelled, not deferred, and no V3 fork exists.

This document is the repository-side record of the repair programme. The working
register `docs/FUTURE-WORK-PLAN.md` is never committed by design; wave closures
live in the goal ledger and here. Receipts live under `docs/experiments/receipts/`.

## 1. Corrected measured baseline

Every value was measured against the committed tree, not estimated. Values that
were wrong in earlier planning are recorded with their correction.

| Item | Measured value | How it is checked |
| --- | --- | --- |
| Registered tools | 44 | generated name-set hash plus coarse floor (`scripts/prove-tool-name-hash.ts`) |
| Tool description text | 16,147 bytes, down from 20,267 (−4,120, −20.329%) | `scripts/prove-context-diet.ts`, 37 assertions |
| Schema payload | 13,868 bytes | measured separately, never substituted for description text |
| System concordance | 881 bytes, injected once per session | `scripts/prove-context-baseline.ts` |
| Registered skills | 4, 376 description bytes in total | `skills/manifest.json`, `scripts/prove-skills-manifest.ts` |
| Shipped commands | 1 (`tawassul-goals`) | `scripts/prove-pilot-eval.ts` |
| i18n table | 42,754 bytes, bundle weight only | never injected into the model context |
| Proof scripts | 156 files, 153 manifest steps | `scripts/generate-proof-count.ts --check` |
| Full proof stage | 301,221 ms in one process; four balanced shards at about 83 s each | `scripts/proof-shards.json` |
| Hot-tool retries | top-8 at the frozen zero | `scripts/prove-context-diet.ts` |
| State root | `v2DataRoot()/projects/<key>/`, 14 `state:` keys migrated | `scripts/prove-state-root-rollback.ts`, 74 assertions |
| Installer ledger | 12 files, bundle plus 4 wasm plus 5 db plus marker | `scripts/prove-global-install.ts`, 188 assertions |

Corrections applied: the 29 KB per-message concordance figure was wrong (measured
once-per-session weight); i18n slimming is not a context gain; the host policy is a
floor at 2.2.0 with an informational audited constant, not a range with a 3.x
refusal.

## 2. Wave verification matrix

| Wave | Delivered | Proofs in `gate-manifest.json` | Evidence |
| --- | --- | --- | --- |
| 0 — measurement floor | tool-run ranking, context baseline, read-time record dedupe, dispatch provider/model, generated name-set hash, generated proof count | `prove-tool-run-ranking`, `prove-context-baseline`, `prove-tool-name-hash`, `prove-record-digest-dedupe`, `prove-dispatch-model` | dated baselines under `docs/experiments/baselines/` |
| 1a — pilot content | four skills and one command registered in-process, manifest, markdown gate, light eval | `prove-skills-manifest`, `prove-skill-registration`, `prove-md-gate`, `prove-pilot-eval` | `2026-10-31-e1.md`, `2026-11-01-integration-engineer-eval.json`, `evals.json` |
| 2 — gated context diet | 4,120 description bytes cut against a frozen 16,213-byte target, minimum-inline contract, hot-tool retry closure, live reload probe | `prove-context-diet`, `prove-constraint-retention`, `prove-reload-live` | `2026-11-01-wave2-context-diet.md`, `2026-11-01-wave2-retries.json` |
| 3 — structural guards | host-identity state root, boot-time sync with backup, journal and conflict archive, rollback, worktree guard, auto-capture opt-in, reachability audit | `prove-state-root-survival` (44), `prove-state-root-rollback` (74), `prove-snapshot-boundary` (8), `prove-reachability-audit` (13) | `2026-11-01-wave3-state-root.md`, `2026-11-01-wave3-closeout.md`, `docs/STATE-ROOT-DESIGN.md` |
| 4 — behavioral gate | `gate:evals` with the D5 budget, dispatch payload join key, review-independence retro-probe, skill load-rate and discovery probes | `prove-review-independence-retro` (19), `prove-skill-load-rate` (50), `prove-skill-discovery` (40), `prove-gate-budget` (9); the eval stage is pinned by `prove-proof-catalog` | `2026-11-01-wave4-behavioral-gate.md`, `2026-11-01-e5-eval-budget.md` |

## 3. State-root decision and migration window

The project-scope key is the host `location.project.id`, sanitized; the fallback
order is `project.canonical`, then `project.directory`, then the working
directory, and the `global` sentinel is treated as no-project. The host id was
probed against a main checkout, a `git worktree`, a separate clone, a no-git
directory and a symlink: the first three share one id and the last two get
distinct path-derived ids.

Configuration never moves. `stateDir` stays the workspace, so `opencode.json(c)`,
`.opencode/tawassul.json(c)`, agents, skills and pins keep their paths. Only
persistence moves to `v2DataRoot()/projects/<key>/`.

Migration runs once per boot, synchronously, before the context is built:

1. the legacy workspace state is backed up under the project root;
2. missing entries are copied and recorded in a per-file index;
3. every run appends to `migration.jsonl`;
4. a conflict archives the legacy bytes under `backup/conflicts/<timestamp>/`,
   records `winner: project`, and does not re-fire once settled;
5. no merge is implemented by design.

The window is the boot that follows the first project-scope start. Rollback is
`TAWASSUL_STATE_ROOT=legacy`, which reads and writes the workspace store and never
touches the project root; `TAWASSUL_STATE_DIR` still preserves isolated runs. The
first live migration ran on 2026-11-01 with 14 `state:` keys, a byte-identical
handoff ledger, a 192-event goal ledger against 188 legacy events, and an exact
`sagas`/`metrics` match.

## 4. Experiment decisions

| Gate | Experiment | Decision | Receipt |
| --- | --- | --- | --- |
| D1 | E1 | Keep three skills and one command; frozen description target 16,213 bytes; 91–100 bytes per skill description with a clarity review; no shipped-skill opt-out; Wave 1b stays option A. The owner added a fourth skill, `tawassul-integration-engineer`, on 2026-11-01; its 91-byte description stays inside the same band and its own eval covers it | `2026-10-31-e1.md`, `2026-11-01-integration-engineer-eval.json` |
| D2 | E2 | Retired with the ceiling policy; no host matrix, no receipt by design; the state-schema guard is covered by the Wave 3 rollback proof | plan section 11 |
| D3 | E3 | Host project identity as the key, canonical-path fallback, boot-time sync, conflict archive, rollback, HMAC continuity | `2026-11-01-wave3-state-root.md` |
| D4 | E4 | The installer marker is the owner ledger (path plus sha256 per owned file); uninstall removes only marker-listed files and keeps user skills and commands; skills ship inside the bundle; project scope stays the default | `2026-11-01-e4-installer-ledger.md` |
| D5 | E5 | `gate:evals` capped at 90 s and 256 MB with no retries; model pair is the roster `dev` against the reviewer, and the observed live pair `build` against `plan`; Wave 1b stays option A; Wave 4 adds the payload join key | `2026-11-01-e5-eval-budget.md` |

## 5. Withdrawn claims

| Claim | Status |
| --- | --- |
| Durable state across a working-directory change | withdrawn until Wave 3; now proven for project scope by `prove-state-root-survival` and the live migration |
| Session forensics as a new capability | not claimed; documented as a reading path over timeline, handoff ledger and the tawassul log |
| i18n slimming as a context-diet gain | excluded from the context budget; reported as bundle weight only |
| The 29 KB per-message concordance figure | corrected to the measured once-per-session weight |
| A skill gate guard enforced skill use | the guard was a warning-only logger and was retired; no warning-only logger ships in its place |
| A per-file skills ledger in the installer | not built: skills are compiled into the bundle and covered by the bundle sha256 and `contentSha` |
| `agentModelMap` as proof of reviewer independence | rejected: last-writer-wins; the retro-probe reads the per-turn tool-run model instead |
| Host compatibility as a tested matrix | not claimed: the policy is a floor with release-smoke and host refresh coverage |

## 6. Open items

- Release track: `0.1.0-experimental` verification and distribution, including any
  real global install, which D4 defers to that track.
- The working register `docs/FUTURE-WORK-PLAN.md` stays unversioned by owner decision.
