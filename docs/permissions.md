# Permissions and consent

Tawassul runs inside the host, so it cannot grant itself more access than the
host gives it. What it adds is a second gate in front of its own tools: a call is
authorised before it runs, and a denied call performs no partial work.

## Two layers

| Layer | Owner | Decides |
| --- | --- | --- |
| Host permissions | OpenCode | Which tools an agent may call at all |
| Plugin guard | Tawassul | Whether this call, by this agent, with these arguments, may proceed |

A tool must pass both. The plugin cannot widen the host's decision, and the host
cannot make the plugin skip its own checks.

## What the guard checks

1. **Known tool.** A name outside the declared surface is not a Tawassul tool.
2. **Role.** The role matrix declares which agents may call which tools. It is
   the single source for that mapping; a tool cannot widen it at runtime.
3. **Router limits.** `tawa` is an intermediary, not an implementer. It is
   blocked from `edit`, `write`, `bash`, `addagent`, `kick`, `pause`, and
   `resume`, including their aliases.
4. **Dispatch limits.** `maxCallDepth` bounds nested `task()` calls and
   `maxTotalTasks` bounds the session total.
5. **Path.** A path argument is resolved against the workspace. A traversal, a
   symlink escape, or a protected system root is refused.
6. **Consent.** A destructive tool requires an accepted consent word. A single
   derived-variant removal is the one exception.

The refusal is returned as the tool result, with the reason. It is not a silent
no-op: a caller that ignores the error will still see that nothing happened.

## Consent words

Destructive tools are `bash`, `shell`, `delete`, and `kick`. A single removal of
a derived variant, such as `remove dev-beam with model … from …`, is not gated;
a bare base removal, a bulk removal, and a multi-target removal stay gated.

Before a gated call runs, the plugin asks for confirmation and accepts a natural
answer. The built-in words cover English and 20 other languages. The reply must
be the word itself, or one of the listed approval phrases such as `yes please`,
so a sentence that merely starts with an approval word does not count.

Built-in English accept words include `yes`, `y`, `sure`, `ok`, `okay`, `go ahead`,
`fine`, `true`, and `1`. Built-in reject words include `no`, `stop`, `reject`,
`deny`, `decline`, `not now`, `false`, and `0`. A reject word anywhere in the
reply vetoes approval.

Matching is deliberately forgiving:

- case is ignored;
- leading and trailing punctuation is stripped;
- zero-width characters are removed;
- Arabic diacritics, tatweel, and common letter variants are normalised, so a
  natural Arabic answer is recognised without a special syntax.

### Extending the list

Put your own words in `consent-tokens.json`:

```json
{
  "accept": ["proceed", "ship it"],
  "deny": ["hold", "not yet"]
}
```

The file lives at `$XDG_CONFIG_HOME/tawassul-v2/consent-tokens.json`, or at the
path in `TAWASSUL_CONSENT_TOKENS`. The file is re-read when its modification
time changes, so an edit applies without a restart.

A custom word extends the built-in list; it does not replace it. A deny word
always wins over an accept word.

## Read-only agents

Some roles are declared read-only for shell work. `analyst` and `reviewer`, for
example, carry an allow-list of inspection commands and a deny-by-default
pattern: `rg`, `ls`, `cat`, `git diff`, `git log`, and similar reads are
allowed, while a write, a redirect, or an interpreter invocation is not.

The allow-list is a set of command patterns, not a sandbox. It reduces the blast
radius of a mistaken command; it does not make a hostile command safe. The real
boundary is the host permission plus the operating-system user.

## Paths

- A relative path resolves against the workspace, not the process working
  directory.
- A path that escapes the workspace through `..` or a symlink is rejected.
- Protected roots (`/`, `/etc`, `/usr`, `/home`, and similar) are refused as a
  write target.
- The configuration loader applies the same rule: a config path that escapes its
  root is rejected and the base directory is used with a warning.

## Privacy

- Provider credentials are never read, stored, or logged by the plugin.
- Outbound text passes the privacy guard. `privacyGuardParanoid` enables the
  strictest mode.
- Logs redact key-shaped values. Debug logging is opt-in
  (`TAWASSUL_DEBUG=1`), and a log file is chosen explicitly
  (`TAWASSUL_LOG_FILE`).
- The web tool refuses private, loopback, link-local, and unique-local targets
  before a request leaves the machine.

## When a call is denied

| Message | Meaning | Fix |
| --- | --- | --- |
| `tool not allowed for role` | The role matrix does not grant this tool | Ask the role that owns the tool, or hand off |
| `call depth exceeded` | Too many nested dispatches | Use a handoff instead of nesting |
| `maximum number of task() calls` | The session task budget is spent | Split the work or start a new session |
| `consent` | No accepted word was received | Answer with an accept word |
| `path rejected` | The path leaves the workspace or hits a protected root | Use a path inside the workspace |
| `SSRF` | The URL resolves to a private or link-local address | Use a public target |

Do not work around a denial by editing the guard. A denial is the control doing
its job; if the policy is wrong, change the policy in one place and prove the
change.

---

[Documentation index](README.md)
