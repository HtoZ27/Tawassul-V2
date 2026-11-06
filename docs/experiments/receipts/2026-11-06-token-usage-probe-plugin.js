import { define } from "@opencode/plugin/promise/plugin";
import { appendFileSync } from "node:fs";

const LOG = process.env.PROBE0_LOG || "";
const LABEL = process.env.PROBE0_LABEL || "run";
const INSPECT = (process.env.PROBE0_INSPECT || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const IDLE_ALL = process.env.PROBE0_IDLE_ALL === "1";
const COMPACT = (process.env.PROBE0_COMPACT || "").trim();

function write(type, data) {
  if (!LOG) return;
  const record = { label: LABEL, at: new Date().toISOString(), pid: process.pid, type, data };
  try {
    appendFileSync(LOG, `${JSON.stringify(record)}\n`);
  } catch {
    void 0;
  }
}

function trim(value, head = 1000, tail = 1000) {
  if (typeof value !== "string") return value;
  if (value.length <= head + tail) return value;
  return { length: value.length, head: value.slice(0, head), tail: value.slice(-tail) };
}

function compact(value, limit = 1500) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return trim(text, limit, limit);
}

function compactEvent(event) {
  const base = { type: event.type };
  const data = event.data || {};
  if (event.type === "session.usage.updated") return { ...base, data };
  for (const key of ["sessionID", "messageID", "partID", "callID", "agent", "status"]) {
    if (data[key] !== undefined) base[key] = data[key];
  }
  if (data.info) {
    base.info = {
      id: data.info.id,
      parentID: data.info.parentID,
      agent: data.info.agent,
      cost: data.info.cost,
      tokens: data.info.tokens,
      title: data.info.title,
    };
  }
  if (data.message) base.message = { id: data.message.id, role: data.message.role };
  if (data.part) {
    base.part = {
      id: data.part.id,
      type: data.part.type,
      tool: data.part.tool,
      state: data.part.state?.status,
      text: typeof data.part.text === "string" ? trim(data.part.text, 200, 200) : undefined,
    };
  }
  return base;
}

async function inspect(ctx, id, why) {
  try {
    write("inspect.get", { why, id, info: await ctx.session.get({ sessionID: id }) });
  } catch (error) {
    write("inspect.error", { why, id, op: "get", error: String(error) });
  }
  try {
    const messages = await ctx.session.context({ sessionID: id });
    write("inspect.context", {
      why,
      id,
      count: messages.length,
      last: messages.slice(-6).map((message) => ({
        id: message.id,
        type: message.type,
        role: message.role,
        text: typeof message.text === "string" ? trim(message.text, 400, 400) : undefined,
        content: Array.isArray(message.content)
          ? message.content.map((part) => ({
              type: part.type,
              text: typeof part.text === "string" ? trim(part.text, 400, 400) : undefined,
              tool: part.tool,
              state: part.state?.status,
            }))
          : undefined,
        tool: message.tool,
        state: message.state?.status,
        parts: Array.isArray(message.parts)
          ? message.parts.map((part) => ({
              type: part.type,
              text: typeof part.text === "string" ? trim(part.text, 400, 400) : undefined,
              tool: part.tool,
              state: part.state?.status,
            }))
          : undefined,
      })),
    });
  } catch (error) {
    write("inspect.error", { why, id, op: "context", error: String(error) });
  }
}

export default define({
  id: "probe0",
  async setup(ctx) {
    write("plugin.init", { dir: ctx.location?.directory, version: ctx.app?.version, inspect: INSPECT, idleAll: IDLE_ALL, compact: COMPACT });
    if (COMPACT) {
      try {
        const res = await ctx.session.compact({ sessionID: COMPACT, delivery: "steer" });
        write("compact.request", { id: COMPACT, result: res });
      } catch (error) {
        write("compact.error", { id: COMPACT, error: String(error) });
      }
    }
    const sink = async () => {
      try {
        for await (const event of ctx.event.subscribe()) {
          write("event", compactEvent(event));
          if (IDLE_ALL && event.type === "session.idle") {
            try {
              const sessions = await ctx.session.list();
              write("inspect.list", {
                why: "idle",
                count: sessions.length,
                sessions: sessions.map((info) => ({
                  id: info.id,
                  parentID: info.parentID,
                  agent: info.agent,
                  cost: info.cost,
                  tokens: info.tokens,
                })),
              });
              for (const info of sessions) await inspect(ctx, info.id, "idle");
            } catch (error) {
              write("inspect.error", { why: "idle", op: "list", error: String(error) });
            }
          }
        }
      } catch (error) {
        write("event.error", String(error?.stack || error));
      }
    };
    void sink();
    try {
      await ctx.tool.hook("execute.before", (input) => {
        write("tool.before", {
          tool: input.tool,
          sessionID: input.sessionID,
          agent: input.agent,
          messageID: input.messageID,
          id: input.id,
          input: compact(input.input, 1200),
        });
      });
    } catch (error) {
      write("hook.error", { op: "before", error: String(error) });
    }
    try {
      await ctx.tool.hook("execute.after", (input) => {
        write("tool.after", {
          tool: input.tool,
          sessionID: input.sessionID,
          agent: input.agent,
          messageID: input.messageID,
          id: input.id,
          status: input.status,
          result: input.result
            ? {
                title: input.result.title,
                output: compact(input.result.output, 1500),
                metadata: input.result.metadata,
              }
            : undefined,
          error: input.error ? compact(input.error, 1500) : undefined,
        });
      });
    } catch (error) {
      write("hook.error", { op: "after", error: String(error) });
    }
    for (const id of INSPECT) await inspect(ctx, id, "setup");
    write("plugin.ready", {});
  },
});
