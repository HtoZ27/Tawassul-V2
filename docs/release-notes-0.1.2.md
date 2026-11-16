# Release notes: 0.1.2-experimental

**Status:** third public release, experimental. The runtime is unchanged from
`0.1.1-experimental`; this release carries documentation that matches the app as
it behaves today. Read [limitations](limitations.md) before running it on work
you cannot restore.

**Version:** `0.1.2-experimental`.

## What changed

### The front page explains the plugin

The README gains a "Why it exists" section that names both reasons to run a
team — structure, and parallel work across several models — and states the price
plainly: tokens. It points at the free model variants for the roles that do not
need a larger model.

The capability table now lists the surfaces it was missing: model variants,
parallel agents, skills, guardrails, and diagnostics.

### The skills section is readable

The generated skill table was rendering as literal text on GitHub. The
generation marker shared the header line, so the host treated the whole block as
raw HTML and the pipes reached the reader as characters. The marker now sits on
its own line, and the table carries two columns instead of five: the skill id,
and the sentence the model reads before it loads the procedure. Scope jargon,
eval ids, and the repeated `0.5` threshold are gone from the front page.

`docs/skills.md` gains "How a skill is evaluated": the eval entry, the
load-rate threshold, and the kill criterion, with the manifest fields that carry
them.

### One desktop setting is documented

`Settings → General → Show agent` must be on before the composer can switch
agents. The README, `GUIDE.md`, the Arabic end-user guide, and
`docs/installation.md` state it, with the label and the sentence the app shows,
and say what happens without it: the session stays on the Build agent.

### Mentions and the routing record

Both guides state that several `@` mentions in one message reach the host, which
runs each agent, while the routing record keeps the first one.

## Install

From the release assets, with no Node or Bun:

```bash
sh install.sh --global --dry-run
sh install.sh --global
```

Project scope:

```bash
sh install.sh --project /path/to/workspace
```

The installer verifies both artifacts against `SHA256SUMS` and refuses an
unverified or offline asset. See
[installation](installation.md#release-installer) for `--prefix`, `--from`,
`--release`, and the uninstall.

From a source checkout:

```bash
npm ci
npm run build
```

Global scope:

```bash
bun scripts/install-global.ts
bun scripts/install-global.ts --verify
```

Neither installer edits `opencode.json(c)`. A manual entry, if you use one, must
point at a directory.

## Compatibility

| Area | Status |
| --- | --- |
| OpenCode `2.3.0` | Supported, audited (built dependency) |
| OpenCode `2.2.1` – `2.2.7` | Refused (floor raised to `2.3.0`; the 2.2.x line is out of scope) |
| OpenCode `3.x` | Untested mode behind a capability probe |
| Linux x64 | Ready, including maintenance and triggers |
| Linux arm64, macOS | Experimental |
| WSL2 | Experimental; keep the key off `/mnt/` |
| Native Windows x64 | Supported for the bundle and wasm lane (native receipts 2026-11-02 and 2026-11-03) |

Native Windows loads the bundle and runs the in-process features. It has no
database maintenance and no scheduled trigger. The full matrix is in
[compatibility](compatibility.md).

## Verification

| Check | Result at this release |
| --- | --- |
| Fast gate | 16 steps |
| Proofs | 186 steps, one child process each |
| Smoke | 6 steps, including the release artifacts, global boot, and independence boot |
| Proof files | 189, all catalogued across the stages |
| Public docs | 47 files, 44 tools, 8 agents, 16 skills |
| Native Windows | Native receipts for the bundle and wasm lane; database lane unavailable |

The counts are generated from `scripts/gate-manifest.json`. See
[validation](validation.md) for what each stage proves and what it does not.

## State and upgrade

No durable format changed in this release. State written by `0.1.0-experimental`
and `0.1.1-experimental` loads unchanged.

- State is local, namespaced by workspace, and signed with an HMAC.
- State is **signed, not encrypted**. Use full-disk encryption if it must be
  confidential at rest.
- A patch upgrade keeps state. A downgrade across a schema change is not
  supported; restore the backup instead.

## Known limits

The limits recorded in the `0.1.0-experimental` notes still hold: no native
Windows database maintenance lane, no macOS scheduler, no hosted documentation
site, no npm package, a pilot evals stage, prompt-injection mitigation rather
than elimination, and a prompt cache that is invalidated when compression
rewrites the prefix.

---

[Documentation index](README.md)
