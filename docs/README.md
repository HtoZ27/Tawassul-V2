# Documentation

Tawassul is an OpenCode plugin that turns a workspace into a small, accountable
team runtime. The documents below describe how to install it, what it supports,
and how it protects your work.

## Start here

| Document | Read it when |
| --- | --- |
| [Features](features.md) | You want the capability catalogue, with the status of every claim |
| [Installation](installation.md) | You want the plugin running in a workspace or for a whole user |
| [Plugins](plugins.md) | You want the package layout, discovery, or a manual host entry |
| [Release notes](release-notes-0.1.6.md) | You want to know what this release contains and what it does not claim |
| [Earlier release notes](release-notes-0.1.5.md) | You installed the previous release and want its notes |
| [Upgrade](upgrade.md) | You are moving an existing install to a new build |
| [Compatibility](compatibility.md) | You need to know which host and platform are supported |
| [Workflow](../WORKFLOW.md) | You want the working rhythm: goals, handoffs, reviews, long sessions |
| [Guide](../GUIDE.md) | You want the complete team guide: agents, variants, parallel comparison, memory, locks, tools, skills |
| [Configuration](configuration.md) | You need the config file, its keys, or an environment variable |
| [Environment](environment.md) | You need an environment variable's precedence or its contract |
| [Agents](agents.md) | You want to know who does what, and how routing works |
| [Tools](tools.md) | You need the 44-tool surface, grouped by purpose |
| [Commands](commands.md) | You want the slash command and the routes behind common requests |
| [Skills](skills.md) | You want the shipped procedures, or to write your own |
| [Permissions](permissions.md) | You need the guard, consent words, or path rules |
| [State](state.md) | You need the state topology, retention, backup, or deletion |
| [Architecture](architecture.md) | You are maintaining the plugin and need the layer boundaries |
| [Continuity detection](continuity-detection.md) | You need to know how an interrupted handoff is detected and which resume action to use |
| [Database](database.md) | You operate the maintenance lane, pruning, or the generation guard |
| [Dependencies](dependencies.md) | You need the runtime requirements, licences, or the bundle inventory |
| [Monitoring](monitoring.md) | You need health, logs, and the operational thresholds |
| [Security model](security-model.md) | You are deciding whether to run it on real work |
| [Privacy](privacy.md) | You need to know what is stored, what leaves the machine, and how to delete it |
| [Troubleshooting](troubleshooting.md) | Something refuses to start, install, or verify |
| [Known issues](known-issues.md) | Something is not working and you want the current workaround |
| [Limitations](limitations.md) | You need the boundaries that are by design |
| [FAQ](faq.md) | You want a short answer to a common question |
| [Roadmap](roadmap.md) | You want to know what ships next and what is out of scope |
| [Glossary](glossary.md) | A term in these documents is unfamiliar |
| [Validation](validation.md) | You are running the gates, a proof, or a release check |
| [Languages](i18n/LANGUAGES.md) | You want to know what is translated and what is canonical |

## Examples

| Recipe | Result |
| --- | --- |
| [Examples index](../examples/README.md) | The conventions every recipe follows |
| [Goal to merge](../examples/goal-to-merge.md) | A closed goal with evidence |
| [Review a change](../examples/review-a-change.md) | A stored evaluation and a recorded decision |
| [A long session](../examples/long-session.md) | A pack and a successor session |
| [Database maintenance](../examples/database-maintenance.md) | A checked, backed-up, pruned database |
| [A custom roster](../examples/custom-roster.md) | An added agent, verified and removed |

## Project documents

| Document | Purpose |
| --- | --- |
| [README](../README.md) | What the plugin is and how to start in three commands |
| [CONTRIBUTING](../CONTRIBUTING.md) | Build, gates, style, and pull-request rules |
| [SUPPORT](../SUPPORT.md) | Where to ask, what to include, and what is in scope |
| [CHANGELOG](../CHANGELOG.md) | What changed in each release |
| [SECURITY](../SECURITY.md) | Reporting a vulnerability and the supported versions |
| [NOTICE](../NOTICE.md) | Third-party components and their licences |
| [Third-party notices](../THIRD-PARTY-NOTICES.md) | The complete installed inventory at the release lockfile |
| [ACKNOWLEDGEMENTS](../ACKNOWLEDGEMENTS.md) | The prior art this project learned from |
| [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) | Community expectations |
| [LICENSE](../LICENSE) | The Apache-2.0 terms the release ships under |

## Conventions used here

- **Verified** means a receipt or a gate step exists and passes.
- **Experimental** means it runs, but the release gate does not cover it.
- **Pending** means no receipt exists yet; it is not a support claim.
- Paths are written for a POSIX shell unless a section says otherwise.
- Commands that write outside the workspace are marked as such.
- This index is the public documentation set. `npm run check:docs` rejects a
  broken link, an Arabic character, a reference to an internal document, a link
  that leaves this set, or a tool, agent, or skill that the docs do not cover.
