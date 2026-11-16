import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DYNAMIC_MODEL_SENTINEL } from "../src/services/proxy-fallback-chains.ts";
import { applyBootRepairs, repairProjectConfigBoot } from "../src/utils/opencode-config.ts";
import { buildAgents } from "../src/scripts/gen-opencode-config.ts";
import { BASH_READ_ONLY } from "../src/permissions.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

type PermissionMap = Record<string, unknown>;

function caseInsensitiveDuplicates(rules: Record<string, string>): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const key of Object.keys(rules)) {
    const lower = key.toLowerCase();
    const first = seen.get(lower);
    if (first === undefined) seen.set(lower, key);
    else duplicates.push(`${first} / ${key}`);
  }
  return duplicates;
}

type AgentConfig = { model?: string; permission?: PermissionMap; [key: string]: unknown };

type Config = { model?: string; agent?: Record<string, AgentConfig>; [key: string]: unknown };

function readConfig(path: string): Config {
  return JSON.parse(readFileSync(path, "utf-8")) as Config;
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "tawassul-e02-"));
  const configPath = join(work, "opencode.json");
  const base: Config = {
    model: "opencode/big-pickle",
    agent: {
      tawa: {
        model: "opencode/big-pickle",
        permission: {
          goal: "deny",
          timeline: "ask",
          bash: { "*": "deny", "ls *": "allow" },
          write: "allow",
        },
      },
      addagent: {
        model: "opencode/big-pickle",
        permission: {},
      },
      dev: {
        model: "google/gemini-flash-lite-latest",
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(base, null, 2) + "\n");

  try {
    const first = await repairProjectConfigBoot(work);
    assert(first.changed, "boot repair rewrites a config that needs permission repairs");
    assert(first.fixes.includes("agent-permissions"), "the permission repair is reported as a boot fix");

    const repaired = readConfig(configPath);
    const tawa = repaired.agent?.tawa?.permission ?? {};
    const addagent = repaired.agent?.addagent?.permission ?? {};

    assert(tawa["edit"] === "deny", "tawa is denied edit when no rule exists");
    assert(tawa["write"] === "deny", "a permissive write rule is tightened to deny");
    assert(
      JSON.stringify(tawa["bash"]) === JSON.stringify({ "*": "deny", "ls *": "allow" }),
      "an existing scoped bash allowlist is preserved instead of clobbered",
    );
    assert(tawa["addagent"] === "deny", "tawa is denied addagent");
    assert(tawa["kick"] === "deny", "tawa is denied kick");
    assert(tawa["pause"] === "deny", "tawa is denied pause");
    assert(tawa["resume"] === "deny", "tawa is denied resume");
    assert(tawa["discussion"] === "allow", "an unruled Tawassul tool is auto-granted to tawa");
    assert(tawa["goal"] === "deny", "an explicit user rule for tawa is preserved");
    assert(tawa["timeline"] === "ask", "an explicit ask rule for tawa is preserved");
    assert(addagent["addagent"] === "allow", "addagent may call addagent");
    assert(addagent["kick"] === "allow", "addagent may call kick");
    assert(repaired.agent?.dev?.permission === undefined, "an unrelated agent is not given permissions");
    assert(repaired.agent?.dev?.model === "google/gemini-flash-lite-latest", "an unrelated agent keeps its model");
    assert(repaired.model === "opencode/big-pickle", "the top-level model is preserved");

    const bytes = readFileSync(configPath, "utf-8");
    const second = await repairProjectConfigBoot(work);
    assert(!second.changed, "a repaired config is not rewritten again");
    assert(readFileSync(configPath, "utf-8") === bytes, "the second boot leaves the file byte-identical");

    const globalDir = mkdtempSync(join(tmpdir(), "tawassul-e02-global-"));
    const globalPath = join(globalDir, "opencode.json");
    const globalBytes =
      JSON.stringify(
        {
          model: DYNAMIC_MODEL_SENTINEL,
          agent: { tawa: { permission: { edit: "allow" } } },
        },
        null,
        2,
      ) + "\n";
    writeFileSync(globalPath, globalBytes);
    const previousGlobal = process.env.TAWASSUL_GLOBAL_DIR;
    process.env.TAWASSUL_GLOBAL_DIR = globalDir;
    try {
      const scoped = await repairProjectConfigBoot(work);
      assert(scoped.configPath === configPath, "the boot repair names the project config, never the global one");
      assert(
        readFileSync(globalPath, "utf-8") === globalBytes,
        "a project boot repair leaves the global config byte-identical",
      );
      const refused = await repairProjectConfigBoot(globalDir);
      assert(refused.configPath === globalPath, "the boot repair finds the global config it must not write");
      assert(!refused.changed, "the boot repair refuses to rewrite a global config");
      assert(refused.fixes.length === 0, "the boot repair reports no fixes for a global config");
      assert(
        readFileSync(globalPath, "utf-8") === globalBytes,
        "a direct global boot repair leaves the config byte-identical",
      );
    } finally {
      if (previousGlobal === undefined) delete process.env.TAWASSUL_GLOBAL_DIR;
      else process.env.TAWASSUL_GLOBAL_DIR = previousGlobal;
      rmSync(globalDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const raw = JSON.stringify(
    {
      model: "opencode/big-pickle",
      agent: {
        tawa: { model: DYNAMIC_MODEL_SENTINEL, permission: {} },
      },
    },
    null,
    2,
  );
  const applied = applyBootRepairs(raw);
  assert(applied.fixes.includes("dynamic-models"), "the model repair still runs in the same pass");
  assert(applied.fixes.includes("agent-permissions"), "the permission repair runs beside the model repair");
  assert(applied.next !== raw, "a config that needs both repairs is rewritten");
  const appliedConfig = JSON.parse(applied.next) as Config;
  assert(appliedConfig.agent?.tawa?.model !== DYNAMIC_MODEL_SENTINEL, "the dynamic model becomes concrete");
  assert(appliedConfig.agent?.tawa?.permission?.["bash"] === "deny", "the same pass denies bash for tawa");

  const modelsDir = mkdtempSync(join(tmpdir(), "tawassul-e02-models-"));
  const savedModels = process.env.TAWASSUL_MODELS_JSON;
  try {
    const absentModels = join(modelsDir, "absent.json");
    writeFileSync(
      absentModels,
      JSON.stringify({ opencode: { models: {} }, "cloudflare-workers-ai": { models: {} } }),
    );
    process.env.TAWASSUL_MODELS_JSON = absentModels;
    const pinnedRaw = JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        agent: { dev: { model: "opencode/mimo-v2.5-free" } },
      },
      null,
      2,
    );
    const absentRepair = applyBootRepairs(pinnedRaw);
    assert(absentRepair.fixes.includes("dynamic-models"), "boot repair rewrites an absent dynamic model");
    assert(
      (JSON.parse(absentRepair.next) as Config).agent?.dev?.model !== "opencode/mimo-v2.5-free",
      "an absent dynamic model is replaced",
    );
    const servedModels = join(modelsDir, "served.json");
    writeFileSync(
      servedModels,
      JSON.stringify({ opencode: { models: { "mimo-v2.5-free": {} } }, "cloudflare-workers-ai": { models: {} } }),
    );
    process.env.TAWASSUL_MODELS_JSON = servedModels;
    const servedRepair = applyBootRepairs(pinnedRaw);
    assert(!servedRepair.fixes.includes("dynamic-models"), "boot repair keeps a served dynamic model");
    assert(
      (JSON.parse(servedRepair.next) as Config).agent?.dev?.model === "opencode/mimo-v2.5-free",
      "a served dynamic model stays pinned",
    );
  } finally {
    if (savedModels === undefined) delete process.env.TAWASSUL_MODELS_JSON;
    else process.env.TAWASSUL_MODELS_JSON = savedModels;
    rmSync(modelsDir, { recursive: true, force: true });
  }

  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const generated = buildAgents(undefined, { projectRoot: resolve(repo) });
  assert(Object.keys(generated).length === 58, "full-capacity generation is 58 keys");
  assert(
    caseInsensitiveDuplicates(BASH_READ_ONLY).length === 0,
    "the read-only bash map carries no case-insensitive duplicate keys",
  );
  for (const [name, cfg] of Object.entries(generated)) {
    const bash = cfg.permission.bash;
    if (typeof bash === "object" && bash !== null) {
      assert(
        caseInsensitiveDuplicates(bash).length === 0,
        `${name} emits no case-insensitive duplicate bash keys`,
      );
    }
  }
  const generatedRaw = JSON.stringify({ model: "opencode/big-pickle", agent: generated }, null, 2);
  const generatedRepair = applyBootRepairs(generatedRaw);
  assert(
    generatedRepair.fixes.length === 0,
    "a freshly generated config already satisfies the permission repair",
  );

  const livePath = join(repo, "opencode.json");
  const liveConfig = existsSync(livePath) ? readFileSync(livePath, "utf8") : "";
  if (liveConfig) {
    const liveDoc = JSON.parse(liveConfig) as Record<string, unknown>;
    assert(!("subagent_depth" in liveDoc), "the live config carries no top-level subagent_depth key");
    assert(
      (liveDoc["experimental"] as Record<string, unknown> | undefined)?.["subagent_depth"] === 3,
      "the live config pins experimental.subagent_depth to 3",
    );
    assert(!liveConfig.includes('"compaction"'), "the live config carries no compaction block");
  } else {
    console.log("skip live config checks: the checkout has no opencode.json (gitignored by design)");
  }
  assert(!generatedRaw.includes("subagent_depth"), "the generated agent roster never emits subagent_depth");
  assert(!generatedRaw.includes('"compaction"'), "generated config never emits compaction");

  const bare = JSON.stringify({ model: "opencode/big-pickle", agent: {} }, null, 2);
  assert(
    !("subagent_depth" in (JSON.parse(applyBootRepairs(bare).next) as Record<string, unknown>)),
    "boot repair never adds a depth key",
  );

  const legacyRaw = JSON.stringify(
    {
      model: "opencode/big-pickle",
      subagent_depth: 3,
      compaction: { prune: true },
    },
    null,
    2,
  );
  const legacyRepair = applyBootRepairs(legacyRaw);
  assert(legacyRepair.fixes.length === 0, "legacy v1 keys trigger no boot repair pass");
  const legacyConfig = JSON.parse(legacyRepair.next) as Record<string, unknown>;
  assert(legacyConfig["subagent_depth"] === 3, "boot repair leaves subagent_depth untouched");
  assert(
    (legacyConfig["compaction"] as { prune?: boolean }).prune === true,
    "boot repair leaves compaction.prune untouched",
  );
  const repairSource = readFileSync(join(repo, "src", "utils", "opencode-config.ts"), "utf8");
  const repairStart = repairSource.indexOf("export function applyBootRepairs");
  const repairEnd = repairSource.indexOf("export async function repairProjectConfigBoot");
  const repairFn = repairStart >= 0 && repairEnd > repairStart ? repairSource.slice(repairStart, repairEnd) : "";
  assert(repairFn.length > 0, "the boot repair function is present");
  assert(!repairFn.includes("subagent_depth"), "the boot repair never names subagent_depth");
  assert(!repairFn.includes("compaction.prune"), "the boot repair never names compaction.prune");
}

try {
  await main();
  console.log(`PROOF PASS: the v2 boot repair applies the tawa and addagent permission helpers (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
