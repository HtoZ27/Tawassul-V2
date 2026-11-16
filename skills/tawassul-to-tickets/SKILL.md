# To tickets

Cut a plan into slices that can land one at a time. A slice is a vertical cut through every layer it touches, demoable on its own, with its blocking edges named.

## Vertical slices

A slice changes one behaviour end to end: schema, logic, surface, test. A horizontal slice that changes every schema and no behaviour has nothing to demo and nothing to review.

## Blocking edges

For each slice, name the slices that gate it. An edge means the blocked slice starts after the gating slice lands. The edge list is what turns a pile of tasks into an order.

## Expand and contract

For a wide rename or refactor, split into three slices: add the new form beside the old, migrate callers in batches, remove the old form. Each slice stays green on its own.

## Granularity

Too coarse: a slice with two demoable behaviours, split it. Too fine: a slice that is a single rename with no observable change, merge it into its neighbour.

## Work the frontier

Start the unblocked slice with the smallest blast radius. Dispatch one slice per handoff, with the edge list in the context so the assignee sees what is still gated.

## Close a slice

A slice closes when its observable change is demonstrated and its gate is green. Then the next edge opens.

## Procedure

1. Read the active goals with `goal(list: true)` and note the objective the plan serves.
2. Create the slice goal with `goal(create: "the plan as slices", items: ["slice one", "slice two", "slice three"], acceptance: ["each slice is demoable on its own"])`.
3. Record the edges with `record(type: "note", title: "slice edges", detail: "each slice and the slices that gate it")`.
4. Open the first handoff with `handoff(to: "@dev", task: "start the unblocked slice", context: "the slice edges are in the record ledger")`.

## When to skip

A change that fits in one slice.
