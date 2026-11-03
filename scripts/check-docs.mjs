import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const PUBLIC_FILES = JSON.parse(
  readFileSync(new URL("./release/public-files.json", import.meta.url), "utf8"),
).documents;

const DOCS_ENV = JSON.parse(readFileSync(new URL("./docs-env.json", import.meta.url), "utf8"));
const PUBLIC_ENV = new Set(DOCS_ENV.public);
const INTERNAL_ENV = new Set(DOCS_ENV.internal);

const INTERNAL_DOCS = [
  "AGENTS.md",
  "CUTOVER.md",
  "DECOUPLING.md",
  "RECOVERY-20261025.md",
  "REMAINING-WORK.md",
  "SHARED.md",
  "RULES.md",
  "ISSUES.md",
  "PLAN.md",
  "STABILITY.md",
  "TRIAGE.md",
  "UPSTREAM.md",
  "FUTURE-WORK-PLAN.md",
  "RELEASE-0.1.0-PLAN.md",
  "CI-TRANSCRIPT.md",
  "continuity-brief-v1.md",
];

const FOREIGN_PROJECTS = [
  ["oh-my-", "opencode"].join(""),
  ["super", "powers"].join(""),
  ["power-", "pack"].join(""),
  ["opencode-", "mem"].join(""),
  ["opencode-", "senses"].join(""),
  ["opencode-", "cursor"].join(""),
  ["morph-", "fast-apply"].join(""),
  ["orchestration-", "kit"].join(""),
  ["com", "posio"].join(""),
];

const ARABIC = /[\u0600-\u06FF]/;
const ABSOLUTE_HOME = /\/(home|Users)\/[A-Za-z0-9._-]+\//;
const ALLOWED_EXEMPTIONS = new Set(["ACKNOWLEDGEMENTS.md"]);

const findings = [];

function fail(file, message) {
  findings.push(`${file}: ${message}`);
}

function normalize(path) {
  return path.split(sep).join("/");
}

function headingSlug(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
}

for (const file of PUBLIC_FILES) {
  const absolute = resolve(repo, file);
  if (!existsSync(absolute)) {
    fail(file, "public file does not exist");
    continue;
  }
  if (!statSync(absolute).isFile()) {
    fail(file, "public entry is not a file");
    continue;
  }
  if (!file.endsWith(".md")) continue;

  const text = readFileSync(absolute, "utf8");

  if (ARABIC.test(text)) fail(file, "contains Arabic characters");

  if (ABSOLUTE_HOME.test(text)) fail(file, "contains an absolute home directory");

  if (!ALLOWED_EXEMPTIONS.has(file)) {
    const lower = text.toLowerCase();
    for (const project of FOREIGN_PROJECTS) {
      if (lower.includes(project)) fail(file, `names another project (${project})`);
    }
    for (const internal of INTERNAL_DOCS) {
      if (text.includes(internal)) fail(file, `references an internal document (${internal})`);
    }
  }

  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (!target || target.startsWith("#")) continue;
    if (/^(https?:|mailto:|tel:)/.test(target)) continue;
    const withoutAnchor = target.split("#")[0].split("?")[0];
    if (!withoutAnchor) continue;
    const resolved = withoutAnchor.startsWith("/")
      ? resolve(repo, withoutAnchor.slice(1))
      : resolve(dirname(absolute), withoutAnchor);
    const rel = normalize(relative(repo, resolved));
    if (rel.startsWith("../") || isAbsolute(rel)) {
      fail(file, `link escapes the repository (${target})`);
      continue;
    }
    if (!existsSync(resolved)) {
      fail(file, `broken link (${target})`);
      continue;
    }
    if (!PUBLIC_FILES.includes(rel)) {
      fail(file, `link targets a file outside the public allow-list (${target})`);
    }
    const anchor = target.includes("#") ? decodeURIComponent(target.split("#")[1] ?? "") : "";
    if (anchor && rel.endsWith(".md")) {
      const body = readFileSync(resolved, "utf8");
      const slugs = new Set(
        [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((heading) => headingSlug(heading[1])),
      );
      if (!slugs.has(anchor)) fail(file, `broken anchor (${target})`);
    }
  }
}

if (findings.length > 0) {
  console.error(`check-docs: ${findings.length} problem(s)`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

const toolNamesSource = readFileSync(resolve(repo, "src/tool-names.ts"), "utf8");
const toolNames = [...toolNamesSource.matchAll(/"([a-z][a-z_]+)"/g)].map((match) => match[1]);
const toolsDoc = readFileSync(resolve(repo, "docs/tools.md"), "utf8");
for (const tool of new Set(toolNames)) {
  if (!toolsDoc.includes(`\`${tool}\``)) fail("docs/tools.md", `missing the registered tool (${tool})`);
}

const agentSource = readFileSync(resolve(repo, "src/core/agent-data.ts"), "utf8");
const agents = [...agentSource.matchAll(/^\s{4}name: "([a-z-]+)",$/gm)].map((match) => match[1]);
const agentsDoc = readFileSync(resolve(repo, "docs/agents.md"), "utf8");
for (const agent of agents) {
  if (!agentsDoc.includes(`\`${agent}\``)) fail("docs/agents.md", `missing the shipped agent (${agent})`);
}

const skillsManifest = JSON.parse(readFileSync(resolve(repo, "skills/manifest.json"), "utf8"));
const skillsDoc = readFileSync(resolve(repo, "docs/skills.md"), "utf8");
for (const skill of skillsManifest.skills) {
  if (!skillsDoc.includes(`\`${skill.id}\``)) fail("docs/skills.md", `missing the shipped skill (${skill.id})`);
}

const ENV_TOKEN = /\b(?:TAWASSUL|OPENCODE)_[A-Z0-9_]+\b/g;

function collectTypeScript(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) collectTypeScript(entryPath, out);
    else if (entry.name.endsWith(".ts")) out.push(entryPath);
  }
  return out;
}

const envSources = [
  ...collectTypeScript(resolve(repo, "src")),
  resolve(repo, "scripts/install-global.ts"),
  resolve(repo, "scripts/doctor-v2.sh"),
  resolve(repo, "build-v2.mjs"),
  resolve(repo, "install.sh"),
];
const envSeen = new Set();
for (const file of envSources) {
  if (!existsSync(file)) {
    fail("scripts/docs-env.json", `source file is missing (${normalize(relative(repo, file))})`);
    continue;
  }
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(ENV_TOKEN)) envSeen.add(match[0]);
}

if (DOCS_ENV.public.length !== PUBLIC_ENV.size || DOCS_ENV.internal.length !== INTERNAL_ENV.size) {
  fail("scripts/docs-env.json", "lists a variable twice");
}
const bothScopes = [...PUBLIC_ENV].filter((name) => INTERNAL_ENV.has(name));
if (bothScopes.length > 0) {
  fail("scripts/docs-env.json", `lists a variable as public and internal (${bothScopes.join(", ")})`);
}

const configDoc = readFileSync(resolve(repo, "docs/configuration.md"), "utf8");
for (const name of PUBLIC_ENV) {
  if (!configDoc.includes(name)) fail("docs/configuration.md", `missing the public environment variable (${name})`);
}
for (const name of envSeen) {
  if (!PUBLIC_ENV.has(name) && !INTERNAL_ENV.has(name)) {
    fail("scripts/docs-env.json", `unclassified environment variable (${name})`);
  }
}
for (const name of [...PUBLIC_ENV, ...INTERNAL_ENV]) {
  if (!envSeen.has(name)) fail("scripts/docs-env.json", `stale environment variable (${name})`);
}

if (findings.length > 0) {
  console.error(`check-docs: ${findings.length} problem(s)`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `check-docs: OK (${PUBLIC_FILES.length} public files, ${new Set(toolNames).size} tools, ${agents.length} agents, ${skillsManifest.skills.length} skills, ${PUBLIC_ENV.size + INTERNAL_ENV.size} environment variables)`,
);
