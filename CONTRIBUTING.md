# Contributing

Thanks for considering a contribution. Tawassul is a small, gate-heavy project:
the rules below exist so that a change can be verified rather than trusted.

## Ground rules

1. **English only.** Code, strings, comments, commit messages, issues, and
   documentation are English. The single exception is a runtime translation
   table under `src/i18n/` for a non-English language.
2. **No comments in scanned code.** `.ts`, `.mjs`, and `.json` files under
   `src/`, `scripts/`, and `tests/` carry no comments. The only allowed
   directives are `// @ts-expect-error`, `// @ts-ignore`, and eslint
   disable/enable blocks.
3. **No secrets, no personal paths.** Do not commit a key, a token, a home
   directory path, or a machine name.
4. **One concern per pull request.** A fix and a refactor in the same branch
   make the proof run harder to read.
5. **A behaviour change needs a proof.** If you change what the plugin does, add
   or extend a proof under `scripts/` that fails before your change.

## Setup

```bash
nvm use
npm install
npm run build
```

The host loads `.opencode/plugins/tawassul.js` for this workspace. A global
install is opt-in and is not needed for development.

## Gates

Run these before opening a pull request. They run in order and each one is
cheap enough to run alone.

| Command | What it proves |
| --- | --- |
| `npm run typecheck` | TypeScript strict |
| `npm run check:rules` | English-only and no-comments |
| `npm run check:docs` | Public-doc links, language, allow-list, and surface drift |
| `npm run gate:fast` | Rules, config, facts, contract, parity, catalog |
| `npm run gate:proofs` | Every proof, one isolated child process each |
| `npm run gate:smoke` | Build and release smoke |
| `npm run verify` | Fast gate plus build |
| `npm run ci` | All three gate stages |

`npm run gate:proofs:1` … `:4` run balanced shards when you want a faster loop.
A proof that fails is a finding, not noise: report it, do not retry it until it
passes.

## Style

- Follow the surrounding code. Naming, file layout, and error shapes are
  consistent on purpose.
- Tool executions run in the promise domain; wrap an effect pipeline with
  `Effect.runPromise`.
- Fail closed. A guard that cannot decide must deny, and it must say why.
- Prefer a specific error over a silent fallback. When a fallback is correct,
  log it once and keep going.

## Commits

- Subject in the imperative mood, at most 72 characters, English.
- Body explains what changed and what evidence supports it.
- Reference the proof or gate that covers the change.
- Do not mix formatting-only edits with behaviour changes.

## Pull requests

A pull request is ready when:

- the gates above pass locally;
- the diff contains no unrelated edits;
- new behaviour is covered by a proof, and the proof fails without the change;
- documentation under `docs/` is updated when a user-visible behaviour changes;
- `NOTICE.md` is updated when a dependency is added or removed.

## Reporting a bug

Include the Tawassul version, the host version, the platform, the relevant
configuration (redacted), and the smallest reproduction you can produce. If the
bug is a security problem, follow [SECURITY.md](SECURITY.md) instead.
