# Remaining Work Ledger

Status: 2026-10-29 · HEAD `4258815` · `npm run verify` green (fast 9/9, 104 proof files,
101 proofs-stage steps, 4 smoke steps).

Purpose: one list of every open or partially closed item in `SCRIPT-PARITY.md`,
`VERIFICATION-20261026.md`, `ISSUES.md`, `SHARED.md`, `PLAN-DB-INSTALL.md`,
`RECOVERY-20261025.md`, `PLAN.md`, and the adjacent registers. Every row carries
the source anchor, the state verified on disk at HEAD `4549760`, the closure
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
| Open register entries | 2 (`E-40`, `E-41`) | `ISSUES.md` headings |
| Pending decisions still listed open | 1 real (`3`); `8` is implemented in code and stale in the list | `ISSUES.md:2038-2078` |
| Product gaps open | 3 (`P-01`, `P-02`, `P-03`) | `ISSUES.md:1246-1261` |
| Partial verification verdicts | 3 (`V-13`, `V-26`, `V-27`) | `VERIFICATION-20261026.md:283,427,438` |
| Resolved partial verdicts | 6 (`V-15`, `V-19`, `V-20`, `V-30`, `V-31`, `V-52`) | `VERIFICATION-20261026.md:495-506` |
| Shell scripts | 10 files, 3,586 lines; 6 carry comment lines | `scripts/*.sh` |
| Proof files | 104; 101 proofs-stage entries, `proof-catalog` in fast, 2 boot proofs in smoke | `scripts/gate-manifest.json` |
| SHARED parity ledger | 57 entries, 70 requirements: 34 verified, 21 anchored, 4 host-bound, 9 n-a, 2 doc-only, 0 partial | `docs/SHARED-PARITY.md` |
| Unit tests | no `tests/` directory | `ls tests` |
| Residue on disk | 10 `pre-refresh`, 6 `retired` `.js`, 5 dist-only package dirs | Desktop scan, section C decision 3 |
| `@opencode/plugin` | 2.2.1 installed; no `session.form` surface | `node_modules/@opencode/plugin` |
| `/tmp/opencode` | 5 artifacts from recent proofs | `ls /tmp/opencode` |

## A. Open defects

| ID | State | Verified evidence | Closure action | Evidence that closes it |
| --- | --- | --- | --- | --- |
| `E-30` | done 2026-10-29 | `src/services/apply-patch.ts` now compares with `path.relative` plus a separator, resolves the parent through the nearest existing ancestor, rejects a symlinked parent, target, or `.bak`, and writes the temp file inside the target directory with the target mode preserved | none | `prove-e30`: 31 assertions covering the sibling-prefix escape, symlinked parent, missing parent, temp-file location, atomic replace, mode preservation, and lock cleanup |
| `E-37` | done 2026-10-29 | `src/v2/types.ts` derives `V2ToolContext` from the host `ToolContext`, `V2Permission` from `PermissionDomain`, `V2Tool.hook` from `ToolDomain`, and `V2Session.hook` from `ModelHooks<SessionHooks>`; `signal` and `permission` are required, and `providerID` scoping is typed | none | `prove-e37`: 15 assertions for required fields, exact tool hook names, provider scope, and host declarations; gate step `e37` |
| `E-39` | done 2026-10-29 | `src/tools/web.ts` re-checks `metadata.sourceURL`, `metadata.url`, or a top-level `url`; `fetch` fails before content or cache, `map` drops private links, and `partitionCrawlDocs` fails closed when every page is blocked | none | `prove-web-ssrf`: 39 assertions covering pure helpers plus stubbed Firecrawl fetch, map, and crawl paths |

## B. Gate gaps

| ID | State | Verified evidence | Closure action | Evidence that closes it |
| --- | --- | --- | --- | --- |
| `E-40` | open, P3 | `scripts/check-v2-rules.mjs` scans only `.ts`, `.mjs`, `.json`; 6 of 10 shell scripts carry comments (maintenance 141, iso 48, guard 37, scorecard 22, scheduled 5, smoke 3) | Extend the checker to `.sh` with the same directive allow-list and strip the existing headers, or declare the exemption explicitly in `AGENTS.md` | `prove-rule-gate` shell cases: a real comment fails, an approved directive passes, a glued prefix fails |
| `E-41` | open, P3 | no `tests/`; E-41 text says 32 proof scripts while the tree has 104 files and 101 steps | Invert assertions that encode defects; add focused unit cases for `C-03`, `E-12`, `E-14`, `E-19`; fix the stale count in the entry | a unit runner wired into the fast gate, or a documented proof-based unit harness with the four named cases |

## C. Owner decisions and product gaps

| ID | State | Verified evidence | Decision needed | Work after the decision |
| --- | --- | --- | --- | --- |
| Decision `3` | decision | On disk: 10 `tawassul.js.pre-refresh-*` in 5 workspaces, 6 `tawassul.js.retired-20261024`, 5 dist-only package dirs (`ciel-osk-workspace`, `dart22222222`, `vpro`, `vusial 2`, `vusual`). `athan new vrsion` has no `.opencode`; the doc's 12/14/6 counts are stale. `tawassyl/.opencode/plugins/tawassul` is the read-only v1 tree, not an inert dist dir. | Delete the 16 files and 5 dirs, or keep them | delete, rerun `doctor-v2.sh --scan-desktop`, and assert zero residue in the existing scan proof |
| Decision `8` (`D-05`) | doc | `D-05` is implemented and proven: bounded census, 32-file cap, 14/14 baselines, `TAWASSUL_ALLOW_LEGACY_GROWTH=1`, `prove-d05` 28 assertions (`ISSUES.md:831-900`) | Confirm the implemented shape stays | mark the pending row resolved; no code change |
| `P-01` | decision | Fail-closed shipped in `ccb2cb6`; `@opencode/plugin` 2.2.1 exposes no `session.form` surface, while the host protocol has `session.form.*` | Accept the fail-closed limitation, or fund a direct protocol client | either document the limitation beside `E-03`, or build and prove the client |
| `P-02` | decision | `src/services/goal-store.ts:102` allows `completed -> dropped`; counts stay correct, the label is cosmetic | Accept the label, or write `completed` for a completed-origin close | one-line state choice plus a digest assertion |
| `P-03` | decision | `src/hooks/n2-auto.ts:43` caps the set at 512 and evicts the oldest | Measure a 500-message session first, then raise the cap or evict by age | measurement note plus the chosen cap and a proof of the miss rate |

## D. Partial verification verdicts

| ID | State | Verified evidence | Closure action | Evidence that closes it |
| --- | --- | --- | --- | --- |
| `V-13` | partial | Project config is repaired at boot (`plugin-init.ts:468`, `opencode-config.ts:400`); the global config gets only a roster seed (`opencode-config.ts:509`), never the permission repair | Decide whether the global config is in scope; if yes, extend boot repair; if no, document the project-only boundary | `prove-e02` extension or a documented limitation in `E-02` and `UPSTREAM.md` |
| `V-26` | partial, bounded | Initial probe skip is closed by the retry loop; one warning is emitted by the final budget | No code action; keep the bounded-measurement note | `VERIFICATION-20261026.md:508-509` already records the disposition |
| `V-27` | partial, bounded | Measured worst case is `750 + 19 x 500 = 10,250 ms` plus probe latency; the current budget is 6 attempts (about 3 s) | No code action; the label is historical | `B-02` proof and the same disposition note |
| `V-15`, `V-19`, `V-20`, `V-30`, `V-31`, `V-52` | resolved | Resolution table dated 2026-10-29 | none | `VERIFICATION-20261026.md:495-506` |
| `V-G` | partial | Actions 1-6 and 8 landed (`C-01`, `B-06/B-07/B-09`, `P-01`, `D-04`, `D-01`, `P-07`, the five missing proofs); action 7 (register corrections) remains as `E-DOC-3` and `E-DOC-4` | close `E-DOC-3/4` | the named register headings and proofs |
| `V-36` | resolved | `D-03` deleted the five root leftovers; the root now holds only `opencode.json` and its two capped backups | none | `D-03` body |
| `V-37` | doc | `E-10` still cites baseline HEAD `d740865` | fold into `E-DOC-4` | `E-DOC-4` |

## E. Document truth

These rows change wording only. They close after sections A-D so the regenerated
numbers are final.

| ID | Document | Stale claim | Correction |
| --- | --- | --- | --- |
| `E-DOC-1` | `STABILITY.md` | 108 entries, 24 open, S0=1, S3=2, S4=3, HEAD `b4a0eb3` | regenerate: 2 open, both P3 (`E-40`, `E-41`), current HEAD |
| `E-DOC-2` | `VERIFICATION-20261026.md` | `V-26`/`V-27` still labeled `PARTIAL` without table rows | add both to the resolution table as bounded measurements, or relabel them closed-as-measured |
| `E-DOC-3` | `ISSUES.md:2903-2910` | says `E-07 / P-04` and `I-09` are unchanged | both closed 2026-10-29 (`P-04` done, `I-09` done); replace the correction lines |
| `E-DOC-4` | `ISSUES.md:1135,1240,2879,2887` | "green at 87 proofs"; "seven scripts"; "32 proof scripts"; `E-10` cites baseline HEAD `d740865` | 101 proofs-stage steps; 10 shell scripts, 6 with comments; 104 proof files; mark `E-10` as historical |
| `E-DOC-5` | `ISSUES.md:2038-2078` | decision 4 says `/tmp/opencode` is empty; decision 8 says open; decision 3 counts 12/14/6 | 5 artifacts exist; decision 8 implemented; residue is 10/6/5 dirs |
| `E-DOC-6` | `SCRIPT-PARITY.md:29` | summary row "Missing (support/measurement only) 4" conflicts with the header that calls the four rows out of scope, not defects | rename the row to "Out of scope (support/measurement)" |
| `E-DOC-7` | `RECOVERY-20261025.md:95,160` | "Remaining hazard: bun-installed v1 binary (H-07)"; doctor orphan cwd `/tmp/opencode/smoke-probe` | mark both historical; `H-07` is done and the path is not a live hazard |
| `E-DOC-8` | `UPSTREAM.md:89,109-114` | version ledger status `partial`; `#58331`, `#58866`, `#58817` still `tracked` | `E-46`, `E-44`, `E-45` are fixed; move the rows to aligned and set the release status accordingly |
| `E-DOC-9` | `DECOUPLING.md:11,22,85` | deleted-agents seed "to be implemented", 21 names | done 2026-10-29: the inventory names `npm run seed:agents`, the 8 bases, the 3 manual variants, and the 35 user-owned deleted names; `F-3` verifies the seed output |
| `E-DOC-10` | `PLAN.md:261`, `CUTOVER.md` | Day-6 25-proof lines | already marked historical; confirm no line reads as current |
| `E-DOC-11` | `AGENTS.md:72`, `README.md:102` | 97 proofs | done 2026-10-29: both read 101 proofs, matching the pinned proofs-stage count |
| `E-DOC-12` | `SHARED.md` | 57 frozen entries; `S-042`, `S-046`, `S-048`, `S-051` are host-bound; several frozen headings still read `REQUIRED`, `NOT implemented`, or `PARTIALLY IMPLEMENTED` | no edit; `docs/SHARED-PARITY.md` now holds one row per entry (70 requirements) with an anchor, a proof, and a status, and `gate:fast` rejects a `partial` row without an `ISSUES.md` entry. `E-DOC-14` is superseded: the ledger derives four host-bound entries from the code |
| `E-DOC-13` | `PLAN.md:325` | "Next: bump the dev dependency to `@opencode/plugin` 2.2.0" reads as pending | the dependency is `^2.2.1`, audited through v2.2.1; mark it delivered |
| `E-DOC-14` | `VERIFICATION-20261026.md:893-905` | the audit summary counts six host-bound entries, including `S-044` and `S-047` | `PLAN.md:330-337` closes `S-044` and `S-047` on 2026-10-29; update the audit count to four (`S-042`, `S-046`, `S-048`, `S-051`) |

## F. Cleanup

| ID | State | Verified evidence | Action |
| --- | --- | --- | --- |
| `F-1` | blocked by C1 | 16 residue files and 5 dist-only dirs | delete when the owner approves |
| `F-2` | open | `/tmp/opencode` has `db-lock-repro.sh`, `global-boot-coexist.sh`, `global-boot-forward.sh`, `global-boot-proto.sh`, `global-boot-proto/` | delete after the proof run or document them as regenerated scratch; correct decision 4 |
| `F-3` | done | `DECOUPLING.md` now describes `npm run seed:agents`, the 8 bases, and the 3 manual variants; `.opencode/agents` has 11 files and `deleted-agents.json` has 35 names | closed 2026-10-29: `prove-seed-agents` proves a fresh seed, manual-file preservation, force behavior, and the 8-base inventory |

## G. Deferred, host-bound, or outside this tree

| ID | State | Anchor | Rule |
| --- | --- | --- | --- |
| `G-1` | deferred | `docs/FUTURE-WORK-PLAN.md` is modified and uncommitted (31 insertions, 24 deletions); says 92 proof scripts / 91 steps, installer verify at lines 479-518, doctor range at 548-556; its section 6 carries four open forks of its own (Wave 1b prevention fork, gemini eval slot, fork/rewind semantics, record-store title duplication) | do not edit or commit until A-F close; then re-measure: 103 files / 100 steps, verify at `install-global.ts:1108`, doctor range at `doctor-v2.sh:639-642`; the section 6 forks stay that file's scope and are not adopted here |
| `G-2` | host-bound | `SHARED.md` `S-042`, `S-046`, `S-048`, `S-051`; `PLAN-DB-INSTALL.md` F1 | mitigated plugin-side; the host contract is open; no repo action |
| `G-3` | host-bound | `UPSTREAM.md:136-150` follow-ups 1, 4, 5, 6, 7 | `E-43` live check, fork/revert, compaction payload, `session.instructions.entry`, host-level `execute` deny; assess on the next host release |
| `G-4` | declined | `ISSUES.md:287` `I-01` | the owner declined a real global install on 2026-10-29; isolated-HOME validation stands |
| `G-5` | observation | `PLAN-DB-INSTALL.md` F14 | host 2.2.0 holds 0 `event` rows; the write path is undetermined; no repo action unless the host changes |
| `G-6` | binding | `ISSUES.md:26-34` bash permission is off-limits | no guard fix may edit a `bash` permission entry; guard code may refuse a specific command |
| `G-7` | binding | `ISSUES.md:35-47` D-00: v1 is retired permanently | no v1 entry, host, or dependency may return; two hosts only in isolated tests |

## H. Closure order

1. `E-40`, `E-41` with the rule-gate and unit-suite decisions; `E-37`, `E-39`, and `E-30` closed 2026-10-29.
2. `E-40`, `E-41` with the rule-gate and unit-suite decisions.
3. `V-13` decision, then implementation or documented limitation.
4. Decision 3, decision 8, `P-01`, `P-02`, `P-03` and the resulting work.
5. `F-1`-`F-3` cleanup.
6. `E-DOC-1`-`E-DOC-14` regeneration after the code and decisions are final.
7. `G-1` re-measure, then decide whether to commit `docs/FUTURE-WORK-PLAN.md`.

After each batch: `npm run verify`; after a proof batch: update
`scripts/gate-manifest.json` and `scripts/prove-proof-catalog.ts` in the same
commit.

## I. Coverage matrix

| Source | Open or partial items found | Ledger rows | Status |
| --- | --- | --- | --- |
| `ISSUES.md` | 2 open entries, decisions 3 and 8, `P-01`-`P-03`, corrections, standing decisions | `E-40`, `E-41`, Decision 3/8, `P-01`..`P-03`, `E-DOC-3`..`E-DOC-5`, `G-6`, `G-7` | covered |
| `VERIFICATION-20261026.md` | `V-13`, `V-26`, `V-27`; six resolved partials; `V-36`/`V-37`; eight next actions; SHARED audit count | `V-13`, `V-26`, `V-27`, `V-15`/`V-19`/`V-20`/`V-30`/`V-31`/`V-52`, `V-G`, `V-36`, `V-37`, `E-DOC-2`, `E-DOC-12`, `E-DOC-14` | covered |
| `SCRIPT-PARITY.md` | 4 out-of-scope rows and the summary label | `E-DOC-6` | covered |
| `PLAN-DB-INSTALL.md` | P0-P7 closed; F14 observation; F20/F24/F25/F27/F32 fixed | `G-5` | covered |
| `RECOVERY-20261025.md` | historical status, H-07 hazard, orphan cwd | `E-DOC-7` | covered |
| `PLAN.md` | P2 backlog closed; deferred upstream docs; Day-6 historical; stale 2.2.0 bump line | `E-DOC-10`, `E-DOC-13`, `G-3` | covered |
| `TRIAGE.md` | 97 proof steps and the Day-4 exit | `E-DOC-10` | covered; `TRIAGE.md` is historical, the current count is 101 |
| `CUTOVER.md` | Day-6 25-proof lines | `E-DOC-10` | covered |
| `docs/CI-TRANSCRIPT.md` | committed stage transcript | `E-DOC-11` | covered; no action |
| `SHARED.md` | 57 frozen entries; four host-bound; stale frozen headings | `E-DOC-12`, `E-DOC-14`, `G-2`; `docs/SHARED-PARITY.md` is the per-entry disposition | covered; the ledger is gate-enforced |
| `STABILITY.md` | 24-open snapshot | `E-DOC-1` | covered; regeneration pending the S-tier recount |
| `UPSTREAM.md` | release status, three tracked rows, five follow-ups | `E-DOC-8`, `G-3` | covered |
| `DECOUPLING.md` | seed step, fresh-clone check, deleted-agent count | `E-DOC-9`, `F-3` | covered |
| `docs/FUTURE-WORK-PLAN.md` | 92/91 proof count, installer and doctor anchors, section 6 forks | `G-1` | deferred |
| `AGENTS.md`, `README.md` | 97 proofs | `E-DOC-11` | covered; both read 101 proofs now |

## J. Audit log and measured discrepancies

Commands used: heading census, table greps, `git status`, `git log`, `ls` and
bounded `find` over the six named workspaces, `node -e` on
`scripts/gate-manifest.json`, and `wc -l scripts/*.sh`.

Measured discrepancies against the source documents:

1. Residue is 10 `pre-refresh` files and 6 `retired` `.js` files, not 12 and
   14; the retired `.mjs` copies are no longer present. The sixth inert package
   dir (`athan new vrsion`) has no `.opencode`; only five remain.
2. `E-40` says seven scripts; there are ten, and six carry comments.
3. `E-41` says 32 proof scripts; there are 104 files and 101 proofs-stage steps.
4. Two `ISSUES.md` bodies still say 87 proofs (lines 1135 and 1240).
5. Pending decision 4 says `/tmp/opencode` is empty; five artifacts exist.
6. Pending decision 8 is implemented; only the list row is stale.
7. `V-13` remains partial: the global config is never permission-repaired.
8. `DECOUPLING.md` now records the 35 names the user-owned file carries; the
   inventory matches the on-disk list.
9. `FUTURE-WORK-PLAN.md` says 92/91 and cites doctor lines 548-556 and
   installer lines 479-518; the current anchors are 639-642 and 1108.
10. `@opencode/plugin` 2.2.1 still has no `session.form` surface, so `P-01`
    stays upstream-blocked.
11. `SHARED.md` carries an explicit `v2 status` line for only 14 of 57 entries,
    and 15 headings still read `REQUIRED`, `PARTIALLY IMPLEMENTED`, or `NOTE`.
    `docs/SHARED-PARITY.md` now dispositions all 57 entries as 63 anchored
    requirements; the frozen file is untouched and the ledger check runs in
    `gate:fast`.
