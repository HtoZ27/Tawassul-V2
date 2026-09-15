import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const V1 = resolve("/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul");
const V2 = resolve(fileURLToPath(import.meta.url), "..", "..");
const ARABIC_RE = /\p{Script=Arabic}/u;
const CONFLICT_RE = /^(<{7}|={7}|>{7})/m;
const SKIP_DIRS = new Set(["node_modules", "dist", "tests", "coverage", "data", "docs", "releases", "assets"]);
const SKIP_FILES = /\.(test|d)\.ts$|permissions\.ts|security-policy\.ts|context-class\.ts|context\.ts|index\.ts|plugin\.ts|plugin-types\.ts|cli-entry\.ts|training-evaluator\.ts|agent-templates\.ts|validation\.ts|tool\.ts|tool-names\.ts|translations\.ts$/;

function stripComments(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const drop = [];
  function mark(start, end) {
    const ranges = (ts.getLeadingCommentRanges(source, start) ?? []).concat(
      ts.getTrailingCommentRanges(source, end) ?? [],
    );
    for (const r of ranges) drop.push([r.pos, r.end]);
  }
  function visit(node) {
    mark(node.getFullStart(), node.getEnd());
    ts.forEachChild(node, visit);
  }
  for (const stmt of sf.statements) {
    mark(stmt.getFullStart(), stmt.getEnd());
    ts.forEachChild(stmt, visit);
  }
  drop.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [s, e] of drop) {
    if (s >= pos) out += source.slice(pos, s);
    pos = Math.max(pos, e);
  }
  out += source.slice(pos);
  return out;
}

function findArabic(source) {
  const out = [];
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(n) {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isRegularExpressionLiteral(n) ||
      ts.isJsxText(n)
    ) {
      if (ARABIC_RE.test(n.text)) out.push(n.text.slice(0, 60));
    }
    ts.forEachChild(n, visit);
  }
  for (const stmt of sf.statements) visit(stmt);
  return out;
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = resolve(dir, e);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(e)) out.push(...walk(full));
    } else if (/\.ts$/.test(e) && !SKIP_FILES.test(e)) {
      out.push(full);
    }
  }
  return out;
}

const dryRun = process.argv.includes("--dry-run");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const targets = (only.length > 0 ? only : walk(V1))
  .map((p) => (p.startsWith("/") ? p : resolve(V1, p)))
  .filter((p) => p.startsWith(V1));

let stripped = 0;
for (const file of targets) {
  const rel = relative(V1, file);
  const source = readFileSync(file, "utf8");
  if (CONFLICT_RE.test(source)) {
    console.error(`SKIP ${rel}: unresolved conflict markers`);
    continue;
  }
  const arabic = findArabic(source);
  if (arabic.length > 0) {
    console.error(`SKIP ${rel}: Arabic literals ${JSON.stringify(arabic)}`);
    continue;
  }
  const clean = stripComments(source, file);
  if (dryRun) {
    console.log(`OK ${rel} (${source.length} -> ${clean.length})`);
    stripped++;
    continue;
  }
  const dest = resolve(V2, "src", rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, clean.endsWith("\n") ? clean : clean + "\n");
  stripped++;
}
console.log(`\n${dryRun ? "dry-run" : "ported"}: ${stripped}/${targets.length} files, ${targets.length - stripped} skipped`);