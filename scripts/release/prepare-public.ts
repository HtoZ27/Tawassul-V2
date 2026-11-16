import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type Manifest = {
  documents: string[];
  rootFiles: string[];
  prefixes: string[];
  internal: string[];
};

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MANIFEST = JSON.parse(
  readFileSync(join(REPO, "scripts", "release", "public-files.json"), "utf8"),
) as Manifest;

function gitFiles(): string[] {
  const list = (args: string[]): string[] =>
    execFileSync("git", [...args, "-z"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter((file) => file.length > 0);
  const tracked = list(["ls-files"]);
  const fresh = list(["ls-files", "--others", "--exclude-standard"]).filter((file) =>
    MANIFEST.prefixes.some((prefix) => file.startsWith(prefix)),
  );
  return [...new Set([...tracked, ...fresh])].filter((file) => existsSync(join(REPO, file)));
}

function publicFiles(): string[] {
  const files = new Set([...MANIFEST.documents, ...MANIFEST.rootFiles]);
  for (const file of gitFiles()) {
    if (MANIFEST.prefixes.some((prefix) => file.startsWith(prefix))) files.add(file);
  }
  return [...files].sort();
}

function walk(root: string, base = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, base));
    else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(relative(base, path).split(sep).join("/"));
    }
  }
  return files;
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function insideRepo(path: string): boolean {
  const rel = relative(REPO, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.log("usage: bun scripts/release/prepare-public.ts <target-directory>");
  console.log("");
  console.log("Copies the allow-listed public files from scripts/release/public-files.json");
  console.log("into <target-directory>. The target must be outside this repository and");
  console.log("must be empty or contain only public files. Nothing is ever deleted.");
  process.exit(args.length === 0 ? 2 : 0);
}

const target = resolve(REPO, args[0] ?? "");
if (insideRepo(target)) {
  console.error("prepare-public: the target must be outside the repository");
  process.exit(2);
}

console.log("prepare-public: checking the public manifest");
try {
  execFileSync(process.execPath, [join(REPO, "scripts", "check-public-tree.ts")], {
    cwd: REPO,
    stdio: "inherit",
  });
} catch {
  console.error("prepare-public: the public-tree check failed; nothing was copied");
  process.exit(1);
}

const files = publicFiles();
const internal = new Set(MANIFEST.internal);
const overlap = files.filter((file) => internal.has(file));
if (overlap.length > 0) {
  console.error(`prepare-public: public and internal lists overlap: ${overlap.join(", ")}`);
  process.exit(1);
}

if (existsSync(target)) {
  if (!statSync(target).isDirectory()) {
    console.error(`prepare-public: ${target} is not a directory`);
    process.exit(2);
  }
  const present = walk(target);
  const extra = present.filter((file) => !files.includes(file));
  if (extra.length > 0) {
    console.error(`prepare-public: ${target} holds ${extra.length} file(s) outside the manifest:`);
    for (const file of extra.slice(0, 10)) console.error(`  - ${file}`);
    if (extra.length > 10) console.error(`  - and ${extra.length - 10} more`);
    console.error("prepare-public: remove them and rerun; this script never deletes files");
    process.exit(1);
  }
}

let bytes = 0;
for (const file of files) {
  const source = join(REPO, file);
  const destination = join(target, file);
  const data = readFileSync(source);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, data);
  chmodSync(destination, statSync(source).mode & 0o777);
  if (digest(destination) !== digest(source)) {
    console.error(`prepare-public: ${file} changed while it was copied`);
    process.exit(1);
  }
  bytes += data.length;
}

console.log(
  `prepare-public: OK (${files.length} files, ${(bytes / (1024 * 1024)).toFixed(1)} MiB, ` +
    `${MANIFEST.internal.length} internal files excluded)`,
);
console.log(`prepare-public: wrote ${target}`);
console.log(`prepare-public: next: cd ${target} && npm ci && npm run verify`);
