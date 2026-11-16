# Codebase design

A module earns its place by hiding complexity behind a small interface. Design the boundary, then test it by deletion: remove the module and see whether the complexity disappears or moves into its callers.

## Vocabulary

- Module: a unit with an interface and an implementation.
- Interface: everything a caller has to know.
- Implementation: what the interface hides.
- Depth: the amount of behaviour behind the interface.
- Seam: a place where behaviour can be swapped without editing callers.
- Adapter: a concrete implementation at a seam.
- Leverage: behaviour gained per unit of interface learned.
- Locality: the change stays in one place.

## Deep and shallow

A deep module hides more than it exposes. A shallow module passes calls through and adds a name. Depth is measured in behaviour hidden, not lines of code.

## The deletion test

Delete the module and imagine the callers absorbing its work. When the complexity vanishes, the module was a pass-through. When it reappears in five callers, the module was doing its job.

## Seams

One adapter at a seam is a hypothetical seam; two adapters make it real. Introduce a seam where a test needs to substitute a dependency, not where a design pattern would look tidy.

## Testability

A deep module takes its dependencies as arguments, reports results rather than reaching for global state, and exposes a small surface that a test can drive. A module that needs a live host to test has its boundary in the wrong place.

## Record the design

Write the decision: the interface, the seam, the deletion test result, and the alternative that lost. A design that lives just in the diff is re-litigated at the next change.

## Procedure

1. Read the mission board with `show_board()` and note the work that will cross the boundary.
2. Record the decision with `record(type: "decision", title: "module boundary", detail: "the interface, the seam and the deletion test result")`.
3. Create the depth goal with `goal(create: "deepen the module", items: ["the interface", "the seam", "the test surface"], acceptance: ["the deletion test names what the module hides"])`.
4. Open the implementation handoff with `handoff(to: "@dev", task: "apply the module boundary", context: "the decision and the goal items carry the design")`.

## When to skip

A local change inside one module with no boundary question.
