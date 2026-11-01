# Context baselines

Dated, read-only measurements of the context Tawassul V2 injects into the model.
Each artifact is a frozen measurement of one host build; later proofs cite the
artifact instead of re-measuring a live store.

## Naming

`YYYY-MM-DD-context-baseline.json`, one file per measurement date. The date in
the filename is the UTC measurement date and matches the `date` field inside the
artifact.

## Immutability

- A committed baseline is never edited or overwritten. A new measurement on a
  later date creates a new file.
- `scripts/measure-context-baseline.ts` refuses to overwrite an existing dated
  file. `--force` exists only to correct an uncommitted draft of the same date
  before that draft is committed.
- The writer marks the artifact read-only (`0444`). Git does not preserve the
  write bit, so a fresh checkout may show `0644`; the no-overwrite guard and
  this convention are the authoritative protection, not the mode bit.
- Later proofs read the newest artifact. They never re-measure the live store
  for a published number.

## Method

The writer boots the built `.opencode/plugin/tawassul.js` in a scratch
workspace with isolated state, XDG directories and database, then records:

- `schemaPayload` — `collectToolSchemas` followed by `measureSchemaPayload` over
  the whole tool JSON schemas.
- `descriptionText` — `measureDescriptionText`, one line per registered tool
  plus the total, in bytes and estimated tokens.
- `concordance` — the `buildConcordance` output at its once-per-session weight.
- `sessionDigest` — the documented composition and the empty-state floor.
- `i18n` — bundle weight, never injected into the model prompt.
- `registeredSkills` — one description-text line per plugin-registered skill
  plus the total. A body loads only when the skill is invoked, so it is excluded
  from the always-visible cost.

Estimated tokens are `ceil(bytes / 4)` everywhere.

## Required fields

`date`, `commit`, `method`, `toolCount`, `toolNameSetHash`, `schemaPayload`,
`descriptionText`, `concordance`, `sessionDigest`, `i18n`, `registeredSkills`.
A missing measurement is a proof failure; a size above a recorded budget only
opens a review.

## Adding a baseline

1. `npm run build`
2. `bun scripts/measure-context-baseline.ts`

The script writes today's file and refuses to touch an existing date. Run it
again with `--force` only while the current date's artifact is still an
uncommitted draft.

## Proof

`bun scripts/prove-context-baseline.ts` validates the newest artifact against
the generated tool tripwire and the recorded measurement shapes. It is wired
into the gate as the `context-baseline` proof step.
