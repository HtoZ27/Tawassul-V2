# Writing for agents

An agent-facing document is a context pointer and a set of steps. Every line either changes behaviour or leaves. The reader is a capable model with a limited context window and no patience for ceremony.

## The pointer

The description or first paragraph says what the material is and which branches trigger it. The pointer is the part held in context at every turn; make it specific enough that the model can decide to load the body or skip it.

## Two loads

Context load: the tokens the document costs while loaded. Cognitive load: the rules the reader has to hold at once. Both are budgets. A long document that repeats itself spends both.

## Information hierarchy

Steps the reader follows at once come first. Reference the reader consults in place comes next. Material that lives behind a pointer comes last and stays out of the main path.

## Completion criteria

Say what finished looks like: an observable state, a command, a record. A criterion the reader can check is worth three adjectives.

## Leading words

One token that carries many behaviours is worth a paragraph of explanation. "Red loop", "blast radius" and "vertical slice" are leading words; use them consistently and define each once.

## Negation

State the target behaviour. A ban makes the reader reconstruct the positive rule and remember the exception. "Write the note in English" beats a list of languages to avoid.

## Pruning

One source of truth per fact. Delete what the reader already knows, what no branch needs, and what an earlier section said. Sediment accumulates in documents that are edited by addition alone.

## Procedure

1. Read the mission board with `show_board()` and note the work the document is meant to change.
2. Record the pointer audit with `record(type: "note", title: "pointer audit", detail: "each line loaded at every turn and the branch it triggers")`.
3. Record the shape with `record(type: "decision", title: "document shape", detail: "steps, in-file reference and disclosed reference")`.
4. Create the rewrite goal with `goal(create: "rewrite the agent-facing document", items: ["sharpen the pointer", "move reference behind a pointer", "prune no-ops"], acceptance: ["every line changes behaviour or leaves"])`.
5. Open the rewrite handoff with `handoff(to: "@doc", task: "rewrite the document", context: "the pointer audit and the document shape are in the record ledger")`.

## When to skip

A document with no surface that loads at every turn.
