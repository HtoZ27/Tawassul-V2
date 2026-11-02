# Upgrading

Tawassul follows the host's plugin model: the installed artifact is a bundle plus
a staged runtime, and an upgrade replaces both while keeping your state. This
page describes the supported paths and what to do when one refuses.

## Before you upgrade

1. Read the release notes for the version you are moving to.
2. Back up state if the release notes mention a state layout change. The
   commands are in [state](state.md#backup).
3. Keep the bundle you are replacing if you may need to roll back.
4. Stop the host. Replacing a bundle under a running host is undefined.

## A patch upgrade

```bash
git pull
nvm use
npm install
npm run build

bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

The installer compares the bundle and the staged assets against the marker. When
they already match, it prints `already installed` and writes nothing. When they
differ, it replaces the bundle through a durable write, re-stages the wasm
grammars, and rewrites the marker.

State is not touched. Goals, records, handoffs, and context packs keep their
paths, and the state version migrates in place when a release changes the
schema.

## Project-scope upgrade

```bash
git pull
npm install
npm run build
```

The build writes `.opencode/plugins/tawassul.js`. Restart the host. There is no
installer step and no marker to update.

## Downgrading

There is no automatic downgrade. To return to an earlier build:

1. Stop the host.
2. Rebuild the earlier commit.
3. Install it over the current one.
4. Verify.

```bash
git checkout <earlier-commit>
npm install
npm run build
bun scripts/install-global.ts --verify
```

If the newer version migrated the state schema, the earlier build may refuse the
state or read it as foreign. That refusal is deliberate. Restore the backup you
took before upgrading instead of forcing the file.

## What is preserved

| Preserved | Not preserved |
| --- | --- |
| State file and goals | A hand-edited installed bundle |
| Records, handoffs, boards | A stale `.pre-force-*` copy (removed by the next install) |
| Context packs | Files under the runtime directory the installer did not write |
| Configuration files | Nothing else is removed |
| HMAC key | |
| Agent roster files | |

The installer removes exactly the runtime files recorded in its marker. A file it
did not write is kept and reported.

## When the installer refuses

| Message | Meaning | Action |
| --- | --- | --- |
| `target exists without a Tawassul marker` | A foreign file occupies the target | Move it away; use `--force` only for a Tawassul bundle that lost its marker |
| `bundle hash mismatch` | The installed file changed after install | Reinstall; do not hand-edit |
| `host v… is outside the supported range` | The host is below the floor | Upgrade OpenCode |
| `ownership record belongs to another tree` | Another install owns the target | Use `--takeover` only if you intend to transfer ownership |
| `cannot create the runtime layout` | A file occupies a directory path | Remove it or set `TAWASSUL_GLOBAL_DIR` |

## After the upgrade

```bash
opencode debug agents --standalone
```

The eight agents should be listed. Then ask for `health` in a session: it reports
the install scope, database isolation, and any pending flush. A read-only state
warning after an upgrade usually means the key changed or the backup was restored
without its key.

## Compatibility promises

- A configuration file from an earlier `0.1.x` build keeps working. Unknown keys
  are dropped; a key whose type changed rejects the file with a warning naming
  the field.
- A state file from an earlier `0.1.x` build migrates in place when the schema
  version changes.
- A downgrade is not supported across a schema change.
- Native Windows remains pending a native receipt; an upgrade does not change
  that claim.

## Pre-release builds

Builds made before the first public release are development artifacts. They are
not an upgrade source with a compatibility promise. If you run one, export what
matters (goals, records, documents) before moving to a public release, and start
the public release with a clean state if a migration refuses.
