# FAQ

## What is Tawassul?

An OpenCode plugin that adds a small team runtime to a workspace: eight
agents, 44 tools, handoffs, a goal ledger, mission boards,
checkpoints, memory records, discussions, and context packs.

## Is it free?

Yes. The licence is MIT. There is no paid tier, no account, and no telemetry
endpoint.

## Does it send my code anywhere?

The plugin itself does not. Three things can leave the machine:

- text sent to the model provider you configured in OpenCode;
- a request made by the `web` tool to the fetch service you configured;
- an image prompt sent by the `imagegen` tool when you ask it to generate or
  edit an image.

The `web` tool performs a local SSRF preflight before a request leaves the
machine. It is the only tool that performs arbitrary network egress on its own.

## Does it need an API key?

No. The host owns provider credentials. The plugin never asks for, stores, or
logs a key. The only secret it creates is the HMAC key that signs local state.

## Is local state encrypted?

No. State is signed with an HMAC to detect tampering, not encrypted. A file you
can read, another process running as your user can read too. Use full-disk
encryption if the state must be confidential at rest.

## Which host versions are supported?

The floor is `2.2.1`, the audited version. The installer refuses an older host,
and the plugin refuses one that reports an older version at init. A newer major
runs in untested mode behind a capability probe at init. See
[compatibility](compatibility.md).

## Does it work on Windows?

The plugin loads and all in-process features work. Database maintenance and
scheduled triggers do not. Native Windows x64 has a native receipt for the
bundle and wasm lane: install, verify, upgrade, uninstall, and purge, plus the
`icacls` key ACL, long paths, a non-system drive, and file locking. Defender and
SmartScreen were measured on this machine. ARM64 remains unmeasured; Windows 11
shares the path format and the Defender update channel with Windows 10, so only
version-level differences remain. See [compatibility](compatibility.md).

## Does it work with other plugins?

The plugin claims one workspace at a time and yields to a project-scope copy when
a global copy loads. It registers its own tools, skills, and command, and leaves
another plugin's surface alone.

## Does it replace the host's agents?

No. It adds eight agents to the roster. The host's own agents remain available,
and a user-defined agent with the same name wins.

## Can I add my own agent?

Yes. The `addagent` tool writes the definition and the roster entry in one step.
`kick` removes one. `deleted` in configuration hides one without deleting its
file. See [agents](agents.md).

## Where is my state?

Under `<project>/.opencode/` for a project install, and under the global config
root for a global install. Context packs live in the data directory. The full
table is in [state](state.md).

## How do I back it up?

Stop the host and archive the state root; the commands are in
[state](state.md#backup). Back up the key only if you intend to restore signed
state.

## How do I uninstall it?

Project scope: delete `.opencode/plugins/tawassul.js` and restart. Global scope:
`bun scripts/install-global.ts --uninstall`. Add `--purge --yes` to archive state
and configuration as well. See [installation](installation.md#uninstalling).

## Why did a tool refuse my call?

The guard denied it before any effect. The refusal names the reason: role, call
depth, task budget, path, consent, or SSRF. See
[permissions](permissions.md#when-a-call-is-denied).

## Why is the state read-only?

The state file is signed with a key this device does not have, or the session is
isolated. The plugin refuses to create a key for a file it did not sign. Restore
the key with the state, or start fresh.

## How many proofs does the project run?

The count is generated from `scripts/gate-manifest.json`, not written by hand.
`npm run gate:fast` proves the count is current; the proof stage runs every proof
in its own child process.

## Is the project affiliated with OpenCode?

No. It is an independent plugin that runs inside OpenCode. OpenCode is a project
of its respective maintainers.

## Where do I report a bug or a vulnerability?

Bugs: open an issue with the version, host, platform, and a minimal
reproduction. Vulnerabilities: use the private advisory channel in
[SECURITY.md](../SECURITY.md), never a public issue.
