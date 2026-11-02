# Support

Tawassul is an experimental project maintained on a best-effort basis. There is
no service-level agreement, no paid support, and no guaranteed response time.

## Where to ask

| Topic | Channel |
| --- | --- |
| A reproducible bug | Open an issue on the repository |
| A question about installation or configuration | Open a discussion or an issue |
| A security vulnerability | The private advisory channel in [SECURITY.md](SECURITY.md), never a public issue |
| A conduct problem | The reporting channel in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| A feature request | Open an issue and describe the problem, not only the solution |

Before opening an issue, check [known issues](docs/known-issues.md),
[troubleshooting](docs/troubleshooting.md), and the [FAQ](docs/faq.md). A
duplicate costs the maintainer the time that a real bug needs.

## What to include

A useful report answers these without a follow-up:

1. **Version.** The release or commit, and the value in the installed marker if
   you use the global installer.
2. **Host.** The OpenCode version, and whether the install is project or global.
3. **Platform.** Operating system, architecture, and for WSL2 the filesystem the
   key lives on.
4. **Reproduction.** The smallest sequence that shows the problem. A command is
   better than a description; a failing proof is better than a screenshot.
5. **Expected and actual.** One sentence each.
6. **Evidence.** The `health` output, the failing gate step, or a redacted log.

Redact before you paste:

- provider keys, HMAC keys, and consent tokens;
- session contents and personal paths;
- anything under a state root that you would not publish.

A redacted value is enough to describe a leak. Never send the secret itself.

## What is in scope

- The plugin bundle, the installer, and the documented scripts.
- Configuration loading, state isolation, and the database lane.
- The tool surface, including permission and path guards.
- The public documentation, when it contradicts the code.

Out of scope:

- The OpenCode host and its model providers.
- Provider billing, quotas, and model quality.
- A third-party plugin that conflicts with this one.
- An attacker who already runs code as your operating-system user.

## Diagnostics to attach

```bash
opencode debug agents --standalone
npm run doctor
node scripts/check-docs.mjs
```

Inside a session, `health()` prints the install scope, the state paths, the
database lane, and pending flushes. It changes nothing, so it is safe to run in a
broken session.

For a logging run:

```bash
TAWASSUL_DEBUG=1 TAWASSUL_LOG_JSON=1 TAWASSUL_LOG_FILE=/tmp/tawassul.log opencode
```

Attach the section around the failure, not the whole file. State the time of the
failure so the section can be found.

## What to expect

- An acknowledgement when a maintainer reads the report is not guaranteed; a
  clear reproduction usually gets one.
- A fix lands on `main` first. A backport to an older experimental build is not
  promised.
- A security report is handled through the advisory, with the timeline stated in
  [SECURITY.md](SECURITY.md).
- A support request that asks for a private debugging session may be declined.
  The project is local-first, and the state on your machine is yours.

## Contributing a fix

If you already have a fix, read [CONTRIBUTING.md](CONTRIBUTING.md). A pull
request without a proof or a receipt is a proposal, not a fix; the gate is how
the project keeps an experimental release honest.
