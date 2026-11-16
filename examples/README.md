# Examples

Five recipes, each one a real sequence of operations with a visible result. They
are written for a reader who has the plugin installed and a workspace open in
OpenCode. They are not prompt libraries: the wording is yours, the sequence is
the part worth copying.

| Recipe | Situation | Result |
| --- | --- | --- |
| [Goal to merge](goal-to-merge.md) | A change needs a durable objective and a review | A closed goal with evidence |
| [Review a change](review-a-change.md) | A diff is ready and needs a decision | A stored evaluation and a recorded decision |
| [A long session](long-session.md) | The context window is nearly full | A pack and a successor session |
| [Database maintenance](database-maintenance.md) | The database grew past a threshold | A checked, backed-up, pruned database |
| [A custom roster](custom-roster.md) | The default team is not the right team | An added agent, verified in the host |

## Conventions

- Tool calls appear as `tool(argument: value)`. That is shorthand for the call,
  not a syntax you type into the host.
- Paths are POSIX. On Windows, replace them with the equivalent path in your
  shell; the plugin itself accepts either separator.
- A step that writes outside the workspace says so.
- Identifiers (`G-001`, `H-001`, `R-001`) are examples. Yours will differ.
- Every recipe ends with a check. If the check fails, the recipe did not finish.

## Before you start

```bash
nvm use
npm ci
npm run build
opencode debug agents --standalone
```

The last command should list the eight Tawassul agents. If it does not, the
plugin did not load; fix that before following a recipe. See
[installation](../docs/installation.md) and
[troubleshooting](../docs/troubleshooting.md).
