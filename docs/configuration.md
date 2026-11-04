# Configuration

Tawassul reads two JSON-with-comments files. Both are optional; with no file at
all the plugin runs on its defaults.

| Scope | Path | Loaded |
| --- | --- | --- |
| Global | `~/.config/opencode/tawassul.jsonc` (legacy: `tawassul.json`) | First, for every workspace |
| Project | `<workspace>/.opencode/tawassul.json` | Second, over the global file |

`TAWASSUL_GLOBAL_DIR` moves the global root. `configFile` renames the project
file; it is read from the global file, so it must be set there to take effect.

`tawassul.schema.json` in the repository root is the JSON Schema generated from
the same Zod definition; editors can use it for completion and validation.

## Merge order

1. The global file is parsed and validated.
2. The project file is parsed and validated.
3. The project values win, key by key.
4. Objects merge deeply: `agentEvaluation`, `innovations`, `agentModels`,
   `routing`, `rateLimits`, `freeLimit`, `fallback`, and `health` keep their
   global keys and override only the keys the project file states.
5. In `agentModels`, a model list is concatenated (global first), not replaced.
6. In project scope, `agents` and `deleted` are removed from the global file
   before the merge, so the global roster does not silently edit a workspace.

A file that fails validation is ignored as a whole and a warning is logged with
the failing key path. A missing file is not an error. Unknown top-level keys are
dropped by the schema; a wrong type or an out-of-range number rejects the file.

Configuration is read at plugin init. Restart the host after editing a file.

## Keys

### Lifecycle

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `disabled` | boolean | `false` | Registers nothing and leaves the workspace untouched |
| `language` | `"en"` or `"ar"` | `"en"` | Language of the tool descriptions and runtime strings |
| `stateFile` | string | `tawassul-state.json` | State file name beside the workspace state |
| `configFile` | string | `tawassul.json` | Project config file name under `.opencode/` |

### Team

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `team` | string array | `[]` | Extra agents treated as team members during routing and validation |
| `agents` | object | `{}` | Agent definitions merged into the shipped roster |
| `deleted` | string array | `[]` | Agents removed from the active roster |
| `maxDynamicAgents` | 1–100 | `50` | Cap on agents added at runtime; the oldest are dropped past the cap |
| `strictness` | `relaxed`, `normal`, `strict` | `normal` | How strictly a delegation is validated before it is accepted |

`agents` and `deleted` are global-scope keys. A project file that sets them
still applies them to that workspace, but the global file cannot force them onto
every workspace.

### Retention

| Key | Range | Default | Effect |
| --- | --- | --- | --- |
| `maxRecords` | 10–10000 | `5000` | Oldest records are dropped past the cap |
| `maxHandoffs` | 10–10000 | `2000` | Oldest handoffs are dropped past the cap |
| `maxCompactItems` | 5–200 | `20` | Items kept when a ledger is compacted |

Trimming happens on write, oldest first, and is logged at debug level. A record
that matters beyond the cap belongs in a goal or a document, not in the tail of
a queue.

### Dispatch limits

| Key | Range | Default | Effect |
| --- | --- | --- | --- |
| `maxCallDepth` | 1–20 | `3` | Nested `task()` depth before dispatch is refused |
| `maxTotalTasks` | 1–100 | `25` | Total `task()` calls allowed in one session |

Both limits exist to stop a delegation loop from consuming a session budget.
The refusal is explained in the tool result, with the alternative (use a
handoff, or split the task) named.

### Iteration budgets

An iteration budget is the number of model turns an agent may spend on one
dispatch.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `iterationBudgets` | object of numbers | `{}` | Per-agent budget, keyed by agent name without `@` |
| `adaptiveBudgets` | boolean | `true` | Raise a budget after a dispatch exhausts it |
| `projectScale` | `small`, `medium`, `large` | `medium` | Multiplies every tier by `0.7`, `1`, or `1.6` |
| `budgetStepPercent` | 0–200 | `50` | Growth applied when a budget is raised |
| `budgetCeilingFactor` | 1–20 | `4` | Hard ceiling as a multiple of the initial budget |
| `budgetTiers` | object of numbers | see below | Base budget per task tier |

Tier bases: `shallow` 60, `moderate` 100, `deep` 160, `analyze-first` 320.
Agent bases: parent 90, subagent 60.

```jsonc
{
  "projectScale": "large",
  "iterationBudgets": { "dev": 120, "reviewer": 80 },
  "budgetTiers": { "deep": 200 },
  "adaptiveBudgets": true,
  "budgetStepPercent": 25,
  "budgetCeilingFactor": 3
}
```

`iterationBudgets` wins over a tier base for that agent. `adaptiveBudgets`
raises the effective limit up to the ceiling; setting it to `false` makes every
budget fixed.

### Agent evaluation

| Key | Default | Effect |
| --- | --- | --- |
| `agentEvaluation.enabled` | `true` | Score completed dispatches |
| `agentEvaluation.minCompletionRatio` | `0.3` | Below this, an agent is flagged |
| `agentEvaluation.minContextLengthAvg` | `10` | Minimum average context length |
| `agentEvaluation.minTaskLengthAvg` | `5` | Minimum average task length |
| `agentEvaluation.minRecordsPerAgent` | `1` | Minimum records before scoring counts |

### Models and routing

| Key | Type | Effect |
| --- | --- | --- |
| `agentModels` | object | Per-agent model list and capability label. Lists merge across scopes |
| `routing.applyAgentMatcherSuggestion` | boolean | Let the router apply a suggested agent match |
| `fallback` | object | `enabled`, `maxSwitches`, `cooldownMs`, and per-role `chains` |
| `rateLimits` | object | Burst, concurrent, and sliding windows, plus retry pacing |

Model entries take the shape the host uses:

```jsonc
{
  "agentModels": {
    "dev": {
      "capability": "implementation",
      "models": [
        { "model": "provider/strong-model" },
        { "model": "provider/cheap-model", "options": { "temperature": 0.2 } }
      ]
    }
  }
}
```

When the first model in a chain fails and `fallback.enabled` is true, the next
one is tried, up to `maxSwitches`, with `cooldownMs` between switches.

Rate limits default to 3 calls per second burst, 10 concurrent, and 20 per
minute sliding, returning to burst mode after 30 seconds of quiet.

### Health and discussions

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `health.stuckTimeoutMs` | 1000–300000 | host default | A handoff older than this is reported stuck |
| `health.circuitBreakerThreshold` | 1–100 | host default | Failures before an agent is cut off |
| `health.circuitBreakerResetMs` | 1000–3600000 | host default | Time before the breaker is retried |
| `consensusBroker` | boolean | `false` | Enable the consensus broker in discussions |
| `privacyGuardParanoid` | boolean | `false` | Apply the strictest privacy guard to outbound text |
| `freeLimit` | object | `{}` | `notice` and `noRetry` for a free-tier provider |
| `innovations` | object | `{}` | Experimental switches; `contextHandoff` is the only one |

### Example

```jsonc
{
  // Team and language
  "language": "en",
  "strictness": "strict",
  "team": ["@dev"],

  // Retention
  "maxRecords": 4000,
  "maxHandoffs": 1500,

  // Dispatch
  "maxCallDepth": 4,
  "maxTotalTasks": 40,
  "projectScale": "large",

  // Models
  "agentModels": {
    "architect": { "models": [{ "model": "provider/strong-model" }] }
  },
  "fallback": { "enabled": true, "maxSwitches": 2, "cooldownMs": 5000 }
}
```

## Environment variables

Only variables with behaviour verified in the source are listed. A variable that
is not here is either internal to a proof or has no documented contract.

### Lifecycle

| Variable | Effect |
| --- | --- |
| `TAWASSUL_DISABLED=1` | Registers nothing and returns immediately |

### Paths and scope

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

### Keys and consent

| Variable | Effect |
| --- | --- |
| `TAWASSUL_HMAC_KEY_DIR` | Key directory; wins over the default beside the config root |
| `TAWASSUL_CONSENT_TOKENS` | Path to `consent-tokens.json` |

### Logging

| Variable | Effect |
| --- | --- |
| `TAWASSUL_DEBUG=1` | Debug level |
| `TAWASSUL_LOG_JSON=1` | One JSON object per line |
| `TAWASSUL_LOG_FILE` | Append logs to this file |
| `TAWASSUL_QUIET` | Reduce console output; `1`, `true`, or a level name |

### Installer only

| Variable | Effect |
| --- | --- |
| `OPENCODE_BIN` | Host binary the installer probes for a version |
| `TAWASSUL_OPENCODE_VERSION` | Pin the host version instead of probing it |
| `TAWASSUL_ASSET_ROOTS` | Extra roots searched for the wasm grammars |

### Integration

| Variable | Effect |
| --- | --- |
| `TAWASSUL_NO_AUTOCONFIG=1` | Do not generate the minimal OpenCode contract or seed the roster |
| `TAWASSUL_DB_MAINTENANCE=off` | Disable the background database maintenance trigger |
| `TAWASSUL_DB_SCRIPT` | Path to the database maintenance script |
| `TAWASSUL_MAX_CONTEXT_TOKENS` | Context budget used when packing a session |
| `TAWASSUL_CONTEXT_HANDOFF` | Enable session handoff independently of the config file |
| `TAWASSUL_CONTINUITY=1` | Enable the cross-platform liveness probe and interrupted-run detection |
| `TAWASSUL_CODE_STATE_AUTO` | Let code-state snapshots run without an explicit call |
| `TAWASSUL_GOAL_AUTOCLOSE=1` | Auto-close finished goals and mark old unfinished goals stale in the background sweep |

## What is not configured here

Provider credentials belong to the host. The plugin never reads, stores, or logs
an API key, and no configuration key accepts one. A model is named as
`provider/model`; the host resolves it with its own credentials.

Tool permissions are declared by the host and enforced by the plugin's guard.
There is no configuration key that widens a tool's access.
