# Upstream Evaluation: OpenCode 2.2.3, 2.2.4, 2.2.5

Date: 2026-10-31
Scope: Tawassul V2 plugin compatibility and concrete follow-up work.
Host under test: OpenCode 2.2.5 (downloaded to `/tmp/opencode/host-2.2.5`,
never installed globally).
Repository pins at evaluation time: SDK `2.2.1`, host minimum `2.2.0`,
audited host `2.2.1`, last live E2E host `2.2.2`.

## Verdict

No blocking incompatibility was found. The 2.2.5 host boots the plugin,
registers all 43 tools (the pre-task_control count; the current set is pinned by the generated tripwire), answers a model turn, and executes direct tools in an
isolated workspace. The SDK `promise/tool.d.ts` surface is unchanged between
2.2.1 and 2.2.5; the other Promise type changes are additive.

One concrete accounting defect was fixed: DeepSeek V4.1 Flash windows were
missing from the pricing/context catalog, so the context-pack budget capped
them at 128k even when the host declared 200k or 1M. Two follow-ups remain
open and are listed below.

## Compatibility evidence

- Isolated smoke on 2.2.5:
  `SMOKE PASS: host v2.2.5, scratch boot, 43 tools, model reply, health + help`.
  The 43-tool count is the pre-task_control value; the current set is pinned by
  the generated tripwire. The same script uses a scratch HOME, scratch XDG roots, a scratch database,
  and the built bundle; the live host and global install were untouched.
- SDK 2.2.1 vs 2.2.5 Promise declarations:
  `promise/tool.d.ts` and `promise/registration.d.ts` are byte-identical.
  `promise/plugin.d.ts` only adds `experimental.artifact`. `promise/session.d.ts`
  only documents instruction metadata. No existing Tawassul import path changed.
- `normalizeToolName("shell")` and `toolNameToV1("shell")` already map to
  `bash`; `tool-execute.ts` normalizes `input.tool` before the duplicate guard.
  The 2.2.5 `bash` to `shell` alias therefore reaches the same permission and
  dedup paths. `scripts/prove-shell-alias.ts` already covers this.

## Release matrix

### 2.2.3

| Change | Tawassul impact | Verdict |
|---|---|---|
| OpenTUI 0.8 peer requirement (`#60385`) | The plugin ships no TUI surface and has no `@opentui` dependency. | No action |
| Managed policy split into `mcp.use`, `skill.use`, `plugin.use` (`#60315`) | The plugin emits no managed-policy rules. | No action |
| Claude Agent provider (`#58782`) | Host provider only. No catalog or routing dependency. | No action |
| Preserved plugin-provided model variants (`#60097`, `#60380`) | Tawassul dispatch carries provider/model only, no variant. | Optional |
| SDK `tool(...)` unification (`#60407`) | Tawassul uses plain tool objects; the Promise tool types did not change. | Aligned |
| Nested tool progress rows (`#60480`) | The plugin exposes no nested `execute` tool. | No action |

### 2.2.4

| Change | Tawassul impact | Verdict |
|---|---|---|
| Experimental artifacts (`#60351`) | New SDK surface; not adopted. | Optional |
| Schedules under `opencode serve` (`#60478`) | Tawassul's coordinator runs database maintenance, not host user schedules. | No action |
| Raised OpenCode Go limits for DeepSeek V4.1 Flash (`#60625`) | The context catalog lacked both V4.1 Flash entries. | Fixed |
| Provider overrides for names, limits, variants (`#60597`) | The plugin reads the host limit but still caps known models by its own table. | Open, minor |
| Persistent session terminals (`#60346`) | No terminal surface in the plugin. | No action |

### 2.2.5

| Change | Tawassul impact | Verdict |
|---|---|---|
| Percentage `compaction.buffer` (`#60647`) | Tawassul keeps its own 25 percent / 16k-floor reserve and does not read the host buffer. | Open, minor |
| `bash` to `shell` alias (`#60687`) | Already normalized at the hook and bridge boundaries. | Aligned |
| Compaction prompt capped at the model window (`#60660`) | Host-side; the context hook still records `session.compaction.ended`. | No action |
| Reasoning preserved across model switches (`#60498`) | Host-side; `thread continue` passes a model, not message parts. | No action |
| MCP messages above 10 MiB (`#60694`) | The plugin runs no MCP server. | No action |
| LiteLLM context errors trigger compaction (`#60692`) | Host-side; a compaction still reaches the existing hook. | No action |

## Findings

1. **Fixed: DeepSeek V4.1 Flash context windows.**
   `DEFAULT_PRICING_MODELS` had no `deepseek-v4.1-flash-free` or
   `opencode-go/deepseek-v4.1-flash` entry. `resolveModelWindow` therefore
   treated both as unknown and capped them at `MIN_TRUSTED_WINDOW` (128k).
   The free model declares 200k and the Go model declares 1M, so the portable
   handoff fired far earlier than needed. Both entries now carry their
   measured limits: free 200k/32k output at zero cost, Go 1M/384k output at
   0.15/0.60 per million tokens with 0.003 cache read. The context-budget
   proof asserts the confirmed windows and the cap on a larger declaration.
   Revision 2.4 update (2026-11-07): the catalog is now filler only. A host
   declaration at or above 2,000 tokens is taken verbatim, the catalog fills an
   absent declaration, and the fallback is 200k; the cap on a larger declaration
   was removed, so the proof now asserts host pass-through instead.

2. **Open, minor: `compaction.buffer` above 25 percent.**
   Tawassul reserves `max(16k, window/4)`, capped at `window/2`, and transfers
   when the remaining byte budget falls below 1,024 bytes. A user who sets a
   host `compaction.buffer` above that reserve makes the host compact before
   Tawassul's own overflow gate can transfer. The safe fix is to read the host
   buffer, convert a percentage against the resolved window, and use the larger
   of the two reserves. The plugin currently has no host config channel, so
   this needs a deliberate config reader or a Tawassul-side override. It is not
   a data-integrity bug: an earlier host compaction still preserves the
   conversation, it only skips the portable pack transfer.

3. **Open, minor: provider limit overrides are capped by the static table.**
   `resolveModelWindow` takes `min(host limit, catalog limit)`. A user or
   project override that raises a known model above its public limit is
   ignored. The same mechanism protects against overstated host values, so a
   fix should be opt-in (for example a `trustHostWindow` switch) rather than a
   blanket removal of the cap.
   Revision 2.4 update (2026-11-07): resolved by owner decision. The
   `min(host, catalog)` cap was removed; the host is trusted at or above the
   2,000-token sanity floor, and the catalog fills only an absent declaration.

4. **Optional: artifacts for reports.**
   The 2.2.4 artifact API could publish HTML evaluation or E2E reports instead
   of text-only tool output. It is experimental and adds a storage provider
   surface, so it is not recommended for 0.1.0.

5. **Optional: variant-aware `thread continue`.**
   The host now preserves plugin-provided variants. `thread continue` accepts
   `provider/model` only. Supporting `provider/model#variant` would be a small
   additive change, but no current workflow needs it.

## Upgrade recommendation

2.2.5 is compatible enough for an isolated upgrade rehearsal, not for an
immediate pin bump. The audited ceiling remains 2.2.1 until the SDK is bumped
to 2.2.5, the upstream registry records 2.2.3 through 2.2.5, and the full
`npm run ci` runs against the new SDK. The live host stays at 2.2.2 and the
global install is unchanged.
