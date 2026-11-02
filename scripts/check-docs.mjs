import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

const PUBLIC_FILES = [
  "README.md",
  "LICENSE",
  "NOTICE.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "ACKNOWLEDGEMENTS.md",
  "docs/README.md",
  "docs/installation.md",
  "docs/upgrade.md",
  "docs/compatibility.md",
  "docs/user-guide.md",
  "docs/configuration.md",
  "docs/agents.md",
  "docs/tools.md",
  "docs/commands.md",
  "docs/skills.md",
  "docs/permissions.md",
  "docs/state.md",
  "docs/architecture.md",
  "docs/database.md",
  "docs/monitoring.md",
  "docs/security-model.md",
  "docs/troubleshooting.md",
  "docs/known-issues.md",
  "docs/limitations.md",
  "docs/faq.md",
  "docs/glossary.md",
];

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
  "oh-my-opencode",
  "superpowers",
  "power-pack",
  "opencode-mem",
  "opencode-senses",
  "opencode-cursor",
  "morph-fast-apply",
  "orchestration-kit",
  "composio",
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
  }
}

if (findings.length > 0) {
  console.error(`check-docs: ${findings.length} problem(s)`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`check-docs: OK (${PUBLIC_FILES.length} public files)`);
