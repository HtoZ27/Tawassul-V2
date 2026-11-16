export type ProcedureCall = {
  tool: string;
  args: Record<string, unknown>;
  line: number;
};

const CALL_RE = /`([a-z_]+)\(([^`]*)\)`/g;

const FORBIDDEN: RegExp[] = [
  /\bnever\b/i,
  /\bmust\b/i,
  /\brequired?\b/i,
  /\brequires?\b/i,
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bcannot\b/i,
  /\bshall\b/i,
  /\balways\b/i,
  /\bonly\b/i,
  /\bprerequisite\b/i,
  /\bprohibit/i,
  /\bguarantee/i,
  /\breturns?\b/i,
  /\bfails?\b/i,
  /\bbefore\b/i,
  /\bunless\b/i,
  /\baccepts?\b/i,
  /\bexpects?\b/i,
  /\bproduces?\b/i,
  /\bemits?\b/i,
];

function splitArgs(expr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i]!;
    if (char === "\\" && quoted && i + 1 < expr.length) {
      current += char + expr[i + 1]!;
      i++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === "[" || char === "{") depth++;
      else if (char === "]" || char === "}") depth--;
    }
    if (char === "," && !quoted && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted) throw new Error(`unterminated string in procedure call: ${expr}`);
  if (depth !== 0) throw new Error(`unbalanced brackets in procedure call: ${expr}`);
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

function parseValue(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`invalid JSON value in procedure call: ${value}`);
    }
  }
  if (value.length === 0) throw new Error("empty argument value in procedure call");
  return value;
}

export function parseProcedure(body: string): ProcedureCall[] {
  const calls: ProcedureCall[] = [];
  for (const match of body.matchAll(CALL_RE)) {
    const tool = match[1]!;
    const expr = match[2]!.trim();
    const args: Record<string, unknown> = {};
    if (expr.length > 0) {
      for (const chunk of splitArgs(expr)) {
        const separator = chunk.indexOf(":");
        if (separator <= 0) throw new Error(`argument without a name in ${tool}: ${chunk.trim()}`);
        const key = chunk.slice(0, separator).trim();
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) {
          throw new Error(`invalid argument name in ${tool}: ${key}`);
        }
        if (key in args) throw new Error(`duplicate argument ${key} in ${tool}`);
        args[key] = parseValue(chunk.slice(separator + 1));
      }
    }
    const line = body.slice(0, match.index).split("\n").length;
    calls.push({ tool, args, line });
  }
  return calls;
}

export function findForbidden(body: string): string[] {
  const found: string[] = [];
  for (const pattern of FORBIDDEN) {
    const match = body.match(pattern);
    if (match) found.push(match[0]);
  }
  return found;
}

export function callSignature(calls: readonly ProcedureCall[]): string {
  return JSON.stringify(calls.map((call) => ({ tool: call.tool, args: call.args })));
}
