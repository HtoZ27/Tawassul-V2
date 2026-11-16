# Goal review

1. Open the tiered board with `goal(board: true)` and pick the goals in the attention tier.
2. Read one goal in full with `goal(get: "G-001")`, across its items and definition of done.
3. Attach the completion evidence with `goal(evidence: "G-001", evidenceText: "the item finished with a receipt")`.
4. Mark a finished item with `goal(update: "G-001", itemId: "G-001-I1", itemEvidence: [{"itemId": "G-001-I1", "text": "the item finished with a receipt"}], itemState: "done")`.
5. Mark a met criterion with `goal(update: "G-001", acceptId: "the criterion text", acceptState: "met", acceptEvidence: "the receipt")`.
6. Close the completed goal with `goal(close: "G-001")`.
7. Record the review outcome with `record(type: "note", title: "goal review", detail: "G-001 closed after its items and criteria were met")`.
8. Show the board again with `show_board()` and confirm the closed goal left the attention tier.
