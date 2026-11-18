import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getProviderModelTokens,
  getAllProviderModelTokens,
  shouldWarnUnverifiedModel,
  modelAvailability,
} from "../src/core/model-registry.ts";
import { parseAddInput, validateAddInput } from "../src/tools/agent-add-helpers.ts";
import { parseKickInput } from "../src/tools/agent-kick-helpers.ts";
import { resolveRole, registerDynamicRoles, unregisterDynamicRoles, resetDynamicRoles } from "../src/utils/agent.ts";

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
  const unoffered = validateAddInput(["analyst-evil"], "opencode/fledge-alpha-free");
  assert(unoffered !== null && !unoffered.includes("provider cache"), "a served provider keeps the registry rejection");
  assert(resolveRole("analyst-fledge") === "analyst", "provider-offered suffix resolves to base role");
  assert(resolveRole("dev-evil") === null, "spoof suffix still resolves to null");

  const parsed = parseAddInput("analyst with model Exo Free from opencode");
  assert(parsed !== null && parsed.model === "opencode/exo-free", "model binding lowercased at parse");
  assert(parsed !== null && parsed.specs.join(",") === "analyst-exo-free", "bare base derives a variant");
  assert(parsed !== null && parsed.derived["analyst-exo-free"] === "analyst", "derivation records the source base");
  const explicit = parseAddInput("analyst-mimo with model Exo Free from opencode");
  assert(explicit !== null && explicit.specs.join(",") === "analyst-mimo", "explicit suffix stays unchanged");
  assert(explicit !== null && Object.keys(explicit.derived).length === 0, "explicit suffix records no derivation");

  assert(shouldWarnUnverifiedModel("opencode/fledge-alpha-free", false) === false, "provider-served model produces no advisory");
  assert(shouldWarnUnverifiedModel("opencode/Exo-Free", false) === false, "advisory lookup is case-insensitive");
  assert(shouldWarnUnverifiedModel("opencode/evil-free", false) === true, "unserved model still warns");
  assert(shouldWarnUnverifiedModel("opencode/fledge-alpha-free", true) === false, "alias suppresses the advisory");
  assert(shouldWarnUnverifiedModel("opencode/mimo-v2.6-flash-free", false) === false, "static catalog model produces no advisory");
  assert(shouldWarnUnverifiedModel("opencode", false) === true, "bare provider id warns");
  const addSource = readFileSync("src/tools/agent-management.ts", "utf8");
  assert(addSource.includes("shouldWarnUnverifiedModel(fullModel, usedAlias)"), "addagent advisory consults the provider-aware helper");

  const kickBare = parseKickInput("remove analyst with model Exo Free from opencode");
  assert(kickBare !== null && kickBare.join(",") === "analyst-exo-free", "kick derives the variant for a bare base");
  const kickExplicit = parseKickInput("remove analyst-mimo with model Exo Free from opencode");
  assert(kickExplicit !== null && kickExplicit.join(",") === "analyst-mimo", "kick keeps an explicit suffix");
  const kickUnknown = parseKickInput("remove custom-thing with model Exo Free from opencode");
  assert(kickUnknown !== null && kickUnknown.join(",") === "custom-thing", "kick leaves a non-base spec unchanged");
  const kickAll = parseKickInput("remove all with model Exo Free from opencode");
  assert(kickAll !== null && kickAll.includes("analyst-exo-free"), "kick all covers derived variants");
  assert(kickAll !== null && !kickAll.includes("tawa-exo-free"), "kick all never derives a tawa variant");

  useCache("absent.json");
  assert(validateAddInput(["analyst-mimo"], "opencode/mimo-v2.6-flash-free") === null, "static suffix accepted without cache");
  assert(validateAddInput(["analyst-fledge"], "opencode/fledge-alpha-free") !== null, "missing cache leaves custom suffixes ungoverned and rejected");
  assert(validateAddInput(["analyst-minimax"], "nvidia/minimaxai/minimax-m3.1-flash") === null, "known suffix with an unknown model warns and allows");
  assert(resolveRole("analyst-fledge") === null, "no provider union without cache");
  const absentDerived = parseAddInput("analyst with model hy4-flash-free from opencode");
  assert(absentDerived !== null, "a bare base parses without a cache");
  assert(
    absentDerived !== null && validateAddInput(absentDerived.specs, absentDerived.model, absentDerived.derived) === null,
    "a model-derived suffix is accepted when the provider cache is absent",
  );
  assert(
    validateAddInput(["analyst-hy4-flash-free"], "opencode/hy4-flash-free") !== null,
    "the same suffix typed explicitly stays rejected without a cache",
  );
  const explicitNoCache = validateAddInput(["analyst-hy4-flash-free"], "opencode/hy4-flash-free");
  assert(
    explicitNoCache !== null && explicitNoCache.includes("provider cache"),
    "the no-cache rejection names the provider cache",
  );
  assert(
    explicitNoCache !== null && explicitNoCache.includes("analyst with model opencode/hy4-flash-free"),
    "the no-cache rejection teaches the derived form",
  );
  const mixed = parseAddInput("analyst analyst-hy4-flash-free with model hy4-flash-free from opencode");
  assert(mixed !== null, "a mixed bare and explicit spec still parses");
  assert(
    mixed !== null && validateAddInput(mixed.specs, mixed.model, mixed.derived) !== null,
    "an explicitly typed suffix is not smuggled through a bare base for the same model",
  );
  assert(resolveRole("analyst-hy4-flash-free") === null, "an unregistered derived name has no role without a cache");
  registerDynamicRoles(["analyst-hy4-flash-free"]);
  assert(resolveRole("analyst-hy4-flash-free") === "analyst", "a registered derived variant resolves to its base role");
  unregisterDynamicRoles(["analyst-hy4-flash-free"]);
  assert(resolveRole("analyst-hy4-flash-free") === null, "unregistering the variant drops the role again");
  registerDynamicRoles(["analyst-hy4-flash-free", "dev-hy4-flash-free"]);
  resetDynamicRoles();
  assert(resolveRole("analyst-hy4-flash-free") === null, "a state reload reset drops every dynamic role");

  useCache("malformed.json", "{invalid");
  assert(getProviderModelTokens("opencode").size === 0, "malformed cache yields empty set");
  assert(validateAddInput(["analyst-mimo"], "opencode/mimo-v2.6-flash-free") === null, "static gate survives malformed cache");

  const adir = join(root, "adir");
  mkdirSync(adir);
  process.env.TAWASSUL_MODELS_JSON = adir;
  assert(getProviderModelTokens("opencode").size === 0, "directory cache path yields empty set");

  useCache("provider.json");
  assert(modelAvailability("opencode/minimax-m3.1-flash") === "absent", "the provider omits the minimax slug");
  assert(validateAddInput(["analyst-minimax"], "opencode/minimax-m3.1-flash") !== null, "provider-absent minimax variant refused at add time");

  useCache(
    "exact.json",
    JSON.stringify({ opencode: { models: { "big-pickle": {} } }, broken: {} }),
  );
  assert(modelAvailability("opencode/big-pickle") === "served", "an exact provider slug is served");
  assert(modelAvailability("opencode/pickle") === "absent", "a slug fragment is not a model");
  assert(modelAvailability("broken/anything") === "unknown", "a provider without a models object stays unknown");

  useCache("nested.json", JSON.stringify({ acme: { models: { "foo/bar-baz": {} } } }));
  assert(getProviderModelTokens("acme").has("foo-bar-baz"), "a nested provider slug gains a joined token");
  const nested = parseAddInput("analyst with model acme/foo/bar-baz from acme");
  assert(nested !== null && nested.specs.join(",") === "analyst-foo-bar-baz", "a nested model derives a joined variant");
  assert(
    nested !== null && validateAddInput(nested.specs, nested.model, nested.derived) === null,
    "the joined cache token governs the nested derived suffix",
  );
  assert(
    parseKickInput("remove all with model acme/foo/bar-baz from acme")?.includes("analyst-foo-bar-baz") === true,
    "kick all derives the same joined suffix as add",
  );
  const kickMulti = parseKickInput("remove analyst dev with model hy4-flash-free from opencode");
  assert(
    kickMulti !== null && kickMulti.join(",") === "analyst-hy4-flash-free,dev-hy4-flash-free",
    "kick derives every bare base in a multi-spec removal",
  );
  for (const unsafe of ["acme/..\\..\\evil", "acme/a\\b", "acme/C:\\temp\\x", "acme/nul\u0000byte"]) {
    const probe = parseAddInput(`analyst with model ${unsafe} from acme`);
    assert(
      probe !== null && validateAddInput(probe.specs, probe.model, probe.derived) !== null,
      `an unsafe model id cannot be added: ${unsafe}`,
    );
  }
} finally {
  if (savedEnv === undefined) delete process.env.TAWASSUL_MODELS_JSON;
  else process.env.TAWASSUL_MODELS_JSON = savedEnv;
}

console.log(`PROOF PASS: s028 provider-is-truth gate (${passed} assertions)`);