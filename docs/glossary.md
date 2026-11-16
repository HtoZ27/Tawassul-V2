# Glossary

| Term | Meaning |
| --- | --- |
| **Agent** | A named role with a model policy and a tool allowance. Tawassul ships eight. |
| **Handoff** | One unit of work sent from one agent to another, with context, files, and a completion record. Identified as `H-###`. |
| **Goal** | A durable objective with items and definition-of-done criteria. Identified as `G-###`. |
| **Item** | A step inside a goal. It moves from pending to in progress to done, and needs evidence before it is done. |
| **Definition of done** | The criteria that must be met, each with evidence, before a goal can close. |
| **Evidence** | A short, specific statement or receipt attached to an item or a criterion. Minimum eight characters; no duplicates. |
| **Record** | A decision, fix, incident, or note stored for the project. Identified as `R-###`. |
| **Board** | The mission board: tasks, agent health, and system status in one view. |
| **Checkpoint** | A code snapshot taken before a risky change, restorable after it. |
| **Pack** | A portable summary of a session, produced by `thread`. It is data, never instructions. |
| **Digest** | The identifier of a stored pack. |
| **Discussion** | A structured exchange where agents propose, vote, and divide work. Identified as `D-###`. |
| **Receipt** | A captured tool output used as proof for a claim. |
| **Claim** | A statement backed by one or more receipts, which another agent can verify or challenge. |
| **Scope** | Where the plugin is installed: `project` (one workspace) or `global` (every workspace of the user). |
| **Lane** | The classification of a database path: host-default, desktop-sidecar, isolated, custom, or unset. |
| **Marker** | The `VERSION` file the installer writes, recording version, hashes, owner, and host. |
| **Bundle** | The JavaScript file the host loads: `.opencode/plugins/tawassul.js` (built from `dist/index.js`) for a project, and `plugins/tawassul.js` (built from `dist/global.js`) for a global install. |
| **Wasm** | The four wasm files staged beside the bundle for AST tools: one runtime and three grammars. |
| **Proof** | A script under `scripts/prove-*.ts` that asserts one invariant and exits non-zero when it fails. |
| **Gate** | A named stage that runs a set of steps: `fast`, `proofs`, `smoke`, or `evals`. |
| **Fast gate** | Rules, docs, typecheck, config, facts, pins, parity, and the proof catalog. |
| **Receipt (experiment)** | A dated document under `docs/experiments/receipts/` recording what was run and what happened. |
| **Router** | `tawa`, the agent that only routes and never implements. |
| **Consent word** | An accepted answer that authorises a destructive tool call. |
| **Read-only** | A session that refuses to persist because its state belongs to another key, or because it is isolated. |

---

[Documentation index](README.md)
