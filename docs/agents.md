# Agents

Tawassul ships eight agents. Seven are specialists; `tawa` is a router that
activates only when you ask for it. Together they cover planning, analysis,
implementation, testing, review, architecture, design, and documentation.

## The roster

| Agent | Description | Starts work when |
| --- | --- | --- |
| `tawa` | Experts' intermediary: routing only, on an explicit `@tawa` invocation | You mention `@tawa` or ask for the work to be distributed |
| `dev` | Developer: picks a model by task complexity, implements and fixes | Implementation, bug fixing, performance work |
| `analyst` | Strategic advisor: quality supervision, risk, model selection | Analysis, risk assessment, choosing a model |
| `tester` | Tester: edge cases, test reports | Testing and verification |
| `reviewer` | Reviewer: line-by-line review and security audit | Code review and security review |
| `architect` | Architect: structure, technology choice, design evaluation | Design and architectural decisions |
| `designer` | UI/UX designer: interfaces, mockups, prototypes, wireframes | Interface and experience work |
| `doc` | Documentation writer | Guides, references, release notes |

Every specialist is told to finish the task itself. A specialist does not bounce
work back to `tawa`, and a specialist does not dispatch implementation work to
another agent.

## How routing works

1. A normal request reaches the model directly. `tawa` stays out of the way.
2. `tawa` activates when the message mentions `@tawa` or asks for distribution
   to the team.
3. `tawa` picks one specialist for the request, sends the full context, and
   reports back in the user's language.
4. Work that needs more than one role moves through handoffs, with a
   checkpoint when the context is large.

`tawa` is an intermediary, not an implementer. If you want the work done rather
than routed, ask the specialist directly.

## Model selection

Each specialist selects a model by task complexity. A fixed model can be pinned
per agent, and a role can be given an ordered model list with fallbacks. The
selection is part of the configuration surface, so the same workspace can use a
cheap model for small edits and a stronger one for architecture.

## Customising the roster

- **Add an agent at runtime** with the `addagent` tool. The tool writes the agent
  definition and the roster entry in one step, so the two cannot drift.
- **Remove an agent** with the `kick` tool.
- **Disable an agent** with the `deleted` list in configuration.
- **Override an agent** by declaring it under `agents` in the configuration file.
- **Cap the roster** with `maxDynamicAgents`.

## Inspecting the roster

```bash
opencode debug agents --standalone
```

The output lists the host's built-in agents and the eight Tawassul agents. If the
Tawassul agents are missing, the plugin did not load; see
[troubleshooting](troubleshooting.md).

---

[Documentation index](README.md)
