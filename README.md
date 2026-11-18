<div align="center">

<img src="assets/tawassul-social-preview.png" alt="Tawassul — Collaborative AI Agents" width="100%">

<h3>A team runtime for OpenCode</h3>

<p><b>Eight base agents · the model variants you choose · 44 tools · a ledger that remembers what was decided</b></p>

<p>
  <a href="https://github.com/HtoZ27/Tawassul-V2/actions/workflows/ci.yml"><img src="https://github.com/HtoZ27/Tawassul-V2/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="https://github.com/HtoZ27/Tawassul-V2/releases"><img src="https://img.shields.io/github/v/release/HtoZ27/Tawassul-V2?include_prereleases" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="license"></a>
  <a href="docs/compatibility.md"><img src="https://img.shields.io/badge/OpenCode-%E2%89%A52.3.0-555" alt="OpenCode"></a>
</p>

<p>
  <a href="#quick-start"><b>Quick start</b></a> ·
  <a href="GUIDE.md">Guide</a> ·
  <a href="WORKFLOW.md">Workflow</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/release-notes-0.1.6.md">Release notes</a>
</p>

</div>

Tawassul is an OpenCode plugin. It adds routing, handoffs, a goal ledger,
mission boards, checkpoints, memory records, and a disciplined tool surface to a
single workspace or to every workspace of a user. It is local-first: state lives
on your disk, in your configuration directory, and nowhere else.

**Status:** `0.1.6-experimental`. The Linux lane carries the full feature set.
Native Windows x64 is supported for the bundle and wasm lane (native receipt
2026-11-02, re-run on 2026-11-03); database maintenance and scheduled triggers
need the Linux lane. Emulator evidence is published and clearly labelled.

## Why it exists

A long session with one agent loses structure. Decisions are buried in the
transcript, handoffs are improvised, and nobody can say which tasks are done. A
second agent helps only if the work is written down, attributed, and checkable.

Structure is one reason. Parallel work is the other: several agents can plan the
same task at once, each on a different model, then analyse the code, hunt for
problems, propose fixes, and compare the answers. One pass gives you four
opinions instead of four sequential attempts, and that is where the time comes
back to you.

The price is tokens. Every extra agent carries its own context and returns its
own answer, so a wide roster costs more than one careful model. Keep the roster
on free models where the work allows it — the `-free` variants on `opencode`,
such as `deepseek-v4.1-flash-free` and `mimo-v2.6-flash-free` — and pay for the
one role that needs a larger model, not for the whole team.

Tawassul makes the structure explicit:

| Capability | What it gives you |
| --- | --- |
| Specialist agents | `tawa` routes; `dev`, `analyst`, `tester`, `reviewer`, `architect`, `designer`, and `doc` do the work |
| Model variants | `@addagent` adds a variant of a role on another model and removes it without touching the base |
| Parallel agents | `moa`, `parallelCopies`, and several `@` mentions run one task across several models |
| Handoffs | Work moves between agents with context, checkpoints, and a completion record |
| Goal ledger | Objectives, items, and definition-of-done criteria persist across sessions and compactions |
| Mission boards | Task state, agent health, and system status in one place |
| Activity timeline | What happened and when, by time, agent, range, or milestone |
| Checkpoints | A code snapshot before a risky change, restorable after it |
| Memory records | Decisions, fixes, incidents, and notes that survive the session |
| Shared memory | Decisions, learnings, warnings, file and agent context, and handoff history, read by every agent |
| Discussions | Agents propose, vote, and divide work with evidence attached |
| Context packs | A long session is packed and continued in a successor without losing the thread |
| Skills | Sixteen procedures that load when the task matches; no files are installed |
| Per-agent permissions | A role matrix decides which tools each specialist may call, behind the host gate |
| Guardrails | Write locks, rate limits, iteration budgets, and two permission layers |
| Diagnostics | `health()` and `check()` report the runtime, the roster, and the host |
| 44 tools | File reading, AST queries, dependency maps, search, git diffs, web fetches, and the orchestration surface |
| Bilingual UI | English and Arabic strings ship in the bundle |

## Quick start

Requires OpenCode `>=2.3.0`, Node.js `26.13.0` (see `.nvmrc`), and Bun `1.3.x`.

> **Use project scope for local projects.** A project install keeps the plugin
> inside that workspace, loads it only there, and never touches your OpenCode
> configuration. Global scope is for a user who wants Tawassul in every
> workspace.

Install the release into one workspace:

```sh
sh install.sh --project <dir> --dry-run
sh install.sh --project <dir>
```

Install it for every workspace of the current user:

```sh
sh install.sh --global --dry-run
sh install.sh --global
```

The standalone database maintenance lane installs with no plugin and no
workspace: `sh install.sh --db-maintenance`. It reduces the database on a daily
schedule, so read [Database maintenance](#database-maintenance) before you run
it.

The installer verifies the bundle, the runtime archive, and — for
`--db-maintenance` — the maintenance archive against
`SHA256SUMS`, stages the four wasm grammars, and never edits `opencode.json`.
`sh install.sh --global --uninstall` reverses a plugin install, and
`sh install.sh --db-maintenance --uninstall` removes the lane. See
[docs/installation.md](docs/installation.md#release-installer).

From a source checkout:

```bash
nvm use
npm install
npm run build
```

Open the workspace in OpenCode. The host discovers
`.opencode/plugins/tawassul.js` on its own; no configuration edit is needed.

One setting lives in the app rather than in `opencode.json`: open
**Settings → General** and turn on **Show agent** ("Switch between agents in
the composer"). The composer then carries the agent selector, so a session can
run as `dev`, `analyst`, `tester`, or any variant you add. While it is off, the
app stays on the Build agent.

The repository installer adds the host probe, the database scripts, and the
scheduled maintenance trigger:

```bash
bun scripts/install-global.ts --dry-run
bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

## Database maintenance

Keeping the database bounded does not require the plugin, so the lane ships as
its own asset, `tawassul-db-maintenance-<version>.tar.gz`: five POSIX shell
scripts with no bundle, no wasm, no agents, no workspace, and no Node or Bun. A
host that never installs Tawassul can run it, and so can an offline machine.

```sh
sh install.sh --db-maintenance --dry-run
sh install.sh --db-maintenance
```

With the archive and `SHA256SUMS` already in one directory, install without the
network:

```sh
sh install.sh --db-maintenance --from ~/Downloads
```

To run one pass without installing anything, unpack the archive and run the
script from the directory it creates, naming the database explicitly:

```sh
tar -xzf tawassul-db-maintenance-0.1.6-experimental.tar.gz
bash tawassul-db-maintenance/opencode-db-maintenance.sh \
  --db "$HOME/.local/share/opencode/tawassul-v2/opencode.db" --check
```

> **Warning: this lane reduces the database.** A real run prunes messages older
> than 90 days — never sessions — and then vacuums when no process holds the
> file. Installing registers that run daily through a systemd user timer or a
> cron line. Pruned rows are gone from the live file; the backup taken before
> the prune is the way back, and only the five most recent backups are kept. If
> you do not want the database reduced, do not install the lane, and do not run
> the script without `--check`. To install the scripts with no schedule, set
> `TAWASSUL_DB_MAINTENANCE=off` for the install. `--check` prints what a run
> would delete and changes nothing, `--prune-days` sets the window, and backups
> default to `~/.local/share/tawassul-v2/backups`.

Native Windows has no database lane. The flags and exit codes are in
[docs/database.md](docs/database.md); uninstall and coexistence with the plugin
are in
[docs/installation.md](docs/installation.md#database-maintenance-lane).

## The agent team

| Agent | Role |
| --- | --- |
| 🟪 `tawa` | Experts' intermediary; activates only on an explicit `@tawa` request |
| 🟦 `dev` | Implements and fixes, choosing a model by task complexity |
| 🟩 `analyst` | Quality supervision, risk, and model selection |
| 🟨 `tester` | Tests, edge cases, and test reports |
| 🟧 `reviewer` | Line-by-line review and security audit |
| 🟥 `architect` | Structure, technologies, and design evaluation |
| 🟤 `designer` | Interfaces, mockups, and user experience |
| ⚫ `doc` | Technical and user documentation |

### Several agents on one task

A base role is a starting point. Add one clone per model, then send one task to
all the clones together:

```text
@addagent reviewer-deep with model deepseek-v4.1-flash-free from opencode
@addagent analyst-gemini with model gemini 4 hydrogen from google
@addagent analyst-deep with model deepseek-v4.1-flash-free from opencode
@addagent analyst-mimo with model mimo-v2.6-flash-free from opencode
@addagent analyst-minimax with model nvidia/minimaxai/minimax-m3.1-flash from nvidia
@tawa Use moa with analyst-gemini, analyst-deep, analyst-mimo and
analyst-minimax on the payment module: one verdict per reviewer for race
conditions, with the file and line behind it.
```

The add lines name each variant explicitly and pin it to one exact model, so
every name resolves to a roster entry. `moa` dispatches one copy per name; read
the verdicts with `show_board`, or ask `@analyst` to consolidate them. Each clone
keeps its own model and runs in its own session, so one review carries four
opinions instead of one.

Typing `@` in the message box is the direct route, with **Show agent** turned on
as in Quick start. Pick one agent, or keep typing `@` and pick as many as you
want; each mention runs on the model you gave that agent, and the text after the
mentions is the shared task:

```text
@reviewer-deep @analyst-mimo @analyst-minimax @analyst-gemini atomic
evaluation of the project, with a comparison of the findings
```

The add lines above create these names, so the picker offers them. No `@tawa` is
needed for this route.

The suffix is a short name, not the model path. `gemini`, `deep`, `mimo`, and
`minimax` are catalog suffixes and work on any host. The model itself comes from
`with model ... from ...`. The last line spells the full
`nvidia/minimaxai/minimax-m3.1-flash` because NVIDIA namespaces its model IDs —
a bare `minimax-m3.1-flash` names a model the provider does not list — and
`from nvidia` stays because the syntax requires it. If you want the suffix to
track the model, use one provider token — `hydrogen` for
`gemini 4 hydrogen from google` — which the named provider must list. An
invented suffix is rejected with the accepted names. The same pattern applies to
`reviewer`, `tester`, `architect`, `designer`, and `doc`.

`moa` is the router's dispatcher, not the only way to several agents. An
ordinary agent can open a `handoff` with `parallelCopies`: one primary target
plus N-1 copies drawn from the rest of the roster, all running the same task.
This is the route for comparing implementations, cross-checking an analysis,
collecting independent reviews, or weighing competing plans — no `@tawa`
needed. Each copy stores its own result, and the aggregated report returns them
side by side.

```text
@tester Compare three independent reviews of the retry fix: open a handoff to
@reviewer with parallelCopies: 3, send the failing test and the patch, then list
the points the three reviews disagree on.
```

You name the primary target and the count, not the copies. `bestAgent` is the
answer closest to the others — a consensus signal, not a quality ranking. Read
the differences; that is where the extra opinions pay off.

For work that splits into independent parts rather than parallel opinions, use
`task_orchestrate` with `mode: "parallel"`: it cuts the task, dispatches the
parts at once, and keeps each part's files and bundle separate.

## Skills

A skill is a procedure the model loads when the task matches it. Sixteen ship
in-process: nothing is copied into a skills directory, and an uninstall leaves
no skill files behind.

You do not switch one on. Ask for the outcome in plain words, or name the skill
you want:

```text
Use tawassul-handoff-triage and close the stale handoffs.
```

The table lists all sixteen. The second column is the sentence the model reads
before it decides to load the procedure, so it is the best short answer to
"what is this one for".

<!-- generated:skills-table -->
| Skill | What it does |
| --- | --- |
| `tawassul-adversarial-review` | Use when a diff is about to be accepted: attack the change, cover every changed file and end in a safe or not-safe verdict. |
| `tawassul-code-explorer` | Use when an unfamiliar area is about to change: trace the feature from entry point to storage and name the files that matter. |
| `tawassul-codebase-design` | Use when a module boundary is designed or reviewed: choose the seam, test the depth and record the design. |
| `tawassul-context-continue` | Pack the current session, read the pack back, and continue the work in a successor session. |
| `tawassul-diagnosing-bugs` | Use when a failure resists the obvious fix: build a red loop, rank causes and land the regression test at a real seam. |
| `tawassul-enrich-task` | Use when a request arrives as a sentence or a screenshot: turn it into scope, acceptance criteria and the open questions. |
| `tawassul-goal-review` | Review open goals, attach evidence, and close the goals whose items and criteria are complete. |
| `tawassul-handoff-triage` | Triage the handoff ledger: complete delivered work, revert accepted work, and reassign stalled work. |
| `tawassul-incident-response` | Use when a severe regression or host failure lands: stabilise, contain, preserve evidence and verify recovery. |
| `tawassul-integration-engineer` | Land a change safely: map dependencies, trace execution, verify integration and regression. |
| `tawassul-interface-design` | Use when a user-facing surface is designed or judged: set the direction, then score the result against the rubric. |
| `tawassul-retro` | Use when a session went badly: find the environment change that would have prevented it. |
| `tawassul-step-back` | Use when fixes start stacking: reassess the direction and put the cleaner alternative in front of the user. |
| `tawassul-to-tickets` | Use when a goal is too large for one handoff: cut it into vertical slices, each demoable and each declaring its blocking edge. |
| `tawassul-verification-planning` | Use when a non-trivial change is planned: name the claim, choose the evidence path and set the verification budget. |
| `tawassul-writing-for-agents` | Use when an agent-facing document is written or edited: a skill, a rules file, a handoff context or a tool description. |
<!-- /generated -->

More in [docs/skills.md](docs/skills.md).

## Compatibility

| Platform | Status |
| --- | --- |
| Linux x64 | Ready, full lane including database maintenance |
| Linux arm64, macOS | Experimental |
| Windows x64 | Supported (native receipt); bundle and wasm only, no database lane |
| WSL2 | Experimental |

The host floor is `2.3.0`, which is also the audited version. The installer
refuses an older host, and the plugin refuses one that reports an older version
at init. Newer majors run in untested mode behind a capability probe. Full
detail, including
the evidence level of every row, is in
[docs/compatibility.md](docs/compatibility.md).

## Documentation

| Document | Content |
| --- | --- |
| [docs/release-notes-0.1.6.md](docs/release-notes-0.1.6.md) | What this release contains and what it does not claim |
| [docs/features.md](docs/features.md) | Capability catalogue and the status of each claim |
| [docs/installation.md](docs/installation.md) | Project and global install, upgrade, uninstall |
| [docs/agents.md](docs/agents.md) | Who does what, and how routing works |
| [docs/tools.md](docs/tools.md) | The 44-tool surface, grouped by purpose |
| [docs/skills.md](docs/skills.md) | The shipped procedures, and how each one is measured |
| [docs/plugins.md](docs/plugins.md) | Package layout, discovery, a manual host entry |
| [docs/upgrade.md](docs/upgrade.md) | Patch upgrades, downgrades, preserved state |
| [WORKFLOW.md](WORKFLOW.md) | The working rhythm: goals, handoffs, reviews, long sessions |
| [GUIDE.md](GUIDE.md) | The complete team guide: agents, variants, memory, locks, tools, skills |
| [docs/configuration.md](docs/configuration.md) | Config file, keys, environment variables |
| [docs/environment.md](docs/environment.md) | Environment variable precedence and contracts |
| [docs/state.md](docs/state.md) | State topology, retention, backup, deletion |
| [docs/permissions.md](docs/permissions.md) | Guard order, consent words, path rules |
| [docs/compatibility.md](docs/compatibility.md) | Host versions, platforms, feature matrix |
| [docs/architecture.md](docs/architecture.md) | Layers, startup, persistence, failure containment |
| [docs/database.md](docs/database.md) | Maintenance lane, pruning, generation guard |
| [docs/dependencies.md](docs/dependencies.md) | Runtime requirements, licences, bundle inventory |
| [docs/validation.md](docs/validation.md) | Gates, proofs, receipts, what a green run proves |
| [docs/i18n/LANGUAGES.md](docs/i18n/LANGUAGES.md) | Canonical language, runtime tables, translation plan |
| [docs/security-model.md](docs/security-model.md) | Assets, trust boundaries, controls, limits |
| [docs/privacy.md](docs/privacy.md) | Stored data, outbound flows, retention, deletion |
| [docs/monitoring.md](docs/monitoring.md) | Health, logs, the timeline, and the operational thresholds |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Symptom, cause, fix |
| [docs/known-issues.md](docs/known-issues.md) | What is broken now, and the workaround |
| [docs/limitations.md](docs/limitations.md) | The boundaries that are by design |
| [docs/faq.md](docs/faq.md) | Short answers to common questions |
| [docs/roadmap.md](docs/roadmap.md) | What ships next, and what is out of scope |
| [examples/README.md](examples/README.md) | Five end-to-end recipes, with conventions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, gates, style, pull requests |
| [SUPPORT.md](SUPPORT.md) | Where to ask, what to include, scope |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability |

The complete index, including the evidence receipts and the translated guides,
is [docs/README.md](docs/README.md).

## Development

```bash
npm run typecheck     # TypeScript strict
npm run check:rules   # English-only and no-comments
npm run check:docs    # public links, language, surface coverage
npm run sbom          # CycloneDX inventory and licence check
npm run verify        # fast gate plus build
npm run ci            # fast, proofs, and smoke
```

CI runs the fast gate and the four proof shards on every pull request; smoke is
a local release check because it boots the host. See
[CONTRIBUTING.md](CONTRIBUTING.md).

The proof suite runs every proof in its own child process. A failing proof is a
finding; it is not retried until it passes.

## Licence

Apache License 2.0. [LICENSE](LICENSE) carries the full terms and
[NOTICE.md](NOTICE.md) the attribution notices and the third-party components
that ship in the bundle or as wasm grammars; redistributions must keep both.
The complete installed inventory is in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The projects whose ideas
shaped this one are thanked in [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).
