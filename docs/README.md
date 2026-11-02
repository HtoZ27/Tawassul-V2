# Documentation

Tawassul is an OpenCode plugin that turns a workspace into a small, accountable
team runtime. The documents below describe how to install it, what it supports,
and how it protects your work.

## Start here

| Document | Read it when |
| --- | --- |
| [Installation](installation.md) | You want the plugin running in a workspace or for a whole user |
| [Upgrade](upgrade.md) | You are moving an existing install to a new build |
| [Compatibility](compatibility.md) | You need to know which host and platform are supported |
| [User guide](user-guide.md) | You want the working rhythm: goals, handoffs, reviews, long sessions |
| [Configuration](configuration.md) | You need the config file, its keys, or an environment variable |
| [Agents](agents.md) | You want to know who does what, and how routing works |
| [Tools](tools.md) | You need the 44-tool surface, grouped by purpose |
| [Commands](commands.md) | You want the slash command and the routes behind common requests |
| [Skills](skills.md) | You want the shipped procedures, or to write your own |
| [Permissions](permissions.md) | You need the guard, consent words, or path rules |
| [State](state.md) | You need the state topology, retention, backup, or deletion |
| [Architecture](architecture.md) | You are maintaining the plugin and need the layer boundaries |
| [Database](database.md) | You operate the maintenance lane, pruning, or the generation guard |
| [Monitoring](monitoring.md) | You need health, logs, and the operational thresholds |
| [Security model](security-model.md) | You are deciding whether to run it on real work |
| [Troubleshooting](troubleshooting.md) | Something refuses to start, install, or verify |
| [Known issues](known-issues.md) | Something is not working and you want the current workaround |
| [Limitations](limitations.md) | You need the boundaries that are by design |
| [FAQ](faq.md) | You want a short answer to a common question |
| [Glossary](glossary.md) | A term in these documents is unfamiliar |

## Project documents

| Document | Purpose |
| --- | --- |
| [README](../README.md) | What the plugin is and how to start in three commands |
| [CONTRIBUTING](../CONTRIBUTING.md) | Build, gates, style, and pull-request rules |
| [SECURITY](../SECURITY.md) | Reporting a vulnerability and the supported versions |
| [NOTICE](../NOTICE.md) | Third-party components and their licences |
| [ACKNOWLEDGEMENTS](../ACKNOWLEDGEMENTS.md) | The prior art this project learned from |
| [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) | Community expectations |

## Conventions used here

- **Verified** means a receipt or a gate step exists and passes.
- **Experimental** means it runs, but the release gate does not cover it.
- **Pending** means no receipt exists yet; it is not a support claim.
- Paths are written for a POSIX shell unless a section says otherwise.
- Commands that write outside the workspace are marked as such.
- This index is the public documentation set. `npm run check:docs` rejects a
  broken link, an Arabic character, a reference to an internal document, or a
  link that leaves this set.
