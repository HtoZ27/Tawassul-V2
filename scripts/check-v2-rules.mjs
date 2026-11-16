import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SCAN_DIRS = ["src", "scripts", "tests"];
const SINGLE_FILES = ["build-v2.mjs", "check-v2-rules.mjs"];
const ARABIC_RE = /\p{Script=Arabic}/u;
const TRANSLATION_TABLE_RE = /^src\/i18n\/([a-z]{2}(?:-[A-Za-z]{2,4})?)\.json$/;

function isTranslationTable(relPath) {
  const match = TRANSLATION_TABLE_RE.exec(relPath.split("\\").join("/"));
  return match !== null && match[1] !== "en";
}
const ALLOWED_COMMENT_PATTERNS = [
  /^@ts-expect-error(?:\s|:|--|$)/,
  /^@ts-ignore(?:\s|:|--|$)/,
  /^eslint-disable(?:-next-line)?(?:\s|$)/,
  /^eslint-enable(?:\s|$)/,
  /^@truth provider:\s+\S/,
];

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.(ts|mts|mjs|json)$/.test(entry)) {
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
  if (stripped.length === 0) return false;
  return ALLOWED_COMMENT_PATTERNS.some((re) => re.test(stripped));
}

function stripFences(source) {
  const out = [];
  let fenced = false;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push("");
      continue;
    }
    out.push(fenced ? "" : line);
  }
  return out.join("\n");
}

export function checkMarkdown(relPath, source) {
  const errors = [];
  const arabic = ARABIC_RE.exec(source);
  if (arabic) {
    const line = source.slice(0, arabic.index).split("\n").length;
    errors.push(`${relPath}:${line}: non-English literal in shipped markdown`);
  }
  const unfenced = stripFences(source);
  const commentRe = /<!--[\s\S]*?-->/g;
  for (const match of unfenced.matchAll(commentRe)) {
    const line = unfenced.slice(0, match.index).split("\n").length;
    errors.push(`${relPath}:${line}: comment present but comments are forbidden in shipped markdown`);
  }
  return errors;
}

function listMarkdown(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listMarkdown(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

export function checkShippedMarkdown() {
  const root = process.env.TAWASSUL_RULES_ROOT
    ? resolve(process.env.TAWASSUL_RULES_ROOT, "skills")
    : join(ROOT, "skills");
  const files = listMarkdown(root);
  const errors = [];
  for (const file of files) {
    const relPath = `skills/${relative(root, file).split("\\").join("/")}`;
    errors.push(...checkMarkdown(relPath, readFileSync(file, "utf8")));
  }
  return { files: files.length, errors };
}

function checkFile(file) {
  const relPath = relative(ROOT, file).split("\\").join("/");
  return checkSource(relPath, readFileSync(file, "utf8"));
}

export function checkSource(relPath, source) {
  const file = relPath;
  const errors = [];
  if (extname(file) === ".json") {
    if (!isTranslationTable(file) && ARABIC_RE.test(source)) {
      errors.push(`${file}:1: non-English literal in JSON`);
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
        errors.push(`${file}:${line}: comment present but comments are forbidden in v2`);
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
    if (text !== null && ARABIC_RE.test(text)) {
      const line = source.slice(0, node.getStart(sf)).split("\n").length;
      errors.push(`${file}:${line}: non-English literal (${JSON.stringify(text.slice(0, 40))})`);
      return;
    }
    ts.forEachChild(node, visit);
  }
  for (const stmt of sf.statements) {
    visit(stmt);
  }
  return errors;
}

export function checkAll() {
  const files = collectFiles();
  const allErrors = [];
  for (const file of files) {
    allErrors.push(...checkFile(file));
  }
  const markdown = checkShippedMarkdown();
  allErrors.push(...markdown.errors);
  return { files: files.length + markdown.files, errors: allErrors };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { files, errors } = checkAll();
  if (errors.length > 0) {
    console.error("v2 rules violations:");
    for (const err of errors) console.error("  - " + err);
    process.exit(1);
  }
  console.log(`v2 rules OK (${files} files, English-only + no-comments)`);
}
