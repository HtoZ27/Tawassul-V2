# Security policy

## Supported versions

Tawassul is experimental. Security fixes land on the latest published `0.1.x`
release and on `main`; older builds are not patched.

| Version | Supported |
| --- | --- |
| `0.1.x` (latest) | Yes |
| older `0.1.x` builds | No |

## Reporting a vulnerability

Do not open a public issue for a security problem.

1. Open a private security advisory on the repository
   ("Security" → "Advisories" → "Report a vulnerability").
2. Include the Tawassul version, the OpenCode host version, the platform, the
   exact configuration, a minimal reproduction, and the impact you observed.
3. Never include real API keys, HMAC keys, session contents, or personal paths.
   Redact them; a redacted value is always enough to describe a leak.

You can expect an acknowledgement within 72 hours and an assessment within
seven days. If the report is valid, the fix and the advisory are published
together, and the advisory credits you unless you ask otherwise.

## Scope

In scope:

- the plugin bundle and the global installer;
- configuration loading, path resolution, and state isolation;
- the tool surface, including the web fetch guard, the path guard, and the
  permission guard;
- key storage and file permissions;
- the context store, memory records, and the goal ledger;
- anything that lets one workspace read or write another workspace's state.

Out of scope:

- the OpenCode host itself and its model providers;
- prompt injection through content the user asks the agent to read (documented
  behaviour, mitigated by permissions, not eliminated);
- an attacker who already runs code as the same operating-system user;
- denial of service through extremely large user-supplied files.

## What the plugin does to protect you

- The HMAC key directory is created `0700` and the key file `0600` on POSIX.
  On native Windows the installer applies an `icacls` ACL instead and never
  claims POSIX modes.
- State is namespaced per workspace and per install scope. Two workspaces do not
  share a database unless you point them at the same one explicitly.
- Tool permissions are enforced before an effect runs; a denied tool returns an
  error instead of performing a partial write.
- The web tool refuses private and link-local targets before a request leaves
  the machine.
- The configuration loader rejects paths that escape the configuration root
  through a symlink.
- Consent words gate destructive actions; the token list is yours to extend.

Details, threat model, and the reasoning behind each control are in
[docs/security-model.md](docs/security-model.md).

## Disclosure

Fixes are released as soon as they are verified. An advisory is published even
when the vulnerable build was never widely used, because the reasoning matters
to anyone running a fork.
