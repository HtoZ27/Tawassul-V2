# Retro

A bad session is evidence about the environment, not a verdict on the agent. The retro finds the change that would have prevented the friction and puts it where the next session meets it.

## Read the session

Start from the timeline and the board, then the records. Reconstruct what happened in order, with the commands and the tool outputs. A retro from memory is a story.

## Seven categories

1. Navigation: the agent looked in the wrong place, or the right place was not signposted.
2. Automated checks: a gate could have caught it earlier.
3. Standards: the rule existed in prose and not in a check.
4. Context bloat: a large document was loaded for a small question.
5. Tool economy: several calls answered one question, or one call answered none.
6. No-ops: work that changed nothing and was not asked for.
7. Information access: the fact existed and was hard to reach.

## Mechanical over prose

A rule that a script can enforce is a check; a rule that needs judgement is a paragraph in the right document. Classify the violation first, then choose the form.

## Name the friction

Each candidate states the friction it removes and the session moment it would have changed. A candidate with no moment is a preference.

## Propose the change

The retro yields candidates and, when the owner approves them, a goal with items. The session history stays as it was; the environment changes instead.

## Procedure

1. Read the day with `timeline(view: "day")` and reconstruct the session in order.
2. Read the mission board with `show_board()` and note the tasks that stalled or thrived.
3. Record the candidates with `record(type: "note", title: "retro candidates", detail: "navigation, automated checks, standards, context bloat, tool economy, no-ops and information access")`.
4. Create the improvement goal with `goal(create: "environment improvements from the retro", items: ["the cheapest check", "the navigation pointer"], acceptance: ["each candidate names the friction it removes"])`.
5. Open the documentation handoff with `handoff(to: "@doc", task: "apply the accepted document changes", context: "the retro candidates and the goal items are the brief")`.

## When to skip

A session with no friction worth an environment change.
