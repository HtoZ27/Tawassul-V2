import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderModelTokens, getAllProviderModelTokens } from "../src/core/model-registry.ts";
import { parseAddInput, validateAddInput } from "../src/tools/agent-add-helpers.ts";
import { resolveRole } from "../src/utils/agent.ts";
import { DELETED_AGENTS } from "../src/security-policy.ts";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`PROOF FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

const root = mkdtempSync(join(tmpdir(), "s028-"));
const savedEnv = process.env.TAWASSUL_MODELS_JSON;
function useCache(name: string | null, body?: string): void {
  if (name === null) {
    delete process.env.TAWASSUL_MODELS_JSON;
  } else {
    const p = join(root, name);
    if (body !== undefined) writeFileSync(p, body);
    process.env.TAWASSUL_MODELS_JSON = p;
  }
}

try {
  useCache("provider.json", JSON.stringify({
    opencode: { models: { "fledge-alpha-free": {}, "longcat-2.5-preview-free": {}, "ling-3.1-flash-free": {}, "Exo-Free": {} } },
    empty: {},
  }));
  const tokens = getProviderModelTokens("opencode");
  assert(tokens.has("fledge-alpha-free"), "provider full slug admitted");
  assert(tokens.has("fledge"), "provider slug part admitted");
  assert(tokens.has("free"), "provider shared part admitted");
  assert(tokens.has("ling-3.1-flash-free"), "provider long-compound slug admitted");
  assert(tokens.has("ling"), "provider long-compound part admitted");
  assert(tokens.has("exo-free"), "provider slug lowercased at parse");
  assert(tokens.has("exo"), "provider slug part lowercased at parse");
  assert(getProviderModelTokens("OpenCode").has("fledge"), "provider lookup is case-insensitive");
  assert(getProviderModelTokens("no-such-provider").size === 0, "unknown provider yields empty set");
  assert(getAllProviderModelTokens().has("fledge"), "union covers provider tokens");

  assert(validateAddInput(["analyst-fledge"], "opencode/fledge-alpha-free") === null, "provider-offered variant accepted first try");
  assert(validateAddInput(["analyst-evil"], "opencode/fledge-alpha-free") !== null, "unoffered suffix still rejected with cache present");
  assert(resolveRole("analyst-fledge") === "analyst", "provider-offered suffix resolves to base role");
  assert(resolveRole("dev-evil") === null, "spoof suffix still resolves to null");

  const parsed = parseAddInput("analyst with model Exo Free from opencode");
  assert(parsed !== null && parsed.model === "opencode/exo-free", "model binding lowercased at parse");
  assert(parsed !== null && parsed.specs.join(",") === "analyst", "parse specs unchanged");

  useCache("absent.json");
  assert(validateAddInput(["analyst-mimo"], "opencode/mimo-v2.6-flash-free") === null, "static suffix accepted without cache");
  assert(validateAddInput(["analyst-fledge"], "opencode/fledge-alpha-free") !== null, "missing cache degrades to static set fail-closed");
  assert(resolveRole("analyst-fledge") === null, "no provider union without cache");

  useCache("malformed.json", "{invalid");
  assert(getProviderModelTokens("opencode").size === 0, "malformed cache yields empty set");
  assert(validateAddInput(["analyst-mimo"], "opencode/mimo-v2.6-flash-free") === null, "static gate survives malformed cache");

  const adir = join(root, "adir");
  mkdirSync(adir);
  process.env.TAWASSUL_MODELS_JSON = adir;
  assert(getProviderModelTokens("opencode").size === 0, "directory cache path yields empty set");

  const retired = ["analyst-ling", "architect-ling", "designer-ling", "dev-ling", "doc-ling", "reviewer-ling", "tester-ling"];
  for (const name of retired) {
    assert(DELETED_AGENTS.has(name), `retired variant listed: ${name}`);
  }
  assert(validateAddInput(["analyst-ling"], "opencode/ling-3.0-flash-fin-free") !== null, "retired ling variant refused at add time");
} finally {
  if (savedEnv === undefined) delete process.env.TAWASSUL_MODELS_JSON;
  else process.env.TAWASSUL_MODELS_JSON = savedEnv;
}

console.log(`PROOF PASS: s028 provider-is-truth gate (${passed} assertions)`);