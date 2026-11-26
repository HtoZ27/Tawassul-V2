import "./proof-log-isolate.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMarkdown, checkShippedMarkdown } from "./check-v2-rules.mjs";

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

const arabic = String.fromCodePoint(0x0646, 0x0639, 0x0645);
const path = "skills/example/SKILL.md";

function accepts(source: string, what: string): void {
  const errors = checkMarkdown(path, source);
  assert(errors.length === 0, `the markdown branch accepts ${what}: ${errors.join("; ")}`);
}

function rejects(source: string, what: string): void {
  const errors = checkMarkdown(path, source);
  assert(errors.length > 0, `the markdown branch rejects ${what}`);
}

accepts("# Review\n\n1. Open the board with `goal(board: true)`.\n", "a plain English procedure");
accepts(
  "# Review\n\n```html\n<!-- example only -->\n```\n",
  "an HTML comment inside a fenced block",
);
accepts(
  "# Review\n\n~~~\n<!-- example only -->\n~~~\n",
  "an HTML comment inside a tilde fence",
);
rejects(`# Review\n\n${arabic}\n`, "an Arabic literal in raw text");
rejects(
  `# Review\n\n\`\`\`\n${arabic}\n\`\`\`\n`,
  "an Arabic literal inside a fenced block",
);
rejects("# Review\n\n<!-- hidden note -->\n", "an HTML comment outside a fence");
rejects(
  "# Review\n\n```md\n<!-- fenced -->\n```\n\n<!-- outside -->\n",
  "an HTML comment after a closed fence",
);

const work = mkdtempSync(join(tmpdir(), "tawassul-md-gate-"));
try {
  mkdirSync(join(work, "skills", "ok"), { recursive: true });
  writeFileSync(join(work, "skills", "ok", "SKILL.md"), "# ok\n");
  mkdirSync(join(work, "skills", "bad"), { recursive: true });
  writeFileSync(join(work, "skills", "bad", "SKILL.md"), `# bad\n\n${arabic}\n`);
  writeFileSync(join(work, "outside.md"), `# outside\n\n${arabic}\n`);
  mkdirSync(join(work, "docs"), { recursive: true });
  writeFileSync(join(work, "docs", "SHARED.md"), `# frozen\n\n${arabic}\n`);
  process.env.TAWASSUL_RULES_ROOT = work;
  const scoped = checkShippedMarkdown();
  assert(scoped.files === 2, `the branch scans only skills/** markdown (${scoped.files} files)`);
  assert(scoped.errors.length === 1, "the branch reports exactly one shipped violation");
  assert(
    scoped.errors[0]!.includes("skills/bad/SKILL.md"),
    "the branch reports the shipped file that carries Arabic",
  );
  assert(
    !scoped.errors.some((error) => error.includes("outside.md")),
    "a markdown file outside skills/** stays outside the branch",
  );
  assert(
    !scoped.errors.some((error) => error.includes("SHARED.md")),
    "a frozen document stays outside the branch",
  );
} finally {
  delete process.env.TAWASSUL_RULES_ROOT;
  rmSync(work, { recursive: true, force: true });
}

const real = checkShippedMarkdown();
assert(real.files === 16, `the repository ships sixteen skill bodies (${real.files})`);
assert(real.errors.length === 0, "every shipped skill body passes the markdown branch");
assert(
  real.files === 16 && !real.errors.some((error) => error.includes("SHARED.md")),
  "the repository scan never reaches a frozen document",
);

console.log(`PROOF PASS: the markdown branch is English-only, comment-free, fence-aware and scoped to skills/** (${passed} assertions)`);
