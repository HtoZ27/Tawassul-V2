import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRosterBoundaryDelete } from "../src/hooks/guards/permission-guard.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function check(name: string, tool: string, agent: string | undefined, args: Record<string, unknown>, wantBlock: boolean): void {
  const msg = checkRosterBoundaryDelete({ tool, agent } as never, { args } as never);
  const blocked = msg !== null;
  if (blocked !== wantBlock) {
    fail(`${name}: expected blocked=${wantBlock}, got ${blocked}${msg ? ` :: ${msg.slice(0, 100)}` : ""}`);
  }
  console.log(`ok ${name} blocked=${blocked}`);
}

const disk = readFileSync(resolve(REPO, "opencode.json"), "utf-8");
const diskAgents = (JSON.parse(disk) as { agent: Record<string, unknown> }).agent;

const reduced = JSON.stringify({ agent: { dev: diskAgents["dev"] } });
check("variant-md-direct-edit", "edit", "dev", { filePath: ".opencode/agents/dev-muse.md", oldString: "x", newString: "y" }, true);
check("readme-md-untouched", "edit", "dev", { filePath: "README.md", oldString: "x", newString: "y" }, false);
check("key-delete", "write", "dev", { filePath: "opencode.json", content: reduced }, true);
const added = JSON.parse(disk) as { agent: Record<string, unknown> };
added.agent["devx"] = added.agent["dev"];
check("key-add", "write", "dev", { filePath: "opencode.json", content: JSON.stringify(added) }, true);
check("empty-wipe", "write", "dev", { filePath: "opencode.json", content: "   " }, true);
check("oldstring-miss", "edit", "dev", { filePath: "opencode.json", oldString: "NOPE-NOT-ON-DISK-zzz", newString: "y" }, true);
check("nonroster-passthrough", "edit", "dev", { filePath: "src/foo.ts", oldString: "a", newString: "b" }, false);

console.log("PROOF PASS: roster boundary delete guard");
