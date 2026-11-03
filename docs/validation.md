# Validation

Tawassul is validated by executing it, not by reading it. Every claim the
release makes should map to a gate step, a proof, or a dated receipt. This page
explains that machinery so a reader can rerun it and a contributor can extend it
without weakening it.

## The four stages

| Stage | Command | Steps | Purpose |
| --- | --- | --- | --- |
| Fast | `npm run gate:fast` | 12 | Rules, docs, SBOM, types, config, facts, pins, parity, catalog, counts |
| Proofs | `npm run gate:proofs` | 153 | One isolated proof per invariant |
| Smoke | `npm run gate:smoke` | 6 | Build, release artifacts, release smoke, global boot, independence boot |
| Evals | `npm run gate:evals` | 1 | Pilot evaluation of agent behaviour |

`npm run ci` runs fast, proofs, and smoke in that order, each in its own process.
Evals are deliberately outside `ci`: a model-dependent evaluation is not a
deterministic gate, and a provider hiccup must not turn a code regression into a
red build.

`npm run verify` runs the fast stage and then the build. It is the check to run
after an edit; `npm run ci` is the check before a tag.

## Fast stage

The twelve steps, in order:

| Step | What it rejects |
| --- | --- |
| `source-rules` | Non-English text or a comment in scanned code |
| `docs` | A broken public link, a missing tool/agent/skill, a foreign project name |
| `sbom` | A missing licence, a copyleft dependency, or an unreadable lockfile |
| `shell-syntax` | A shell script that does not parse |
| `typecheck` | A strict TypeScript error |
| `config` | A generated host configuration that drifted |
| `facts` | A fact table or version pin that no longer matches |
| `sdk-pins` | A dependency pin outside the audited range |
| `upstream-registry` | A host registry change the plugin has not accounted for |
| `shared-parity` | Two copies of a shared contract that disagree |
| `proof-catalog` | A proof file missing from the manifest, or the reverse |
| `proof-count` | A hand-written proof count that drifted from the manifest |

The proof count is generated. `scripts/generate-proof-count.ts --check` rewrites
the generated markers in memory and fails when the file differs, so a release
cannot quote a stale number.

## Proofs

A proof is a script under `scripts/prove-*.ts`. It asserts one invariant,
prints `PROOF PASS` with its assertion count, and exits non-zero on failure.
Examples: a state file cannot escape its namespace, the web tool refuses a
private address, a torn ledger tail is skipped, an uninstall removes exactly the
files in its marker.

At this release the tree holds 156 proof files and the proofs stage runs 153 of
them. The other three run where they belong: `prove-proof-catalog.ts` in the
fast stage, and `prove-global-boot.ts` and `prove-independence-boot.ts` in the
smoke stage. A file that runs nowhere fails the catalog check.

Each step runs in its own child process. A crash, a hang, or a process that
mutates its environment cannot silently pass the next step. Heavy stages run
sequentially: the project keeps a 1.5 GB memory ceiling and does not trade a
faster gate for an out-of-memory failure.

### Running one proof

```bash
bun scripts/prove-web-ssrf.ts
```

A single proof is the right loop while developing. The full stage is the right
check before a commit that changes a shared invariant.

### Sharding

```bash
npm run gate:proofs:1
npm run gate:proofs:2
npm run gate:proofs:3
npm run gate:proofs:4
```

The four shards are balanced and take about a minute each. They are the same
proofs, split; a shard is a convenience, not a weaker gate. The detached runner
is `npm run gate:proofs:bg` with `:status`, `:wait`, and `:stop`.

## Smoke

| Step | Proves |
| --- | --- |
| `build` | `dist/index.js` and `dist/global.js` build from clean output |
| `pack` | The tarball, runtime archive, bundle, index, SBOM and checksums are written |
| `verify-artifact` | The file lists, wasm hashes, checksums and manifest versions agree |
| `release-smoke` | The host pin holds, a scratch workspace boots, and two direct tools answer |
| `global-boot` | The global bundle installs and initialises in an isolated home |
| `independence-boot` | The plugin boots without the v1 tree or its state |

Smoke uses isolated homes and databases. It does not write into the real
configuration, and it does not install over a live host.

## Packaging

`npm run pack:release` writes the release set under `dist/release/`:

| Asset | Content |
| --- | --- |
| `tawassul-<version>.tgz` | The package layout: `dist/`, the four wasm grammars, README, licence, changelog, notice |
| `tawassul-runtime-<version>.tar.gz` | `tawassul-runtime/wasm/` only |
| `tawassul-<version>.global.js` | The self-contained bundle `install.sh` installs |
| `tawassul-<version>.index.js` | The externalising bundle the package entry uses |
| `tawassul-<version>.cdx.json` | The CycloneDX SBOM for the build |
| `VERSION`, `NOTICE.md`, `SHA256SUMS` | The version, the notices, and the checksums |

`npm run verify:release-artifact` checks the set: every checksum, the exact
tarball and archive file lists, the four wasm hashes against the SBOM, the
version against `package.json`, and the absence of source, tests, docs, and
state inside the archives. `SOURCE_DATE_EPOCH` fixes the archive timestamps, and
the SBOM serial is derived from the component list, so a rebuild from the same
lockfile is comparable.

`install.sh` is the consumer of those assets. The smoke stage packs and verifies
the set but does not download anything; the offline install cycle is exercised
with `install.sh --from dist/release` in a scratch directory.

## Receipts

Some claims cannot be a deterministic proof: an installer cycle on another
operating system, a host upgrade, an evaluation run. Those are recorded instead,
under `docs/experiments/receipts/`, with a date, the exact commands, and the
observed output.

A receipt is evidence for the environment it names, nothing wider. The Wine
install cycle, for example, proves that the Windows code path runs; it does not
prove NTFS ACL behaviour, Defender, or long-path handling. That is why Windows
remains **pending a native receipt** in [compatibility](compatibility.md).

## What a green gate does not prove

- That every platform works. Linux is the reference lane; macOS and Windows
  claims need their own evidence.
- That a model will choose the right tool. The evals stage is a pilot, not a
  benchmark.
- That a third-party plugin composes cleanly. Compatibility is tested only for
  the documented surface.
- That the host's own permissions are correct. The plugin cannot audit the host.

## Reproducing a run

```bash
nvm use
npm ci
npm run build
npm run gate:fast
```

Use the pinned Node and Bun versions in [compatibility](compatibility.md). A run
under a different runtime is welcome as evidence, but it does not replace a run
under the pinned ones.

## Adding a proof

1. Write `scripts/prove-<name>.ts` with a single invariant.
2. Fail closed: an unexpected condition is a failure, not a skip.
3. Use an isolated state root and database.
4. Register it in `scripts/gate-manifest.json` under `proofs`.
5. Run `npm run gate:fast`; the catalog and count steps must accept it.
6. Run the proof on its own, then the stage.

Do not weaken an existing proof to make a change pass. If the invariant moved,
move the proof with it and say why in the commit.
