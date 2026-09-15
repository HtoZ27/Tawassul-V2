# Shared Issues Log — Tawassul v1 <-> v2

Every entry records a problem shared by both versions, how it was fixed, and anchors to the actual code in each version.

Format rules (enforced by `scripts/check-shared-anchors.mjs`):
- `v1/` prefix anchors into `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/`
- bare anchors resolve inside this V2 project
- every anchor must exist in the referenced file
- content is English only

---

## S-001 Plugin entry shape

The v1 plugin is a function returned inside an object; the v2 plugin must be constructed with `Plugin.define`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/plugin.ts:12` — default export `{ id, server }` where server is the real entry |
| v1 fix | `v1/plugin.ts:12` — single-file artifact re-exports it; runtime discovers without `plugin:` config |
| v2 problem | `src/index.ts:4` — `Plugin.Plugin.define` only accepts `{ id, setup }`, cannot carry a v1 `server` |
| v2 fix | `src/index.ts:6` — plain object `{ id, server, setup }`; the host ducks-types whichever field it recognizes |

## S-002 ESM package exports break require.resolve

`@opencode/plugin@2.0.3` ships `exports` conditions with no CJS `main`; `require.resolve` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/build.mjs:27` — external list is static via `bun build` (no runtime resolve) |
| v1 fix | `v1/build.mjs:56` — external packages resolve via upward node_modules walk at load time |
| v2 problem | `build-v2.mjs:12` — first cut used `createRequire` resolve → crashed |
| v2 fix | `build-v2.mjs:14` — `import.meta.resolve` honors ESM `exports` conditions |

## S-003 Tool execute return type

v2 tool `execute` must return `Promise<Result>` in the promise API domain; an Effect is not awaited by the caller.

| | Anchor |
| --- | --- |
| v1 problem | `v1/plugin-types.ts:15` — v1 hook contract wraps tool results via `Omit<OfficialHooks, ...>` |
| v1 fix | `v1/bootstrap/plugin-init.ts:794` — return object builds `tool.execute` callbacks directly |
| v2 problem | `src/v2/adapters.ts:42` — v1 `ToolResult` is `string | { output, metadata }`, not a v2 `Tool.Result` |
| v2 fix | `src/v2/adapters.ts:72` — `return toV2Result(result)` bridges the return inside `makeV2Tool.execute` |

## S-004 Version double-guard (fail-open)

The merged bundle must refuse to run on the wrong host instead of half-initializing.

| | Anchor |
| --- | --- |
| v1 guard | `v1/plugin.ts:12` — v1 runtime loads this file only; no `>=2` host exists |
| v2 guard | `src/v2/setup.ts:122` — capability probe aborts setup when session/tool domains are missing |

## S-005 Minimal-surface port for type closures

The v2 build is incremental: `context/constants.ts` needed `getAllowedToolsForRole` (via `agent-templates → render-agent`), but the full `security-policy.ts` drags Arabic i18n/NLP closures (translations, stem, arabic-roots.json) that are not yet ported. The port only copies what the render path needs.

| | Anchor |
| --- | --- |
| v1 problem | `v1/security-policy.ts:641` — role→tool map + `getAllowedToolsForRole` (dedicated 20-line section) |
| v1 fix | `v1/security-policy.ts:666` — single source of truth for the role matrix |
| v2 problem | `src/security-policy.ts:1` — naive full port pulled translations + stem + JSON NLP data |
| v2 fix | `src/security-policy.ts:5` — minimal map + function, no dependency on i18n/NLP |

## S-006 Arabic code references survive auto-port

The port strips comments and skips Arabic-literal files, but bilingual language machinery (locale maps, `"ar"` display fields, `lang: "ar" | "en"` parameters, agent instructions naming Arabic) can survive as valid ASCII and pass `check:rules`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/core/model-registry.ts:22` — every entry carries `display: { ar, en }` bilingually |
| v1 fix | `v1/security-policy.ts:666` — v1 is intentionally bilingual via the translations service |
| v2 problem | `src/core/model-registry.ts:11` — bilingual display shape and `lang` params survived auto-port |
| v2 fix | `src/core/model-registry.ts:11` — single `string` display, `lang` params dropped (English-only) |

## S-007 Full-tree port re-writes hand-fixed files

Re-running the tool with no args (`node scripts/port-from-v1.mjs`) copies every clean v1 file and overwrites manual English rewrites of files that contain no Arabic literals. After the full-tree pass, `model-registry.ts`, `constants.ts`, `priority-types.ts`, and `context/types.ts` silently regressed to bilingual shapes.

| | Anchor |
| --- | --- |
| v1 problem | `v1/core/model-registry.ts:22` — clean file (bilingual strings, no Arabic script) re-portable |
| v1 fix | `v1/core/model-registry.ts:177` — caller contract: `getUserFacingModelName(id)` takes no `lang` |
| v2 problem | `src/core/model-registry.ts:11` — bilingual display shape reintroduced after manual fix |
| v2 fix | `src/core/model-registry.ts:11` — single `string` display restored; manual files must be re-checked after any full-tree port |

## S-008 English-locked translations stub

The v2 build needs `translations.ts` (SKIP_FILES) for 36 importers, but the v1 file statically imports both `i18n/en.json` and Arabic-heavy `i18n/ar.json` and a logger. The v2 stub is English-only: `Lang = "en"`, locale cache holds only the English dictionary, `ar` resolution removed.

| | Anchor |
| --- | --- |
| v1 problem | `v1/translations.ts:1` — imports `ar` + `en` JSON and `utils/logger` |
| v1 fix | `v1/i18n/en.json:1` — full English dictionary (single source for v2 stub) |
| v2 problem | `src/translations.ts:1` — stub must exist for 36 importers but must not pull Arabic |
| v2 fix | `src/translations.ts:5` — English only, no logger dependency, `t` resolves from `en` |

## S-009 Dual-entry v1/v2 adapter (reference: oh-my-opencode-slim)

Cross-version plugin pattern proven by the third-party `oh-my-opencode-slim` package (studied at ~/Desktop/oh-my-opencode-slim-3.0.0-beta.10): one default export `{ id, server, setup }` — the v1 host loads `.server` (the unchanged v1 factory), the v2 host loads `.setup(ctx)` (an adapter). The adapter wraps the SAME v1 factory so all build logic is reused, then translates the returned v1 hooks into v2 registrations: agent/tool/command drafts, the session context hook (system/messages transforms), the `session.prompt` hook (with context-hook fallback on older hosts), tool `execute.before/after` hooks, and the event subscription. Each bridged hook is individually try/catch-guarded. Reference modules in the study package: `src/v2/index.ts`, `src/v2/setup.ts`, `src/v2/adapters.ts`, `src/v2/types.ts`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/plugin.ts:12` — v1 host calls `.server`; v2 host has no `.server` path |
| v1 fix | `v1/plugin.ts:12` — v1 shape kept untouched as `.server` |
| v2 problem | `src/index.ts:4` — entry was `Plugin.Plugin.define`, single-host only, no `server` field |
| v2 fix | `src/index.ts:7` — `{ id, server, setup }` dual export; `setup` is `createV2Setup()` which wraps `initPlugin` via the v2 shim |

## S-010 Conflict-marker debris from stale lint-staged stash applies

A stale lint-staged automatic-backup stash applied onto a much newer HEAD leaves `<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes` markers inside tracked files. In v1 this hit 38 files at once — `opencode.json` (breaks OpenCode boot with a JSONC parse error), plugin sources, tests, docs, and the built `dist/`. The port tool copies v1 files verbatim, so without a guard the marker debris ports straight into v2 sources and fails `check:rules`.

Resolution in v1 is a git operation, not a code edit: take the HEAD ("Updated upstream") side of every hunk, drop the stale stash side, restage, and rebuild `dist/`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/scripts/gen-opencode-config.ts:53` — `<<<<<<< Updated upstream` marker inside the import block |
| v1 fix | `v1/tool-names.ts:45` — keep the HEAD side of each hunk; the stale stash side is dead weight |
| v2 problem | `scripts/port-from-v1.mjs:82` — `readFileSync` reads whatever v1 has, markers included |
| v2 fix | `scripts/port-from-v1.mjs:9` — conflict-marker regex; `scripts/port-from-v1.mjs:83` — SKIP guard runs before the write |

## إصلاحاتُ 2.0.0 المشتركة (مصدرُ الحقيقة: Tawassul V2/src)

| # | الإصلاحُ | الملفُ في v2 | الأسطرُ المتأثرةُ | النمطُ المُستبدَلُ |
|---|---|---|---|---|
| P1 | **un-stick البنودِ العالقة** | `src/services/mission-board.ts` | `updateStatus` (المقطع 212-214) | أُضيفَ مسارُ rebuild+retry عند غيابِ الفهرسِ العكسي — بندٌ حقيقيٌّ يظلُّ قابلاً للوصول دائماً |
| P2 | **unref نافذةِ الحفظِ 3s** | `src/services/state-persistence.ts` | نافذةُ السحبِ 3s | `setTimeout(...)` + `unref()` — لا تُبقى العمليةُ حيَّةً بسببِ النافذة |

### النقطةُ الخلافيةُ الباقية: sessionId (بانتظارِ قرارِ توقيعِك)
تُكسرُ الحلقةُ جذرياً بأن يحملَ كلُّ بندٍ معرفَ الجلسةِ المنتِجةِ فلا يُعيدُ النموذجُ بنودَ جلسةٍ أخرى. المواضعُ الثلاثةُ في v2:
- `TaskItem` في `src/services/mission-board.ts` (سطر 24): أضِفْ `sessionId?: string;`
- `updateStatus` (سطر 212): استقبِلْ `sessionId` ومرّرْه
- `getBoard` (سطر 244): اعرضْهُ كي يرى النموذجُ «منجَزٌ في جلسةٍ أخرى»

## S-011 Status-change index sync + session provenance (loop guard) — TRANSFERRED, for v2 agents to implement

`updateStatus` persists the board but never refreshes `index.json`, so a finished board can keep showing as `active` there and the model re-queues done work in a loop. Separately, `TaskItem` carries no session identity, so the model cannot tell work done by another session apart from its own. Ownership: v1 side states the problem and the proven fix shape; v2 agents implement in this tree.

| | Anchor |
| --- | --- |
| v1 problem | `v1/services/mission-board.ts:224` — `persistAndLog` without `scheduleIndexWrite` inside the status-change path; no `sessionId` anywhere in the file |
| v1 fix shape | `v1/services/mission-board.ts:232` — stale-index rebuild + retry (un-stick) covers the write path only, not the index or provenance |
| v2 problem | `src/services/mission-board.ts:240` — persist without index sync in `updateStatus`; `src/services/mission-board.ts:24` — `TaskItem` without session identity |
| proposed v2 fix | in `src/services/mission-board.ts:240` call `scheduleIndexWrite()` after `persistAndLog`; add `sessionId?: string` to `TaskItem` at `src/services/mission-board.ts:24`, accept it via `updateStatus` at `src/services/mission-board.ts:208`, store and emit it, carry it on the event at `src/services/event-hub.ts:77`, and render it in `src/tools/tawa/show-board.ts:45` |
