import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type Manifest = {
  documents: string[];
  rootFiles: string[];
  prefixes: string[];
  internal: string[];
};

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST = JSON.parse(
  readFileSync(join(REPO, "scripts", "release", "public-files.json"), "utf8"),
) as Manifest;
const IGNORED = new Set(["node_modules", "dist", ".git", ".opencode", "coverage"]);
const args = process.argv.slice(2);
const treeIndex = args.indexOf("--tree");
const listOnly = args.includes("--list");
const requestedTree = treeIndex >= 0 ? resolve(REPO, args[treeIndex + 1] ?? "") : "";
const HAS_GIT = existsSync(join(REPO, ".git"));
const TARGET = requestedTree || (HAS_GIT ? "" : REPO);
const TRACKED = HAS_GIT ? gitFiles() : [];
const PUBLIC = new Set([...MANIFEST.documents, ...MANIFEST.rootFiles]);
const prefixSource = HAS_GIT ? TRACKED : TARGET && existsSync(TARGET) ? walk(TARGET) : [];
for (const prefix of MANIFEST.prefixes) {
  for (const file of prefixSource) if (file.startsWith(prefix)) PUBLIC.add(file);
}

function gitFiles(): string[] {
  const list = (args: string[]): string[] =>
    execFileSync("git", [...args, "-z"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter((file) => file.length > 0);
  const tracked = list(["ls-files"]);
  const fresh = list(["ls-files", "--others", "--exclude-standard"]).filter((file) =>
    MANIFEST.prefixes.some((prefix) => file.startsWith(prefix)),
  );
  return [...new Set([...tracked, ...fresh])].filter((file) => existsSync(join(REPO, file)));
}

function walk(root: string, base = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path, base));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(relative(base, path).split(sep).join("/"));
    }
  }
  return files;
}

const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;
const HOME = /(?:[A-Za-z]:)?[\\/](?:home|Users)[\\/]([A-Za-z0-9][A-Za-z0-9._-]*)[\\/]/gi;
const HOME_ALLOWED = new Set(["user", "example", "runner"]);
const RETIRED = ["tawas" + "syl", "gt" + "ttt", "pa" + "ssss"];
const NAMES = new RegExp(`\\b(?:${RETIRED.join("|")})\\b`, "i");
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9]{24,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

const findings: string[] = [];
function fail(file: string, message: string): void {
  findings.push(`${file}: ${message}`);
}

function isBinary(bytes: Buffer): boolean {
  const end = Math.min(bytes.length, 8192);
  for (let index = 0; index < end; index += 1) if (bytes[index] === 0) return true;
  return false;
}

function scan(files: string[], root: string): void {
  for (const file of files) {
    const absolute = join(root, file);
    if (!existsSync(absolute)) {
      if (PUBLIC.has(file)) fail(file, "manifest lists a file that does not exist");
      continue;
    }
    const bytes = readFileSync(absolute);
    if (isBinary(bytes)) continue;
    const text = bytes.toString("utf8");
    if (HIDDEN.test(text)) fail(file, "contains a hidden Unicode or bidi control character");
    if (NAMES.test(text)) fail(file, "names a retired project");
    for (const match of text.matchAll(HOME)) {
      const user = match[1] ?? "";
      if (!HOME_ALLOWED.has(user)) fail(file, `contains an absolute home path for ${user}`);
    }
    for (const pattern of SECRETS) {
      if (pattern.test(text)) fail(file, `matches a secret pattern ${pattern.source}`);
    }
  }
}

if (treeIndex >= 0 && (!requestedTree || requestedTree === REPO)) {
  console.error("check-public-tree: --tree needs a directory other than the repository root");
  process.exit(2);
}

if (listOnly) {
  for (const file of [...PUBLIC].sort()) console.log(file);
  process.exit(0);
}

const tracked = TRACKED;
const internal = new Set(MANIFEST.internal);
const overlap = [...PUBLIC].filter((file) => internal.has(file));
if (overlap.length > 0) fail("public-files.json", `files are both public and internal: ${overlap.join(", ")}`);

const unclassified = HAS_GIT
  ? tracked.filter((file) => !PUBLIC.has(file) && !internal.has(file))
  : [];
if (HAS_GIT) {
  for (const file of MANIFEST.internal) {
    if (!tracked.includes(file)) fail(file, "internal file is not tracked; remove it from the list");
  }
  for (const file of unclassified) {
    fail(file, "is neither public nor declared internal; decide in scripts/release/public-files.json");
  }
}

for (const file of MANIFEST.documents) {
  if (!existsSync(join(REPO, file))) fail(file, "document is missing");
}

if (TARGET) {
  if (!existsSync(TARGET)) {
    console.error(`check-public-tree: no tree at ${TARGET}`);
    process.exit(2);
  }
  const present = walk(TARGET).sort();
  const expected = [...PUBLIC].sort();
  for (const file of expected) if (!present.includes(file)) fail(file, "public file is missing from the tree");
  for (const file of present) if (!PUBLIC.has(file)) fail(file, "file is not in the public manifest");
  scan(present, TARGET);
  if (findings.length > 0) {
    console.error(`check-public-tree: ${findings.length} problem(s) in ${TARGET}`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }
  const total = present.reduce(
    (digest, file) => digest.update(createHash("sha256").update(readFileSync(join(TARGET, file))).digest("hex")),
    createHash("sha256"),
  );
  console.log(
    `check-public-tree: OK (${present.length} files in ${TARGET}, tree ${total.digest("hex").slice(0, 12)})`,
  );
  process.exit(0);
}

scan([...PUBLIC].filter((file) => tracked.includes(file)), REPO);

if (findings.length > 0) {
  console.error(`check-public-tree: ${findings.length} problem(s)`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `check-public-tree: OK (${PUBLIC.size} public files, ${MANIFEST.internal.length} declared internal, ` +
    `${unclassified.length} unclassified)`,
);
