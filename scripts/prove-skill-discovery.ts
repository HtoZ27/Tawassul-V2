import "./proof-log-isolate.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PILOT_COMMAND, PILOT_SKILLS, registerPilotSkills } from "../src/skills/pilot.ts";
import type { V2Context } from "../src/v2/types.ts";
import { logger } from "../src/utils/logger.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

type Added = { id: string; name: string; description: string; path: string; content: string };

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repo, "skills", "manifest.json"), "utf8")) as {
  skills: Array<{ id: string; name: string; description: string; directory: string }>;
  commands: Array<{ name: string; skillId: string }>;
};

const workspace = join(repo, ".opencode", "probe-workspace");
const added: Added[] = [];

const fakeCtx = {
  location: { directory: workspace },
  skill: {
    transform: async (callback: (editor: { add: (entry: Added) => void }) => void) => {
      callback({ add: (entry: Added) => added.push(entry) });
      return { dispose: async () => undefined };
    },
  },
} as unknown as V2Context;

const logged: string[] = [];
const originalInfo = logger.info;
logger.info = (...args: unknown[]) => {
  logged.push(args.map((arg) => String(arg)).join(" "));
};
await registerPilotSkills(fakeCtx);
logger.info = originalInfo;

assert(PILOT_SKILLS.length === manifest.skills.length, "the registered set covers exactly the manifest skills");
assert(added.length === manifest.skills.length, "boot registers every manifest skill");
assert(PILOT_COMMAND === manifest.commands[0]?.name, "the shipped command name matches the manifest");

for (const skill of manifest.skills) {
  const entry = added.find((candidate) => candidate.id === skill.id);
  assert(entry !== undefined, `${skill.id} appears in the registered set`);
  if (!entry) continue;
  assert(entry.name === skill.name, `${skill.id} registers the manifest name`);
  assert(entry.description === skill.description, `${skill.id} registers the manifest description`);
  assert(entry.content.trim().length > 0, `${skill.id} registers a non-empty body`);
  assert(entry.path === resolve(workspace, skill.directory, "SKILL.md"), `${skill.id} stages the manifest path`);
  assert(existsSync(join(repo, skill.directory, "SKILL.md")), `${skill.id} path resolves to the versioned source`);
  assert(existsSync(entry.path) === false, `${skill.id} path is a registration path, not a copied file`);
  assert(!existsSync(join(repo, ".opencode", "skills", skill.id)), `${skill.id} is absent from .opencode/skills`);
}

assert(
  logged.some((line) => line.includes("skill-registration") && line.includes("shipped=")),
  "boot logs the shipped skill ids under a shipped marker",
);
assert(
  logged.some((line) => line.includes("tawassul-goal-review") && line.includes("tawassul-context-continue")),
  "the shipped marker names every registered id",
);
assert(
  added.every((entry) => !existsSync(entry.path)),
  "no registered skill writes a file under a workspace skills directory",
);

const ids = added.map((entry) => entry.id);
assert(new Set(ids).size === ids.length, "the registered ids are unique");
assert(ids.every((id) => id.startsWith("tawassul-")), "every shipped id carries the tawassul- prefix");

console.log(`PROOF PASS: the discovery probe reads every registered skill id and path (${passed} assertions)`);
