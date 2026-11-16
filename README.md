# Tawassul

**A team runtime for OpenCode: eight base agents, the model variants you
choose, 44 tools, and a ledger that remembers what was decided.**

<p align="center">
  <img src="assets/tawassul-logo.svg" alt="Tawassul — Collaborative AI Agents" width="600">
</p>

Tawassul is an OpenCode plugin. It adds routing, handoffs, a goal ledger,
mission boards, checkpoints, memory records, and a disciplined tool surface to a
single workspace or to every workspace of a user. It is local-first: state lives
on your disk, in your configuration directory, and nowhere else.

**Status:** `0.1.0-experimental`. The Linux lane carries the full feature set.
Native Windows x64 is supported for the bundle and wasm lane (native receipt
2026-11-02, re-run on 2026-11-03); database maintenance and scheduled triggers
need the Linux lane. Emulator evidence is published and clearly labelled.

## Why it exists

A long session with one agent loses structure. Decisions are buried in the
transcript, handoffs are improvised, and nobody can say which tasks are done. A
second agent helps only if the work is written down, attributed, and checkable.

Tawassul makes that structure explicit:

| Capability | What it gives you |
| --- | --- |
| Specialist agents | `tawa` routes; `dev`, `analyst`, `tester`, `reviewer`, `architect`, `designer`, and `doc` do the work |
| Handoffs | Work moves between agents with context, checkpoints, and a completion record |
| Goal ledger | Objectives, items, and definition-of-done criteria persist across sessions and compactions |
| Mission boards | Task state, agent health, and system status in one place |
| Checkpoints | A code snapshot before a risky change, restorable after it |
| Memory records | Decisions, fixes, incidents, and notes that survive the session |
| Discussions | Agents propose, vote, and divide work with evidence attached |
| Context packs | A long session is packed and continued in a successor without losing the thread |
| 44 tools | File reading, AST queries, dependency maps, search, git diffs, web fetches, and the orchestration surface |
| Bilingual UI | English and Arabic strings ship in the bundle |

## Quick start

Requires OpenCode `>=2.3.0`, Node.js `26.13.0` (see `.nvmrc`), and Bun `1.3.x`.

> **Use project scope for local projects.** A project install keeps the plugin
> inside that workspace, loads it only there, and never touches your OpenCode
> configuration. Global scope is for a user who wants Tawassul in every
> workspace.

Install the release into one workspace:

```bash
sh install.sh --project <dir> --dry-run
sh install.sh --project <dir>
```

Install it for every workspace of the current user:

```bash
sh install.sh --global --dry-run
sh install.sh --global
```

The installer verifies the bundle and the runtime archive against
`SHA256SUMS`, stages the four wasm grammars, and never edits `opencode.json`.
`sh install.sh --global --uninstall` reverses it. See
[docs/installation.md](docs/installation.md#release-installer).

From a source checkout:

```bash
nvm use
npm install
npm run build
```

Open the workspace in OpenCode. The host discovers
`.opencode/plugins/tawassul.js` on its own; no configuration edit is needed.

The repository installer adds the host probe, the database scripts, and the
scheduled maintenance trigger:

```bash
bun scripts/install-global.ts --dry-run
bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

## The agent team

| Agent | Role |
| --- | --- |
| `tawa` | Experts' intermediary; activates only on an explicit `@tawa` request |
| `dev` | Implements and fixes, choosing a model by task complexity |
| `analyst` | Quality supervision, risk, and model selection |
| `tester` | Tests, edge cases, and test reports |
| `reviewer` | Line-by-line review and security audit |
| `architect` | Structure, technologies, and design evaluation |
| `designer` | Interfaces, mockups, and user experience |
| `doc` | Technical and user documentation |

## Skills

Sixteen procedures ship in-process and load only when the task matches them.
Nothing is copied into a skills directory, and an uninstall leaves no skill
files behind.

<!-- generated:skills-table -->| Skill | Scope | Tools | Eval | Load threshold |
| --- | --- | --- | --- | --- |
| `tawassul-goal-review` | goal lifecycle review across the board, items and definition of done | `goal`, `show_board`, `record` | `goal-review-basic` | 0.5 |
| `tawassul-handoff-triage` | handoff lifecycle triage across the board, timeline and ledger | `show_board`, `timeline`, `record`, `handoff` | `handoff-triage-basic` | 0.5 |
| `tawassul-context-continue` | portable context handoff across pack, read and continue | `thread`, `record` | `context-continue-basic` | 0.5 |
| `tawassul-integration-engineer` | safe change integration across dependencies, invariants, execution paths and regression verification | `goal`, `show_board`, `timeline`, `record`, `handoff` | `integration-engineer-basic` | 0.5 |
| `tawassul-adversarial-review` | adversarial review across changed-file coverage, attack dimensions, fact-check and verdict | `show_board`, `timeline`, `goal`, `record`, `handoff` | `adversarial-review-basic` | 0.5 |
| `tawassul-enrich-task` | request intake across scope, reuse, requirements, acceptance and open questions | `goal`, `show_board`, `record`, `handoff` | `enrich-task-basic` | 0.5 |
| `tawassul-step-back` | direction reassessment across drift signals, the cleaner alternative and the decision | `timeline`, `show_board`, `record`, `handoff` | `step-back-basic` | 0.5 |
| `tawassul-diagnosing-bugs` | root-cause diagnosis across reproduction, ranked hypotheses, probes and the regression seam | `timeline`, `record`, `handoff` | `diagnosing-bugs-basic` | 0.5 |
| `tawassul-verification-planning` | verification planning across claims, failure modes, evidence paths and budget | `goal`, `record`, `handoff` | `verification-planning-basic` | 0.5 |
| `tawassul-code-explorer` | feature tracing across entry points, flow, dependencies and extension points | `show_board`, `timeline`, `record`, `handoff` | `code-explorer-basic` | 0.5 |
| `tawassul-incident-response` | incident handling across classification, containment, evidence, communication and close-out | `show_board`, `record`, `handoff`, `timeline` | `incident-response-basic` | 0.5 |
| `tawassul-to-tickets` | decomposition across vertical slices, blocking edges and dispatch order | `goal`, `record`, `handoff` | `to-tickets-basic` | 0.5 |
| `tawassul-retro` | session retrospective across navigation, checks, standards, context bloat, tool economy and information access | `timeline`, `show_board`, `record`, `goal`, `handoff` | `retro-basic` | 0.5 |
| `tawassul-writing-for-agents` | agent-facing writing across pointers, load budgets, completion criteria, leading words and pruning | `show_board`, `record`, `goal`, `handoff` | `writing-for-agents-basic` | 0.5 |
| `tawassul-codebase-design` | module design across interface depth, seams, adapters and testability | `show_board`, `record`, `goal`, `handoff` | `codebase-design-basic` | 0.5 |
| `tawassul-interface-design` | interface direction and critique across aesthetic intent, tokens, accessibility and generic-output tests | `show_board`, `record`, `handoff` | `interface-design-basic` | 0.5 |
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
| [docs/release-notes-0.1.0.md](docs/release-notes-0.1.0.md) | What this release contains and what it does not claim |
| [docs/features.md](docs/features.md) | Capability catalogue and the status of each claim |
| [docs/installation.md](docs/installation.md) | Project and global install, upgrade, uninstall |
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
| [docs/troubleshooting.md](docs/troubleshooting.md) | Symptom, cause, fix |
| [docs/faq.md](docs/faq.md) | Short answers to common questions |
| [docs/roadmap.md](docs/roadmap.md) | What ships next, and what is out of scope |
| [examples/README.md](examples/README.md) | Five end-to-end recipes, with conventions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, gates, style, pull requests |
| [SUPPORT.md](SUPPORT.md) | Where to ask, what to include, scope |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability |

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
