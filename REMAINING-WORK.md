# Remaining Work Ledger

Status: 2026-10-30 · closure batch on `1a2b5a9` · `npm run verify` green (fast 9/9, 113 proof files,
110 proofs-stage steps, 4 smoke steps).

Purpose: one list of every open or partially closed item in `SCRIPT-PARITY.md`,
`VERIFICATION-20261026.md`, `ISSUES.md`, `SHARED.md`, `PLAN-DB-INSTALL.md`,
`RECOVERY-20261025.md`, `PLAN.md`, and the adjacent registers. Every row carries
the source anchor, the state verified on disk at the closure batch on `1a2b5a9`, the closure
action, and the evidence that closes it.

Rules for this file:

- `SHARED.md` is frozen. Its entries are dispositioned, never edited.
- `docs/FUTURE-WORK-PLAN.md` is another session's uncommitted work. It is read
  and measured here, never edited or committed from this ledger.
- A row marked `decision` cannot close without an owner answer.
- A row marked `doc` changes wording only; the code or proof already exists.
- No row is invented: each one points at a source anchor or at a measured
  discrepancy recorded in section J.

## 0. Verified state

| Fact | Value | Anchor |
| --- | --- | --- |
| Open register entries | 0 | `ISSUES.md` headings |
| Pending decisions still listed open | 0 | `ISSUES.md` pending owner decisions |
| Product gaps open | 0 | `ISSUES.md` product-gap list |
| Partial verification verdicts | 0; `V-26` and `V-27` closed as bounded measurements | `VERIFICATION-20261026.md` resolution table |
| Resolved partial verdicts | 9 (`V-13`, `V-15`, `V-19`, `V-20`, `V-26`, `V-27`, `V-30`, `V-31`, `V-52`) | `VERIFICATION-20261026.md` resolution table |
| Shell scripts | 10 files, 3,586 lines; 6 carry comment lines | `scripts/*.sh` |
| Proof files | 113; 110 proofs-stage entries, `proof-catalog` in fast, 2 boot proofs in smoke | `scripts/gate-manifest.json` |
| SHARED parity ledger | 57 entries, 72 requirements: 45 verified, 0 anchored, 4 host-bound, 6 n-a, 2 doc-only, 0 partial | `docs/SHARED-PARITY.md` |
| SHARED closure batch | 2026-10-30 on `1a2b5a9`: `S-017`, `S-033`, and `S-053` verified by three new proofs (81, 39, and 50 assertions); 110 proofs-stage steps and 113 proof files | `docs/SHARED-PARITY.md` |
| Unit tests | no `tests/` directory | `ls tests` |
| Residue on disk | 10 `pre-refresh`, 12 `retired` (6 `.js` + 6 `.mjs`), 5 dist-only package dirs; owner-declined cleanup | Desktop scan, section C decision 3 |
| `@opencode/plugin` | 2.2.1 installed; no `session.form` surface | `node_modules/@opencode/plugin` |
| `/tmp/opencode` | owner and session scratch; `/tmp` is cleared on reboot, so no cleanup is needed | `ls /tmp/opencode` |

## A. Open defects

| ID | State | Verified evidence | Closure action | Evidence that closes it |
| --- | --- | --- | --- | --- |
| `E-30` | done 2026-10-29 | `src/services/apply-patch.ts` now compares with `path.relative` plus a separator, resolves the parent through the nearest existing ancestor, rejects a symlinked parent, target, or `.bak`, and writes the temp file inside the target directory with the target mode preserved | none | `prove-e30`: 31 assertions covering the sibling-prefix escape, symlinked parent, missing parent, temp-file location, atomic replace, mode preservation, and lock cleanup |
| `E-37` | done 2026-10-29 | `src/v2/types.ts` derives `V2ToolContext` from the host `ToolContext`, `V2Permission` from `PermissionDomain`, `V2Tool.hook` from `ToolDomain`, and `V2Session.hook` from `ModelHooks<SessionHooks>`; `signal` and `permission` are required, and `providerID` scoping is typed | none | `prove-e37`: 15 assertions for required fields, exact tool hook names, provider scope, and host declarations; gate step `e37` |
| `E-39` | done 2026-10-29 | `src/tools/web.ts` re-checks `metadata.sourceURL`, `metadata.url`, or a top-level `url`; `fetch` fails before content or cache, `map` drops private links, and `partitionCrawlDocs` fails closed when every page is blocked | none | `prove-web-ssrf`: 39 assertions covering pure helpers plus stubbed Firecrawl fetch, map, and crawl paths |

## B. Gate gaps

| ID | State | Verified evidence | Closure action | Evidence that closes it |
| --- | --- | --- | --- | --- |
| `E-40` | done 2026-10-29 | `AGENTS.md` now limits the comment ban to scanned `.ts`, `.mjs`, and `.json`; shell comments are explicitly allowed and must be English; six of ten scripts carry them | none | policy closure; `check-v2-rules` and `prove-rule-gate` still enforce comments and English on the scanned extensions, `check:sh` still parses shell |
| `E-41` | done 2026-10-29 | `docs/VALIDATION.md` records the proof harness as the unit harness; 113 files, 110 proofs-stage steps, one child process each; `prove-c03` 19, `prove-e12` 15, `prove-e14` 11, `prove-e19` 11 | none | documented decision; the catalog fails an unwired proof, and `prove-v2-compat` now asserts part preservation |

## C. Owner decisions and product gaps

| ID | State | Verified evidence | Decision needed | Work after the decision |
| --- | --- | --- | --- | --- |
| Decision `3` | declined by owner 2026-10-29 | On disk: 10 `tawassul.js.pre-refresh-*` in 5 workspaces, 12 `*.retired-20261024` (6 `.js` + 6 `.mjs`), 5 dist-only package dirs (`ciel-osk-workspace`, `dart22222222`, `vpro`, `vusial 2`, `vusual`). `tawassyl/.opencode/plugins/tawassul` is the read-only v1 tree. | none — the owner replaces the v1-loaded plugin in each project with v2 manually | no agent deletes files outside this tree; `doctor-v2.sh --scan-desktop` reports, never rewrites |
| Decision `8` (`D-05`) | resolved 2026-10-29 | `D-05` shipped the recommended shape: bounded census, 32-file cap, 14/14 baselines, `TAWASSUL_ALLOW_LEGACY_GROWTH=1`, the CLI namespace failed when it holds sessions, and no boot auto-move; `prove-d05` 28 assertions (`ISSUES.md:831-900`) | none — pending row marked resolved | none |
| `P-01` | done 2026-10-29 | Fail-closed shipped in `ccb2cb6`; `@opencode/plugin` 2.2.1 still exposes no `session.form` surface, while the host protocol has `session.form.*` | none — accept the fail-closed limitation | `E-03` records the limitation; `prove-v2-ask-bridge` asserts `select` and `multiselect` fail with a visible error |
| `P-02` | done 2026-10-29 | The dropped tombstone is the internal removal marker; `bumpTerminal` and replay count the prior terminal state, so a completed goal stays completed | none — accept the cosmetic label | `prove-goal-capture` asserts one completed count, zero dropped, and replay agreement after deleting a completed goal |
| `P-03` | done 2026-10-29 | `prove-n2-cap`: 500 messages and the exact 512 boundary record the oldest text part; 513 evicts the oldest; `done` stops the hook after the first record | none — keep the 512 pre-record buffer | gate step `n2-cap`, 7 assertions |

## D. Partial verification verdicts

| ID | State | Verified evidence | Closure action | Evidence that closes it |
| --- | --- | --- | --- | --- |
| `V-13` | done 2026-10-29 | Boot repair targets the project `opencode.json`/`jsonc` only; the global config gets the opt-out roster seed and is never permission-repaired; `prove-e02` leaves a stale global config byte-identical | none — documented project-only boundary | `E-02` scope paragraph, `UPSTREAM.md` boundary bullet, `VERIFICATION-20261026.md` resolution row, `prove-e02` 27 assertions |
| `V-26` | done 2026-10-29 | Initial probe skip is closed by the retry loop; one warning is emitted by the final budget | none — bounded measurement | `VERIFICATION-20261026.md` resolution table records the disposition |
| `V-27` | done 2026-10-29 | Measured worst case is `750 + 19 x 500 = 10,250 ms` plus probe latency; the current budget is 6 attempts (about 3 s) | none — bounded measurement | `B-02` proof and the same disposition note |
| `V-15`, `V-19`, `V-20`, `V-30`, `V-31`, `V-52` | resolved | Resolution table dated 2026-10-29 | none | `VERIFICATION-20261026.md:495-506` |
| `V-G` | done 2026-10-30 | Actions 1-6 and 8 landed (`C-01`, `B-06/B-07/B-09`, `P-01`, `D-04`, `D-01`, `P-07`, the five missing proofs); action 7 landed as `E-DOC-3` and `E-DOC-4`, whose corrections now sit at `ISSUES.md:3083-3088` | none — action 7 closed | the `E-DOC-3` and `E-DOC-4` rows; the correction lines name `E-07 / P-04` and `I-09` with their proofs |
| `V-36` | resolved | `D-03` deleted the five root leftovers; the root now holds only `opencode.json` and its two capped backups | none | `D-03` body |
| `V-37` | done 2026-10-30 | `E-10` is marked stale and no longer reads as current | none — folded into `E-DOC-4` | `E-DOC-4`; `ISSUES.md:1486` |

## E. Document truth

These rows change wording only. They close after sections A-D so the regenerated
numbers are final.

| ID | Document | Stale claim | Correction |
| --- | --- | --- | --- |
| `E-DOC-1` | `STABILITY.md` | was 108 entries, 24 open, HEAD `b4a0eb3` | done 2026-10-29: regenerated as 87 entries, 0 open, all tiers 0, current host and proof counts |
| `E-DOC-2` | `VERIFICATION-20261026.md` | `V-26`/`V-27` were `PARTIAL` without table rows | done 2026-10-29: both joined the resolution table as bounded measurements |
| `E-DOC-3` | `ISSUES.md:3083-3088` | said `E-07 / P-04` and `I-09` were unchanged | done 2026-10-29, anchor re-verified 2026-10-30 after line drift: both correction lines record the closure and the proof that closed them |
| `E-DOC-4` | `ISSUES.md:969-970,1139-1140,1244-1245,1486` | "green at 87 proofs"; old script counts; `E-10` cited a baseline HEAD as current | done 2026-10-30: 110 proofs-stage steps, 113 proof files, 10 shell scripts with 6 commented, and the two historical 83/87-proof baselines stay labeled as baselines while `E-10` is marked stale |
| `E-DOC-5` | `ISSUES.md:2038-2078` | decision 4 said `/tmp/opencode` is empty; decision 3 counts were 12/14/6 | done 2026-10-29: decision 4 records scratch reuse; decision 3 records the measured 10/12/5 and the owner's refusal |
| `E-DOC-6` | `SCRIPT-PARITY.md:29` | summary row conflicted with the header | done 2026-10-29: renamed to "Out of scope (support/measurement)" |
| `E-DOC-7` | `RECOVERY-20261025.md:95,160` | H-07 hazard and doctor orphan read as current | done 2026-10-29: the `H-02` hazard line and the doctor line are historical; the probe directory is owner scratch |
| `E-DOC-8` | `UPSTREAM.md:89,109-114` | three rows `tracked`; release ledger counts wrong | done 2026-10-29: `E-45`/`E-46` aligned, `E-44` stays tracked for the live check, registry and doc rebuilt to 30/24 items, both releases `partial` |
| `E-DOC-9` | `DECOUPLING.md:11,22,85` | seed "to be implemented", 21 names | confirmed 2026-10-29: `npm run seed:agents`, 8 bases, 3 variants, 35 names; `F-3` verifies the seed |
| `E-DOC-10` | `PLAN.md:261`, `CUTOVER.md` | Day-6 25-proof lines | confirmed 2026-10-29: both are marked historical; no line reads as current |
| `E-DOC-11` | `AGENTS.md:76`, `README.md:118` | 97 proofs | done 2026-10-30: both read 110 proofs, matching the pinned count |
| `E-DOC-12` | `SHARED.md` | stale frozen headings, six host-bound | done 2026-10-30: `docs/SHARED-PARITY.md` holds 57 entries and 72 requirements, 45 verified and zero anchored; host-bound is four, not six |
| `E-DOC-13` | `PLAN.md:325` | 2.2.0 bump read as pending | done 2026-10-29: delivered on `^2.2.1`, with the v2.2.1 audit in `UPSTREAM.md` |
| `E-DOC-14` | `VERIFICATION-20261026.md:893-905` | six host-bound entries including `S-044`/`S-047` | done 2026-10-29: four host-bound (`S-042`, `S-046`, `S-048`, `S-051`); `S-044`/`S-047` moved to the 2026-10-29 closed row |

## F. Cleanup

| ID | State | Verified evidence | Action |
| --- | --- | --- | --- |
| `F-1` | declined by owner 2026-10-29 | 10 pre-refresh, 12 retired, and 5 dist-only dirs outside this tree | keep; the owner replaces the v1 plugin in each project with v2 |
| `F-2` | documented 2026-10-29 | `/tmp/opencode` holds owner scratch (logos, art) plus probe scripts and type dumps; `/tmp` clears on reboot | not an agent cleanup target; decision 4 records the reuse |
| `F-3` | done | `DECOUPLING.md` now describes `npm run seed:agents`, the 8 bases, and the 3 manual variants; `.opencode/agents` has 11 files and `deleted-agents.json` has 35 names | closed 2026-10-29: `prove-seed-agents` proves a fresh seed, manual-file preservation, force behavior, and the 8-base inventory |

## G. Deferred, host-bound, or outside this tree

| ID | State | Anchor | Rule |
| --- | --- | --- | --- |
| `G-1` | measured 2026-10-29, not adopted | `docs/FUTURE-WORK-PLAN.md` remains modified and uncommitted by its owner; measured against the closure batch it says 92 proof files / 91 steps (now 113/110), installer verify at lines 479-518 (now `install-global.ts:1108`), doctor range at 548-556 (now `doctor-v2.sh:639-641`); launcher 210-213, installer 22-23, registry 3-9 still match; section 6 carries its four own forks (Wave 1b prevention, gemini slot, fork/rewind, record title duplication) | do not edit or commit this file; the measured corrections stay in this ledger |
| `G-2` | host-bound | `SHARED.md` `S-042`, `S-046`, `S-048`, `S-051`; `PLAN-DB-INSTALL.md` F1 | mitigated plugin-side; the host contract is open; no repo action |
| `G-3` | host-bound | `UPSTREAM.md:136-150` follow-ups 1, 4, 5, 6, 7 | `E-43` live check, fork/revert, compaction payload, `session.instructions.entry`, host-level `execute` deny; assess on the next host release |
| `G-4` | declined | `ISSUES.md:287` `I-01` | the owner declined a real global install on 2026-10-29; isolated-HOME validation stands |
| `G-5` | observation | `PLAN-DB-INSTALL.md` F14 | host 2.2.0 holds 0 `event` rows; the write path is undetermined; no repo action unless the host changes |
| `G-6` | binding | `ISSUES.md:26-34` bash permission is off-limits | no guard fix may edit a `bash` permission entry; guard code may refuse a specific command |
| `G-7` | binding | `ISSUES.md:35-47` D-00: v1 is retired permanently | no v1 entry, host, or dependency may return; two hosts only in isolated tests |

## H. Closure order

1. Decision 3 — resolved 2026-10-29: the owner replaces the v1-loaded plugin
   in each project with v2; no agent deletes files outside this tree.
2. `F-1`-`F-3` cleanup — `F-1` declined, `F-2` documented, `F-3` done.
3. `E-DOC-1`-`E-DOC-14` regeneration — done 2026-10-29.
4. `G-1` re-measure — done 2026-10-29: 105 files / 102 steps at that batch (the 2026-10-30 batch moved the totals to 113 files / 110 steps), installer
   verify at 1108, doctor range at 639-641; the file stays uncommitted by its
   owner.
5. SHARED closure batch — done 2026-10-30 on `1a2b5a9`: `prove-s017`
   (81 assertions), `prove-s033` (39), and `prove-s053` (50) passed, the
   manifest holds 110 proofs-stage steps, and the parity ledger reads 45 of
   57 entries verified with zero anchored.

`E-30`, `E-37`, `E-39`, `E-40`, and `E-41` closed, decision 8 resolved,
`V-13` closed as a documented project-only boundary, and `P-01`-`P-03`
resolved, on 2026-10-29.

After each batch: `npm run verify`; after a proof batch: update
`scripts/gate-manifest.json` and `scripts/prove-proof-catalog.ts` in the same
commit.

## I. Coverage matrix

| Source | Open or partial items found | Ledger rows | Status |
| --- | --- | --- | --- |
| `ISSUES.md` | 0 open register entries, decision 3 declined by the owner (decision 8 resolved), product gaps 0, corrections, standing decisions | Decision 3, `E-DOC-3`..`E-DOC-5`, `G-6`, `G-7` | covered |
| `VERIFICATION-20261026.md` | `V-13`, `V-26`, `V-27`; nine resolved partials; `V-36`/`V-37`; eight next actions; SHARED audit count | `V-13` (resolved as a boundary), `V-26`, `V-27`, `V-15`/`V-19`/`V-20`/`V-30`/`V-31`/`V-52`, `V-G`, `V-36`, `V-37`, `E-DOC-2`, `E-DOC-12`, `E-DOC-14` | covered |
| `SCRIPT-PARITY.md` | 4 out-of-scope rows and the summary label | `E-DOC-6` | covered |
| `PLAN-DB-INSTALL.md` | P0-P7 closed; F14 observation; F20/F24/F25/F27/F32 fixed | `G-5` | covered |
| `RECOVERY-20261025.md` | historical status; H-07 hazard and orphan cwd now marked historical | `E-DOC-7` | covered |
| `PLAN.md` | P2 backlog closed; deferred upstream docs; Day-6 historical; 2.2.1 bump delivered | `E-DOC-10`, `E-DOC-13`, `G-3` | covered |
| `TRIAGE.md` | 97 proof steps and the Day-4 exit | `E-DOC-10` | covered; `TRIAGE.md` is historical, the current count is 110 |
| `CUTOVER.md` | Day-6 25-proof lines | `E-DOC-10` | covered |
| `docs/CI-TRANSCRIPT.md` | committed stage transcript | `E-DOC-11` | covered; no action |
| `SHARED.md` | 57 frozen entries; four host-bound; stale frozen headings | `E-DOC-12`, `E-DOC-14`, `G-2`; `docs/SHARED-PARITY.md` is the per-entry disposition | covered; the ledger is gate-enforced |
| `STABILITY.md` | 24-open snapshot | `E-DOC-1` | covered; regenerated as 87 entries and 0 open |
| `UPSTREAM.md` | release ledger, tracked rows, open follow-ups | `E-DOC-8`, `G-3` | covered |
| `DECOUPLING.md` | seed step, fresh-clone check, deleted-agent count | `E-DOC-9`, `F-3` | covered |
| `docs/FUTURE-WORK-PLAN.md` | 92/91 proof count, installer and doctor anchors, section 6 forks | `G-1` | measured; the owner keeps the file uncommitted |
| `AGENTS.md`, `README.md` | 97 proofs | `E-DOC-11` | covered; both read 110 proofs now |

## J. Audit log and measured discrepancies

Commands used: heading census, table greps, `git status`, `git log`, `ls` and
bounded `find` over the six named workspaces, `node -e` on
`scripts/gate-manifest.json`, and `wc -l scripts/*.sh`.

Measured discrepancies against the source documents:

1. Residue is 10 `pre-refresh` files and 12 `retired` files (6 `.js` + 6
   `.mjs`), not 12 and 14. The sixth inert package dir (`athan new vrsion`)
   has no `.opencode`; only five remain.
2. `E-40` said seven scripts; there are ten, and six carry comments. The entry now records the policy exemption.
3. `E-41` said 32 proof scripts; the entry now records 113 files and 110 proofs-stage steps.
4. Two `ISSUES.md` bodies now record the 87-proof baseline as historical and
   name the current 110 proofs-stage steps.
5. Pending decision 4 said `/tmp/opencode` is empty; it is now owner scratch and `/tmp` clears on reboot, so no cleanup is needed.
6. Pending decision 8 is resolved; its row now records the shipped D-05 shape.
7. `V-13` closed as a documented project-only boundary; the global config is never permission-repaired.
8. `DECOUPLING.md` now records the 35 names the user-owned file carries; the
   inventory matches the on-disk list.
9. `FUTURE-WORK-PLAN.md` says 92/91 and cites doctor lines 548-556 and
   installer lines 479-518; the current anchors are `doctor-v2.sh:639-641`
   and `install-global.ts:1108`.
10. `@opencode/plugin` 2.2.1 still has no `session.form` surface, so `P-01`
    stays upstream-blocked.
11. `SHARED.md` carries an explicit `v2 status` line for only 14 of 57 entries,
    and 15 headings still read `REQUIRED`, `PARTIALLY IMPLEMENTED`, or `NOTE`.
    `docs/SHARED-PARITY.md` now dispositions all 57 entries as 72 requirements
    with zero anchored; the frozen file is untouched and the ledger check runs
    in `gate:fast`.

12. The 2026-10-30 closure batch moved the snapshot from 105/102 to 113/110
    proof files and steps, and from 34/21 to 45/0 verified/anchored. The status
    line and totals were refreshed, and the `E-DOC-3`/`E-DOC-4` anchors were
    re-measured after line drift.
