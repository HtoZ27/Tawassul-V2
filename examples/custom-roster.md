# A custom roster

The eight shipped agents are a default, not a limit. This recipe adds a second
reviewer pinned to a different model, uses it for one review, and removes it
without touching the base role.

## The situation

A release branch needs a second opinion from a model that is not the default
reviewer. You want the variant only for this review, and you want the roster to
return to its shipped state afterwards.

## Step 1: read the current roster

```
Check the team configuration before I add anything.
```

```
check()
```

`check` reports the agent models, capabilities, and conflicts. Read it before and
after a change; a roster that looks right in one file can still be wrong after
the host merges its own agents.

## Step 2: add the variant

```
Add a reviewer variant with model gemini from google.
```

```
addagent(name: "reviewer with model gemini from google")
```

The tool derives the tag from the model and creates `reviewer-gemini`. The base
`reviewer` is never modified: a bare base plus a model produces a variant, and a
variant with the same tag and a different model is an announced update, not a
second entry.

What it writes:

- `.opencode/agents/reviewer-gemini.md`, the definition;
- the roster entry in `opencode.json` or the roster file, in the same step.

Because both are written together, the file and the roster cannot drift. An
identical re-add writes nothing and says so.

## Step 3: inspect what changed

```bash
git status --short
git diff -- .opencode/agents opencode.json
```

Read the generated definition. The description, the model, and the mode are the
parts that decide behaviour; the rest is boilerplate.

## Step 4: verify in the host

```bash
opencode debug agents --standalone
```

The list should contain `reviewer` and `reviewer-gemini`. `opencode plugin list`
is the wrong check: it lists package plugins, not file plugins.

If the variant is missing, the host did not reload. Restart it; do not add a
second copy.

## Step 5: use it

```
Send the release branch to @reviewer-gemini for a second opinion. The first
review is on the board; ask for disagreements, not a summary.
```

```
handoff(to: "@reviewer-gemini",
        task: "Review the release branch against the first review; name disagreements",
        context: "the first review is R-004; the diff is the last commit on the branch",
        files: ["src/index.ts", "scripts/install-global.ts"])
```

A variant is a real agent: it has the same tool allowance and guard as its base
role, and it appears in the roster like any other. It does not inherit the base
agent's running handoffs.

## Step 6: remove it

```
Remove reviewer-gemini.
```

```
kick(agent: "remove reviewer-gemini with model gemini from google")
```

`kick` removes the definition and the roster entry. A removal that would leave
the base role untouched is the normal case; the tool refuses an ambiguous spec
rather than guessing.

## Step 7: close the loop

```
Record why the second reviewer existed.
```

```
record(type: "decision", title: "Second reviewer for the 0.1.0 branch",
       detail: "reviewer-gemini was added for one cross-model review and removed afterwards; the base reviewer was never changed")
```

Then confirm the roster is back:

```
check()
```

## Other ways to change the roster

| Goal | Action | Scope |
| --- | --- | --- |
| Hide an agent without deleting its file | `deleted` list in configuration | Workspace |
| Override an agent's model or prompt | `agents` block in configuration | Workspace |
| Add several at once | `addagent(name: "dev tester with model mimo from opencode")` | Workspace |
| Add all seven specialists | `addagent(name: "all with model mimo from opencode")` | Workspace, `tawa` excluded |
| Cap growth | `maxDynamicAgents` in configuration | Workspace |

`tawa` is singular. It can be re-pointed at a model, but a `tawa-*` variant is
blocked: a second router would compete for the same requests.

## What can go wrong

| Symptom | Meaning | Action |
| --- | --- | --- |
| `unoffered suffix` | The model alias is not in the catalog | Use a full `provider/model`, or an offered alias |
| Variant missing after restart | The roster file and the definition disagree | Read `check`, then re-add once |
| Handoff refused | The role's tool allowance does not include the route | Send the work to the role that owns the tool |
| Two agents claim the same request | A variant duplicates a base routing rule | Remove the variant; keep the routing in one place |

## The point

A roster change is a configuration change with a file on disk. Add it for a
reason, verify it in the host, and remove it when the reason is gone. The base
roles stay stable, which is what makes a variant safe to try.
