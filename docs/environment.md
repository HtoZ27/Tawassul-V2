# Environment

Tawassul reads a small set of environment variables at plugin init and at
installer time. They are the override layer: an environment variable beats the
value in the configuration file, which beats the built-in default. Anything the
plugin does not list here is either internal to a proof or has no documented
contract.

A variable that is unset, empty, or whitespace is ignored. An unknown
`TAWASSUL_` name is ignored, not an error.

## Paths and scope

| Variable | Effect |
| --- | --- |
| `TAWASSUL_GLOBAL_DIR` | Global config root; also moves the default key directory |
| `TAWASSUL_V2_STATE_DIR` | Project state root override for the current process; wins over the alias |
| `TAWASSUL_STATE_DIR` | Compatibility alias for `TAWASSUL_V2_STATE_DIR` |
| `TAWASSUL_SCOPE` | Force `project` or `global` scope instead of detecting it |
| `TAWASSUL_ISOLATED` | Force isolated mode; state and config go to a temporary root |
| `TAWASSUL_CACHE_DIR` | Cache root override |
| `OPENCODE_CONFIG_DIR` | OpenCode config root, when the host is not on its default path |
| `OPENCODE_DB` | Database the host opens; the plugin never redirects it on its own |

### State directory precedence

1. `TAWASSUL_V2_STATE_DIR`, when set.
2. `TAWASSUL_STATE_DIR`, when set and the first is not.
3. The project state root: `<project>/.opencode`.

State is project-local for both install scopes, so the override moves state for
the current process only. See [state](state.md) for the full topology.

## Keys and consent

| Variable | Effect |
| --- | --- |
| `TAWASSUL_HMAC_KEY_DIR` | Key directory; wins over the default beside the config root |
| `TAWASSUL_CONSENT_TOKENS` | Path to `consent-tokens.json` |

`TAWASSUL_HMAC_KEY_DIR` is read-only: the directory must already contain
`.tawassul-hmac-key`. Tawassul never generates or replaces a key there. Key
directory resolution, in order:

1. `TAWASSUL_HMAC_KEY_DIR`.
2. `TAWASSUL_GLOBAL_DIR` moves the key to `dirname(TAWASSUL_GLOBAL_DIR)/tawassul`.
3. `XDG_CONFIG_HOME` gives `$XDG_CONFIG_HOME/tawassul`.
4. Otherwise `~/.config/tawassul`.

The key directory is `0700` and the key file `0600` on POSIX. On native Windows
the directory ACL is restricted to the current user with `icacls`; POSIX modes
are not claimed there. A key directory under `/mnt/` in WSL2 is warned about by
`doctor` because it is not a Linux filesystem.

## Logging

| Variable | Effect |
| --- | --- |
| `TAWASSUL_DEBUG=1` | Debug level |
| `TAWASSUL_LOG_JSON=1` | One JSON object per line |
| `TAWASSUL_LOG_FILE` | Append logs to this file |
| `TAWASSUL_QUIET` | Reduce console output; `1`, `true`, or a level name |

Logs never contain a provider key or a transcript payload. Redact a diagnostic
report before sharing it: see [troubleshooting](troubleshooting.md).

## Integration

| Variable | Effect |
| --- | --- |
| `TAWASSUL_DISABLED=1` | Registers nothing and returns immediately |
| `TAWASSUL_NO_AUTOCONFIG=1` | Do not generate the minimal OpenCode contract or seed the roster |
| `TAWASSUL_DB_MAINTENANCE=off` | Disable the background database maintenance trigger |
| `TAWASSUL_DB_SCRIPT` | Path to the database maintenance script |
| `TAWASSUL_MAX_CONTEXT_TOKENS` | Context budget used when packing a session |
| `TAWASSUL_CONTEXT_HANDOFF` | Enable session handoff independently of the config file |
| `TAWASSUL_CODE_STATE_AUTO` | Let code-state snapshots run without an explicit call |
| `TAWASSUL_GOAL_AUTOCLOSE=1` | Auto-close finished goals and mark old unfinished goals stale in the background sweep |

## Installer only

These variables are read by `install.sh`, the global installer, and `doctor`,
not by the plugin at runtime.

| Variable | Effect |
| --- | --- |
| `OPENCODE_BIN` | Host binary the installer probes for a version |
| `TAWASSUL_OPENCODE_VERSION` | Pin the host version instead of probing it |
| `TAWASSUL_ASSET_ROOTS` | Extra roots searched for the wasm grammars |

The host floor is `2.2.1`. When the host reports no version at all, the check
fails open and the plugin loads.

## What is not here

- Provider credentials. The host owns them, and the plugin never reads, stores,
  or logs an API key. No configuration key or environment variable accepts one.
- Tool permissions. They are declared by the host and enforced by the guard;
  see [permissions](permissions.md).
- Proof and gate variables. They belong to the development tree and are not part
  of the released plugin contract.
