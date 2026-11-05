# Architecture

Tawassul is a single plugin process hosted by OpenCode. It has no server of its
own, no daemon, and no network listener. Everything below runs inside the host
process, beside the workspace it serves.

## Layers

```
src/index.ts                 plugin entry: id, server init, v2 setup
  src/v2/                    host adapter: schemas, sessions, events, results
  src/bootstrap/             startup order, service factory, tool and hook wiring
  src/context/               per-workspace state: config, agents, models, ledger
  src/services/              domain logic: goals, handoffs, context packs, health
  src/tools/                 the 44-tool surface
  src/hooks/                 guards that run before a tool effect
  src/utils/                 paths, atomic writes, logging, validation
```

A layer is expected to call downward. A tool calls a service; a service calls a
manager; a manager writes through `src/utils`. Two narrow exceptions exist and
are deliberate: `src/utils/opencode-config.ts` reads the proxy fallback chain
list from a service, and `src/context/tawassul-state.ts` imports one pause-state
type from the tool layer. Neither creates a cycle, and neither is a pattern to
copy for new code.

## Entry and host adaptation

`src/index.ts` exports one object through `Plugin.define`:

| Member | Role |
| --- | --- |
| `id` | `tawassul` |
| `server` | `initPlugin`, the host-agnostic initialiser |
| `setup` | `createV2Setup()`, the v2 adapter |

The v2 adapter owns everything that is specific to the host API:

- it checks the required domains (`session`, `tool`) and refuses to start when
  one is missing;
- it registers the tools with their JSON schemas and refreshes those schemas
  when the host reports a change;
- it maps host events into the internal event shape;
- it bridges a tool result back into the host's metadata and text;
- it registers the four skills and the single slash command;
- it installs the session bridge used by context packing;
- it returns one dispose function that unregisters every registration.

If a project-scope copy of the plugin is present while the global copy loads,
the global copy delegates to the project copy and steps aside. If that
delegation fails, the global copy continues on its own and logs the failure.
One workspace never runs two copies.

## Startup order

`initPlugin` is deterministic and instrumented. The order is:

1. Passive self-check and arming of the database maintenance trigger.
2. Quiet-mode decision for a filesystem-root or home-directory workspace.
3. A process-level uncaught-exception handler, reference counted per init.
4. Coexistence claim: a second copy yields instead of registering twice.
5. Context construction: paths, install scope, managers, event hub.
6. Config load and validation.
7. Service construction through one factory.
8. Tool registry construction, with an assertion that the registered names match
   the declared surface.
9. Hook construction and registration.
10. Init completes; the host may call tools.

Init has a deadline (30 seconds by default) and an abort signal that every stage
checks. A stage that fails records the error and stops the remaining stages
instead of registering a half-built plugin. A failure inside one skill
registration is contained and does not abort the rest.

## A tool call

```
host tool hook
  -> permission guard (role, consent, path, dispatch limits)
  -> tool handler
  -> service
  -> manager
  -> durable write (temp, fsync, rename) and HMAC where state is persisted
  -> result bridge (text and metadata back to the host)
```

The guard runs first, so a denied call performs no partial work. A tool that
changes state writes through the same durable path as the installer; there is no
second, weaker writer. A tool that reads files resolves the path against the
workspace and refuses a traversal.

## Per-workspace context

`TawassulContext` is created once per workspace and holds:

| Manager | Responsibility |
| --- | --- |
| `ConfigManager` | Load and merge the global and project configuration |
| `StateManager` | Records, handoffs, dynamic agents, persistence and capping |
| `AgentManager` | The active roster, custom agent files, refresh |
| `ModelManager` | Per-agent model map, preferences, model cache |
| `PreferenceManager` | Strictness and user preferences |
| `TimerManager` | Every timer the plugin owns, cleared on dispose |
| `EventHub` | Internal events, metrics, subscribers |

The context also exposes facades: small functions grouped by concern
(`config`, `state`, `agent`, `rule`) so a service depends on a narrow surface
instead of the whole context object.

Three advisory services sit beside the managers: `ProjectIndexService` records
files, symbols, and import edges; `ReadCacheService` reuses a read only while
its file and directory stamps still match; `TaskContextService` builds a
bounded bundle for orchestration. Each has a kill switch, none can block a tool,
and all counters are derived on demand. `health` prints an `intelligence` block,
`dashboard` adds one line, and `report` adds a block. A
`CACHE_CLEANUP_REQUESTED` event clears the read cache only; `MEMORY_EMERGENCY`
also drops the in-memory index, which reloads from disk on the next read.

## Persistence

| Data | Location | Format |
| --- | --- | --- |
| Plugin state | `<workspace>/.opencode/tawassul-state.json` | JSON with an HMAC |
| Goal ledger | State directory, `goals/` | Append-only `goals.jsonl` plus a meta file |
| Context packs | `$XDG_DATA_HOME/tawassul/context-packs/<workspace-hash>/` | Pack files per workspace |
| Database | The host's own SQLite database | Never written by the plugin directly |
| Key | Key directory, `0600` / `icacls` | 32 random bytes |

The goal ledger is append-only. A torn tail from an interrupted write is
detected and skipped, and the meta file is healed from the ledger rather than
trusted over it. The state file is replaced atomically and carries an HMAC; a
file signed by another device's key is treated as foreign and the session turns
read-only instead of trusting it.

Workspace identity is derived from the project root and the install scope. Two
workspaces get different state directories and different context pack hashes, so
a pack written in one workspace is not discovered by another.

## Failure containment

| Failure | Behaviour |
| --- | --- |
| Host missing a required domain | Setup returns a no-op dispose and logs the missing domain |
| Init stage throws | Later stages are skipped; the error is reported once |
| Init exceeds its deadline | The init promise aborts; the host keeps running |
| A skill fails to register | That skill is skipped; the plugin and other skills stay live |
| A tool throws | The error is returned as the tool result; the process stays up |
| A state file is foreign or tampered | The session becomes read-only; no key is created |
| The process receives a signal | Dispose clears timers, unregisters tools, and detaches handlers |

There is no global retry loop. A failure is surfaced with its cause, because a
retry that hides a broken invariant is worse than a visible error.

## Build

`bun build-v2.mjs` produces two artifacts from the same sources:

| Artifact | Purpose |
| --- | --- |
| `dist/index.js` | Project-scope bundle, host dependencies external |
| `dist/global.js` | Self-contained bundle the global installer ships |

The bundle embeds the source commit so `--verify` can name the exact tree it was
built from. The wasm grammars are not embedded; they are staged beside the bundle
by the installer and recorded in its marker, so an uninstall removes exactly
those files.

The build is deterministic for a fixed commit: the same tree produces the same
bytes, which is what makes the hash in the marker meaningful.
