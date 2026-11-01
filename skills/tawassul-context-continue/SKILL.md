# Context continue

1. List the stored packs with `thread(action: "list")` and note the live digest.
2. Read the newest pack with `thread(action: "read", digest: "the digest")`.
3. Pack the current session with `thread(action: "pack")` and note its digest.
4. Continue the session in a successor with `thread(action: "continue", sessionID: "ses_001", model: "provider/model", text: "continue the task")`.
5. Record the transfer with `record(type: "note", title: "context continue", detail: "the pack moved to the successor session")`.
6. List the packs again with `thread(action: "list")` and confirm the transferred count.
