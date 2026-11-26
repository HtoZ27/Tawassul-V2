import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRosterBoundaryDelete } from "../src/hooks/guards/permission-guard.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function check(name: string, tool: string, agent: string | undefined, args: Record<string, unknown>, wantBlock: boolean): Promise<void> {
  const msg = await checkRosterBoundaryDelete({ tool, agent } as never, { args } as never);
  const blocked = msg !== null;
  if (blocked !== wantBlock) {
    fail(`${name}: expected blocked=${wantBlock}, got ${blocked}${msg ? ` :: ${msg.slice(0, 100)}` : ""}`);
  }
  console.log(`ok ${name} blocked=${blocked}`);
}

async function main(): Promise<void> {
  const disk = readFileSync(resolve(REPO, "opencode.json"), "utf-8");
  const diskAgents = (JSON.parse(disk) as { agent: Record<string, unknown> }).agent;

  const reduced = JSON.stringify({ agent: { dev: diskAgents["dev"] } });
  await check("variant-md-direct-edit", "edit", "dev", { filePath: ".opencode/agents/dev-muse.md", oldString: "x", newString: "y" }, true);
  await check("readme-md-untouched", "edit", "dev", { filePath: "README.md", oldString: "x", newString: "y" }, false);
  await check("key-delete", "write", "dev", { filePath: "opencode.json", content: reduced }, true);
  const added = JSON.parse(disk) as { agent: Record<string, unknown> };
  added.agent["devx"] = added.agent["dev"];
  await check("key-add", "write", "dev", { filePath: "opencode.json", content: JSON.stringify(added) }, true);
  await check("empty-wipe", "write", "dev", { filePath: "opencode.json", content: "   " }, true);
  await check("oldstring-miss", "edit", "dev", { filePath: "opencode.json", oldString: "NOPE-NOT-ON-DISK-zzz", newString: "y" }, true);
  await check("nonroster-passthrough", "edit", "dev", { filePath: "src/foo.ts", oldString: "a", newString: "b" }, false);

  const work = mkdtempSync(join(tmpdir(), "tawassul-roster-boundary-"));
  try {
    mkdirSync(join(work, ".opencode"), { recursive: true });
    const sidecar = join(work, ".opencode", "deleted-agents.json");
    writeFileSync(sidecar, JSON.stringify({ deleted: ["dev-ling"] }), "utf8");
    await check("sidecar-shrink-passthrough", "write", "dev", { filePath: sidecar, content: '{"deleted":[]}' }, false);
    const globalRoster = join(work, "tawassul.jsonc");
    writeFileSync(globalRoster, JSON.stringify({ agents: {}, deleted: ["dev-ling"] }), "utf8");
    await check("global-roster-shrink-blocked", "write", "dev", { filePath: globalRoster, content: '{"deleted":[]}' }, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log("PROOF PASS: roster boundary delete guard");
}

await main();
