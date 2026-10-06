import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SCAN_DIRS = ["src", "scripts", "tests"];
const SINGLE_FILES = ["build-v2.mjs", "check-v2-rules.mjs", "check-shared-anchors.mjs"];
const ARABIC_RE = /\p{Script=Arabic}/u;
const ARABIC_ALLOWLIST = [
  "الجميع",
  "الوكلاء",
  "الوكيل",
  "الكل",
  "بنموذج",
  "احذفوا",
  "استكشف",
  "توزيع",
  "تقسيم",
  "حوّل",
  "خطّط",
  "راجع",
  "سلِّم",
  "سلّم",
  "شغّل",
  "طبّق",
  "أحذف",
  "أرسل",
  "أوزع",
  "إرسال",
  "احذف",
  "احسم",
  "اشرح",
  "اقترح",
  "تاوا",
  "حقّق",
  "حلّل",
  "فوض",
  "فوّض",
  "قيّم",
  "كلف",
  "مهام",
  "ناقش",
  "نفّذ",
  "وزّع",
  "وضّح",
  "وفبلس",
  "وكلاء",
  "أضف",
  "اضف",
  "فعّل",
  "كِل",
  "نعم",
  "هل",
  "وزع",
  "كل",
  "لا",
  "من",
  "يا",
].sort((a, b) => b.length - a.length);
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
    } else if (/\.(ts|mjs|json)$/.test(entry) && !entry.endsWith(".d.ts")) {
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

function withoutAllowedSnippets(text) {
  let out = text;
  for (const s of ARABIC_ALLOWLIST) out = out.split(s).join("");
  return out;
}

function hasForbiddenArabic(text) {
  return ARABIC_RE.test(withoutAllowedSnippets(text));
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
  if (/^#!/.test(text)) return true;
  const stripped = stripComment(text);
  if (stripped.length === 0) return true;
  return ALLOWED_COMMENT_PREFIXES.some((p) => stripped.startsWith(p));
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  const errors = [];
  if (extname(file) === ".json") {
    if (hasForbiddenArabic(source)) {
      errors.push(`${relative(ROOT, file)}:1: non-English literal in JSON`);
    }
    return errors;
  }
  const scriptKind = extname(file) === ".mjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const seenComments = new Set();

  const blanks = [];
  function blankWalk(node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isJsxText(node)
    ) {
      blanks.push([node.getStart(sf), node.getEnd()]);
      return;
    }
    ts.forEachChild(node, blankWalk);
  }
  for (const stmt of sf.statements) {
    blankWalk(stmt);
  }
  const chars = source.split("");
  for (const [start, end] of blanks) {
    for (let i = start; i < end; i++) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  }
  const code = chars.join("");
  const commentRe = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
  let match = commentRe.exec(code);
  while (match !== null) {
    const key = `${match.index}:${match.index + match[0].length}`;
    if (!seenComments.has(key)) {
      seenComments.add(key);
      if (!isAllowedComment(source.slice(match.index, match.index + match[0].length))) {
        const line = source.slice(0, match.index).split("\n").length;
        errors.push(`${relative(ROOT, file)}:${line}: comment present but comments are forbidden in v2`);
      }
    }
    match = commentRe.exec(code);
  }

  function visit(node) {
    let text = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    } else if (ts.isRegularExpressionLiteral(node)) {
      text = node.text;
    }
    if (text !== null && hasForbiddenArabic(text)) {
      const line = source.slice(0, node.getStart(sf)).split("\n").length;
      errors.push(`${relative(ROOT, file)}:${line}: non-English literal (${JSON.stringify(text.slice(0, 40))})`);
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
