import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SCAN_DIRS = ["src", "scripts", "tests"];
const SINGLE_FILES = ["build-v2.mjs", "check-v2-rules.mjs", "check-shared-anchors.mjs"];
const ARABIC_RE = /\p{Script=Arabic}/u;
const ALLOWED_COMMENT_PREFIXES = [
  "@ts-expect-error",
  "@ts-ignore",
  "eslint-disable",
  "eslint-enable",
  "@eslint-disable",
  "@eslint-enable",
  "#__PURE__",
];

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.(ts|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) files.push(...listFiles(join(ROOT, d)));
  for (const f of SINGLE_FILES) {
    const full = join(ROOT, f);
    if (existsSync(full)) files.push(full);
  }
  return files;
}

function isEnglishOnly(text) {
  return !ARABIC_RE.test(text);
}

function stripComment(text) {
  return text
    .replace(/^\/\*+/, "")
    .replace(/\*\/$/, "")
    .replace(/^\/\//, "")
    .replace(/\r/g, "")
    .replace(/^[\s*]+/, "")
    .replace(/[\s*]+$/, "");
}

function isAllowedComment(text) {
  const stripped = stripComment(text);
  if (stripped.length === 0) return true;
  return ALLOWED_COMMENT_PREFIXES.some((p) => stripped.startsWith(p));
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  const scriptKind = extname(file) === ".mjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const errors = [];
  const seenComments = new Set();

  function recordComments(text) {
    const ranges = ts.getLeadingCommentRanges(text, 0) ?? [];
    for (const range of ranges) {
      const key = `${range.pos}:${range.end}`;
      if (seenComments.has(key)) continue;
      seenComments.add(key);
      if (!isAllowedComment(text.slice(range.pos, range.end))) {
        const line = source.slice(0, range.pos).split("\n").length;
        errors.push(`${relative(ROOT, file)}:${line}: comment present but comments are forbidden in v2`);
      }
    }
  }

  recordComments(source);
  for (const stmt of sf.statements) {
    recordComments(source.slice(stmt.getFullStart(), stmt.getEnd()));
  }

  function visit(node) {
    const isString = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node);
    if (isString) {
      const text = node.text;
      if (!isEnglishOnly(text)) {
        const line = source.slice(0, node.getStart(sf)).split("\n").length;
        errors.push(`${relative(ROOT, file)}:${line}: non-English literal (${JSON.stringify(text.slice(0, 40))})`);
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  for (const stmt of sf.statements) {
    visit(stmt);
  }
  return errors;
}

const files = collectFiles();
const allErrors = [];
for (const file of files) {
  allErrors.push(...checkFile(file));
}

if (allErrors.length > 0) {
  console.error("v2 rules violations:");
  for (const err of allErrors) console.error("  - " + err);
  process.exit(1);
}
console.log(`v2 rules OK (${files.length} files, English-only + no-comments)`);