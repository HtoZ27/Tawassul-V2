# Interface design

A user-facing surface is a set of decisions about attention. Set the direction ahead of the pixels, then judge the result against a rubric rather than a mood.

## Direction

Write one sentence for the aesthetic and three counter-default moves: one for type, one for layout, one for colour or tokens. The counter-default moves are what keep the surface from reading as the default template.

## Tokens

Decide colour, type scale, spacing, radius, elevation and motion once, as named tokens. A value used twice becomes a token; a value that differs by a pixel becomes a bug.

## Accessibility baseline

WCAG 2.2 AA: contrast, focus visibility, keyboard order, labels, reduced motion, and a target size a thumb can hit. Accessibility is a design input, not a review pass.

## Two quick tests

Substitution: swap the product name and the copy for a competitor's. When the surface still reads as correct, it carries no identity. Rationale: for each prominent choice, state the reason. A choice with no reason is habit.

## Critique

Score each dimension: hierarchy, spacing rhythm, type, colour, interaction states, empty and error states, responsiveness, accessibility, and generic-output risk. Each score carries a severity (blocking, major or minor) and the repair.

## Repair protocol

Name the dimension, cite the evidence, and fix the system rather than the instance. Patching one screen leaves the next screen to repeat the defect.

## Anti-overcorrection

Trading one default for another is not a direction. A dark surface with a neon accent is as generic as a white card grid when neither serves the content.

## Hand-off

The designer agent reads and judges; it does not edit files or run a browser. The spec leaves through the handoff with the direction, the tokens, the critique and the open states named.

## Procedure

1. Read the mission board with `show_board()` and note the surfaces the work touches.
2. Record the direction with `record(type: "decision", title: "design direction", detail: "the aesthetic direction, the tokens, the counter-default moves and the rationale for each")`.
3. Record the critique with `record(type: "note", title: "interface critique", detail: "each dimension scored, its severity and the repair")`.
4. Open the build handoff with `handoff(to: "@dev", task: "implement the interface spec", context: "the direction and the critique are in the record ledger")`.

## When to skip

An internal surface with no user-facing artifact.
