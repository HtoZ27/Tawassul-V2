# Documentation

Tawassul is an OpenCode plugin that turns a workspace into a small, accountable
team runtime. The documents below describe how to install it, what it supports,
and how it protects your work.

## Start here

| Document | Read it when |
| --- | --- |
| [Installation](installation.md) | You want the plugin running in a workspace or for a whole user |
| [Compatibility](compatibility.md) | You need to know which host and platform are supported |
| [Security model](security-model.md) | You are deciding whether to run it on real work |
| [Troubleshooting](troubleshooting.md) | Something refuses to start, install, or verify |

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
