# Enrich task

Turn a sentence into a specification a builder can start from. The intake is done when the scope, the reused surfaces, the acceptance criteria and the open questions are written down and the implementer has no question left to ask.

## Restate

Write the request as one sentence in the requester's terms, then as one sentence in the system's terms. When the two sentences disagree, the disagreement is the first open question.

## Scope

Name what the change covers and what it leaves alone. An out-of-scope list is the cheapest defence against scope creep, and it is the part a reviewer reads first.

## Reuse scan

Search the tree ahead of inventing anything: the project map for the shape, the dependency map for callers, the symbol query for the interface, and the text search for the concept under other names. Name the surfaces that already exist and state whether the change extends or replaces each one.

## Requirements

Separate the functional requirements from the non-functional ones: performance, memory cap, determinism, English text at every shipped surface, and the gate each requirement touches. A requirement that no check can observe belongs in the open questions.

## Acceptance

Write each criterion as an observable state: a command, a tool output, a file, or a record. "Works well" is not a criterion. Three to six criteria is the useful range; more means the request is really several tasks.

## Hostile cases

Name the three realistic ways this change breaks: the awkward input, the second caller, the empty collection. Each case becomes a test or an explicit accepted risk.

## Open questions

Route each question to the question tool and record the answer. A silent guess is the defect this step exists to prevent.

## Procedure

1. Read the active goals with `goal(list: true)` and note the objectives that neighbour the request.
2. Read the mission board with `show_board()` and note the work already in flight.
3. Create the enriched goal with `goal(create: "the request restated as a goal", items: ["scope", "out of scope", "reuse", "requirements", "acceptance"], acceptance: ["the request is implementable without a follow-up question"])`.
4. Record the intake note with `record(type: "note", title: "scope and open questions", detail: "the boundaries, the reused surfaces and the questions the request leaves open")`.
5. Open the design review with `handoff(to: "@architect", task: "review the enriched scope", context: "the goal carries items and acceptance criteria; the note carries the open questions")`.

## When to skip

The goal already carries items, acceptance criteria and no open question.
