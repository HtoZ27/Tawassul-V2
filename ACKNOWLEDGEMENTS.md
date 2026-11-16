# Acknowledgements

Tawassul is an independent project. It is not affiliated with, endorsed by, or
sponsored by any project listed here. No source code was copied from these
projects; they are acknowledged as prior art that informed design decisions,
documentation practice, and packaging conventions.

## Plugins and extensions that came before

| Project | License | What it informed |
| --- | --- | --- |
| [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) | MIT | In-process skill registration, the rule that a same-name user skill wins, and measuring skill descriptions as a context budget instead of capping them mechanically |
| [superpowers](https://github.com/obra/superpowers) | MIT | Skills kept in a versioned source tree, and failure-isolated registration so one rejected skill cannot disable the plugin |
| [opencode-power-pack](https://github.com/waybarrios/opencode-power-pack) | MIT AND Apache-2.0 | The shape of a security policy, a compatibility document, and a licence inventory that separates bundled from referenced work |
| [opencode-agent-orchestration-kit](https://github.com/jcarlosrodicio/opencode-agent-orchestration-kit) | Apache-2.0 | Installation lifecycle writing: dry runs, ownership records, collision handling, and documentation that states its own scope limits |
| [opencode-mem](https://github.com/tickernelz/opencode-mem) | MIT | Presenting persistent memory as an explicit contract rather than hidden behaviour |
| [opencode-morph-fast-apply](https://github.com/JRedeker/opencode-morph-fast-apply) | MIT | Keeping a narrow tool surface sharp, and documenting a single capability thoroughly |

## Host and libraries

Tawassul runs inside OpenCode and depends on its plugin API. The third-party
components that ship with or beside this plugin are listed in
[NOTICE.md](NOTICE.md), with their licences.

## How to be added here

If you maintain a project whose ideas shaped Tawassul and you are not listed,
open an issue with the specific influence. This document records influence, not
code reuse, and it is updated when a concrete contribution to the design can be
named.
