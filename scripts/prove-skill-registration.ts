import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";
import { toolNameSetHash } from "../src/services/tool-tripwire.ts";
import {
  PILOT_COMMAND,
  PILOT_COMMAND_TEXT,
  PILOT_SKILLS,
  addPilotSkills,
  registerPilotCommand,
  registerPilotSkills,
  runPilotCommand,
  type PilotSkill,
} from "../src/skills/pilot.ts";
import { TAWASSUL_TOOL_NAMES } from "../src/tool-names.ts";
import type { V2Context } from "../src/v2/types.ts";

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

type RegisteredSkill = {
  id: string;
  name: string;
  description?: string;
  path: string;
  content: string;
  autoinvoke?: boolean;
};

type EditorOptions = {
  reject?: (skill: RegisteredSkill) => boolean;
  user?: RegisteredSkill[];
};

function makeEditor(options: EditorOptions = {}) {
  const store = new Map<string, RegisteredSkill>(
    (options.user ?? []).map((skill) => [skill.id, skill]),
  );
  return {
    store,
    add(skill: RegisteredSkill): void {
      if (store.has(skill.id)) throw new Error(`duplicate skill id ${skill.id}`);
      if (options.reject?.(skill)) throw new Error(`rejected ${skill.id}`);
      store.set(skill.id, skill);
    },
    list: () => [...store.values()],
    get: (id: string) => store.get(id),
    update: () => {
      throw new Error("update must not run");
    },
    remove: () => {
      throw new Error("remove must not run");
    },
  };
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const editor = makeEditor();
const added = addPilotSkills(editor, repo);
assert(added.skipped.length === 0, "every pilot skill registers on a healthy host");
assert(
  JSON.stringify(added.added) === JSON.stringify(PILOT_SKILLS.map((skill) => skill.id)),
  "the registered id order matches the shipped set",
);
for (const skill of PILOT_SKILLS) {
  const registered = editor.store.get(skill.id);
  if (!registered) fail(`${skill.id} is missing from the editor`);
  assert(resolve(registered.path) === registered.path, `${skill.id} registers an absolute path`);
  assert(
    registered.path.endsWith(`skills/${skill.id}/SKILL.md`),
    `${skill.id} registers its staged path`,
  );
  assert(registered.content === skill.content, `${skill.id} registers the shipped body`);
  assert(registered.autoinvoke === true, `${skill.id} is discoverable without an explicit call`);
}

const invalid: PilotSkill = {
  id: "tawassul-invalid",
  name: "Invalid",
  description: "invalid",
  directory: "skills/tawassul-invalid",
  content: "# invalid",
};
const rejecting = makeEditor({ reject: (skill) => skill.id === invalid.id });
const contained = addPilotSkills(rejecting, repo, [...PILOT_SKILLS, invalid]);
assert(contained.skipped.join(",") === invalid.id, "one rejected skill is reported and skipped");
assert(
  contained.added.length === PILOT_SKILLS.length,
  "the rest of the registered set survives a rejected skill",
);
assert(
  PILOT_SKILLS.every((skill) => rejecting.store.has(skill.id)),
  "every healthy skill is still registered after a rejection",
);

const userSkill: RegisteredSkill = {
  id: PILOT_SKILLS[0]!.id,
  name: "User copy",
  description: "user authored",
  path: "/home/user/.config/opencode/skills/user-copy/SKILL.md",
  content: "# user procedure",
};
const withUser = makeEditor({ user: [userSkill] });
const overridden = addPilotSkills(withUser, repo);
assert(overridden.skipped.includes(userSkill.id), "a same-name user skill wins over the shipped one");
assert(
  withUser.store.get(userSkill.id)?.content === userSkill.content,
  "the user skill content is never overwritten",
);
assert(
  overridden.added.length === PILOT_SKILLS.length - 1,
  "the remaining shipped skills still register",
);

const transformFailure = {
  location: { directory: repo },
  skill: {
    transform: async () => {
      throw new Error("host rejected the transform");
    },
  },
} as unknown as V2Context;
assert(
  (await registerPilotSkills(transformFailure)).length === 0,
  "a rejected transform returns no registration and does not throw",
);

const noSkillDomain = { location: { directory: repo } } as unknown as V2Context;
assert(
  (await registerPilotSkills(noSkillDomain)).length === 0,
  "a host without the skill domain still boots",
);

const captured: string[] = [];
let disposed = 0;
const healthyHost = {
  location: { directory: repo },
  skill: {
    transform: async (callback: (draft: ReturnType<typeof makeEditor>) => void) => {
      const draft = makeEditor();
      callback(draft);
      captured.push(...draft.store.keys());
      return { dispose: async () => void disposed++ };
    },
  },
} as unknown as V2Context;
const registrations = await registerPilotSkills(healthyHost);
assert(registrations.length === 1, "a healthy host returns one disposable registration");
assert(
  JSON.stringify(captured) === JSON.stringify(PILOT_SKILLS.map((skill) => skill.id)),
  "boot registers exactly the manifest ids",
);
await registrations[0]!.dispose();
assert(disposed === 1, "the registration disposes once");

const prompts: Array<{ sessionID: string; text: string; delivery?: string }> = [];
const base = {
  location: { directory: repo },
  session: {
    prompt: async (input: { sessionID: string; text: string; delivery?: string }) => {
      prompts.push(input);
    },
  },
} as unknown as V2Context;

type CommandDefinition = {
  name: string;
  description?: string;
  execute: (input: { sessionID: string; prompt: { text: string } }) => Promise<void>;
};
const commands: CommandDefinition[] = [];
const commandHost = {
  ...base,
  command: {
    transform: async (callback: (draft: { add: (definition: CommandDefinition) => void }) => void) => {
      callback({ add: (definition) => commands.push(definition) });
      return { dispose: async () => undefined };
    },
  },
} as unknown as V2Context;
const commandRegistration = await registerPilotCommand(commandHost);
assert(commandRegistration !== undefined, "the pilot command registers on a healthy host");
assert(commands.length === 1, "one pilot command is registered");
assert(commands[0]!.name === PILOT_COMMAND, "the command name matches the manifest");
assert(commands[0]!.name.startsWith("tawassul-"), "the command name uses the tawassul- prefix");
await commands[0]!.execute({ sessionID: "ses_1", prompt: { text: "  review goals  " } });
assert(prompts.length === 1, "the command injects one prompt");
assert(prompts[0]!.sessionID === "ses_1", "the command keeps the session id");
assert(prompts[0]!.text.includes("review goals"), "the command forwards the typed text");
assert(
  prompts[0]!.text.includes("tawassul-goal-review"),
  "the command points at the shipped goal review skill",
);
await runPilotCommand(base, { sessionID: "ses_2", prompt: { text: "" }, delivery: "steer" } as never);
assert(prompts[1]!.text === PILOT_COMMAND_TEXT, "the command falls back to the shipped instruction");

function snapshotDir(dir: string): string {
  if (!existsSync(dir)) return "";
  const rows: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else rows.push(`${relative(dir, full)}:${statSync(full).size}`);
    }
  };
  walk(dir);
  return rows.sort().join("\n");
}

const userSkillsDir = join(repo, ".opencode", "skills");
const beforeSkills = snapshotDir(userSkillsDir);
await registerPilotSkills(healthyHost);
assert(
  snapshotDir(userSkillsDir) === beforeSkills,
  "registration writes nothing under the user skills directory",
);
const moduleSource = readFileSync(join(repo, "src", "skills", "pilot.ts"), "utf8");
assert(!moduleSource.includes("node:fs"), "the skills module imports no filesystem writer");
assert(
  !/writeFile|mkdirSync|cpSync|rmSync|copyFile/.test(moduleSource),
  "the skills module contains no write path",
);

assert(TAWASSUL_TOOL_NAMES.length === TOOL_COUNT, "the tool count still matches the tripwire");
assert(
  toolNameSetHash(TAWASSUL_TOOL_NAMES) === TOOL_NAME_SET_HASH,
  "the 44-tool name set is unchanged by skill registration",
);
assert(PILOT_SKILLS.length === 3, "the pilot ships exactly three skills");

console.log(`PROOF PASS: skill and command registration is isolated and leaves the tool surface untouched (${passed} assertions)`);
