# Security model

This document states what Tawassul protects, what it does not protect, and why
each control exists. It is written for the person who has to decide whether to
run the plugin on a machine that holds real work.

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Workspace state | Per-workspace state directory | Holds handoffs, records, goals, and board data |
| Context packs | Context store | Holds conversation context that may contain sensitive text |
| HMAC key | Key directory, `0600` / `icacls` | Signs persisted state so a tampered file is rejected |
| Consent tokens | `consent-tokens.json` | Decides which words authorise a destructive action |
| Provider credentials | The host, never the plugin | The plugin never asks for, stores, or logs a provider key |

## Trust boundaries

1. **Host to plugin.** The plugin runs inside the host process. A compromised
   host is outside the plugin's threat model.
2. **Plugin to disk.** Every durable write goes through one write path: temp
   file, write, fsync, rename, mode. There is no partial-write state.
3. **Workspace to workspace.** State is namespaced by project identity and
   install scope. A pack or a record written by one workspace is not visible to
   another unless both point at the same database explicitly.
4. **Plugin to network.** The web tool performs a local SSRF preflight before a
   request leaves the machine and re-checks the final URL it received.

## Controls

### Permissions before effects

A tool call is authorised before it runs. A denied call returns an error and
performs no partial write. The permission surface is declared in one place, so a
tool cannot quietly widen its own access.

### Signed state

Persisted state carries an HMAC. A file signed by a key this device does not
have is treated as foreign: the session becomes read-only and no key is created
to "fix" it. The same fail-safe applies to isolated sessions. This turns a
copied or edited state file into a denial, not into silent trust.

### Key storage

- POSIX: key directory `0700`, key file `0600`, written exclusively and fsynced.
- Windows: an `icacls` ACL on the key directory; POSIX modes are never claimed.
- The key directory is never created inside a workspace.

### Consent words

Destructive actions require a consent word. The built-in words cover English and
20 other languages; `consent-tokens.json` extends them. The reply must be the
word itself, or a listed approval phrase, so a sentence that only starts with
one is not an approval. A reject word anywhere in the reply vetoes it. Matching
ignores case, surrounding punctuation, Arabic diacritics, and common letter
variants, so a natural answer is accepted without teaching the user a syntax.

### SSRF and path guards

- The web tool refuses private, loopback, link-local, and unique-local targets.
- The configuration loader rejects a path that escapes the configuration root
  through a symlink and falls back to the base directory with a warning.

### Isolation

`OPENCODE_DB` and the state namespace keep two workspaces apart. Tests and
experiments run with `XDG_*`, `OPENCODE_DB`, and state directories separated, so
a test cannot touch a real workspace. The launcher applies a generation guard so
an older binary cannot open a newer database.

### Logging

Logs never contain provider keys. Debug logging is opt-in (`TAWASSUL_DEBUG=1`),
JSON logging is opt-in (`TAWASSUL_LOG_JSON=1`), and the log file is chosen
explicitly with `TAWASSUL_LOG_FILE`.

## What is not protected

- **A compromised host or plugin dependency.** If the host or a resolved module
  is malicious, the plugin executes inside that process.
- **Someone who is already you.** A process running as your user can read your
  files. File modes and ACLs limit other users, not your own shell.
- **Prompt injection.** Content the agent is asked to read can influence it. The
  permission guard bounds what an injected instruction can do; it does not make
  the model immune.
- **Model providers.** Text sent to a provider leaves your machine. That is the
  provider's data policy, not a plugin control.
- **Traffic analysis and remote servers.** The SSRF guard is a local preflight;
  a remote fetch service still performs the egress and still sees the request.

## Reporting

Report a vulnerability through the private advisory channel described in
[SECURITY.md](../SECURITY.md). Do not open a public issue.

---

[Documentation index](README.md)
