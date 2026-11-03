# Languages

English is canonical. Every tool description, agent definition, skill, error
message, and document is written in English first. A translation follows the
English source; it never becomes a second source of truth.

## Current state

| Surface | Languages | Status |
| --- | --- | --- |
| Runtime strings (`src/i18n/*.json`) | `en`, `ar` | Both tables present, 606 keys each |
| Tool and agent descriptions | `en` | English only |
| Public documentation | `en` | 42 documents, enforced by `check:docs` |
| Documentation translations | - | Planned; none published yet |

The Arabic runtime table is a real translation of the interface strings, not a
placeholder. It is at key parity with English at this release. A native review
is welcome; a correction is a normal pull request.

## What is translated

Runtime strings are the short texts the plugin itself emits: status lines,
warnings, and confirmations. They are loaded from `src/i18n/en.json` and
`src/i18n/ar.json` through `src/translations.ts`.

These are **not** translated at runtime:

- tool names and argument names;
- identifiers such as `G-001`, `H-001`, `R-001`;
- command names such as `/tawassul-goals`;
- file paths, environment variable names, and configuration keys;
- log messages that are diagnostic rather than user-facing.

A translated sentence may quote a literal identifier. The identifier stays
exactly as written.

## Documentation languages

The order of delivery is:

1. `en` - canonical, complete.
2. `ar` - the full user-facing set.
3. `fr`.
4. `es`.
5. `zh-CN`.
6. `ru`.

A documentation translation is published only when:

- every heading and table in the English source has a counterpart;
- every internal link resolves inside the translated tree;
- commands, paths, and identifiers are unchanged;
- the translated page names the English page it follows and the commit it was
  translated from.

Documentation translations live under `docs/i18n/<lang>/`. They are outside the
English-only gate by design. A translated page that falls behind its English
source is marked as stale in its header rather than silently mixed.

## Adding a runtime language

1. Copy `src/i18n/en.json` to `src/i18n/<lang>.json`.
2. Translate values only. Keys stay identical.
3. Keep placeholders such as `{version}` intact.
4. Register the table in `src/translations.ts`.
5. Check parity: the new file must have the same key set as English.
6. Run `npm run typecheck` and `npm run build`.

A missing key falls back to English. A key with no English source is a defect:
it cannot be reached.

## Rules that do not bend

- No Arabic outside `src/i18n/ar.json` in code, and none in the English
  documentation set. `npm run check:rules` and `npm run check:docs` enforce this.
- A translation does not change a technical claim. If the English says "no
  database lane on Windows", the translation says the same thing.
- Machine translation is a draft. A language is listed as available only after a
  speaker has reviewed the user-facing pages.

## Why English first

The plugin runs inside an English-first host, its tool schemas are English, and
its error strings are read by models as well as people. A single canonical
language keeps the tool surface, the proofs, and the documentation aligned. The
translation layer exists for the people who use the product, not for the code
that implements it.
