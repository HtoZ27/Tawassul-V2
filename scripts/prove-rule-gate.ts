import { checkSource } from "./check-v2-rules.mjs";

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`PROOF FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}

const ar = (n: number): string => String.fromCodePoint(n);
const yes = String.fromCodePoint(0x0646, 0x0639, 0x0645);
const no = ar(0x0644) + ar(0x0627);
const particleNo = ar(0x0644) + ar(0x0627);
const particleAll = ar(0x0643) + ar(0x0644);
const particleFrom = ar(0x0645) + ar(0x0646);
const particleYa = ar(0x064a) + ar(0x0627);
const particleQ = ar(0x0647) + ar(0x0644);

function rejects(relPath: string, source: string, what: string): void {
  const errs = checkSource(relPath, source);
  assert(errs.length > 0, `gate must reject ${what} (${relPath})`);
}

function accepts(relPath: string, source: string, what: string): void {
  const errs = checkSource(relPath, source);
  assert(errs.length === 0, `gate must accept ${what} (${relPath}): ${errs.join("; ")}`);
}

accepts("src/services/example.ts", "export const a = 1;\n", "plain English source");
accepts("src/services/example.ts", "// @ts-expect-error\nconst a = 1;\n", "@ts-expect-error directive");
accepts("src/services/example.ts", "// @ts-ignore\nconst a = 1;\n", "@ts-ignore directive");
accepts("src/services/example.ts", "/* eslint-disable no-console */\nconsole.log(1);\n", "eslint-disable directive");
accepts("src/services/example.ts", "/* eslint-enable no-console */\nconsole.log(1);\n", "eslint-enable directive");
accepts("src/services/example.ts", "// eslint-disable-next-line no-console\nconsole.log(1);\n", "eslint-disable-next-line directive");
accepts("src/services/example.ts", "const u = \"https://example.com//path\";\n", "double slash inside a string literal");
accepts("src/services/example.ts", "const r = /a\\/\\/b/g;\n", "escaped slashes inside a regex literal");

rejects("src/services/example.ts", "// an explanatory comment\nconst a = 1;\n", "a plain comment");
rejects("src/services/example.ts", "/* a block comment */\nconst a = 1;\n", "a block comment");
rejects("src/services/example.ts", "/** jsdoc block */\nexport const a = 1;\n", "a JSDoc comment");
rejects("src/services/example.ts", "/**/\nconst a = 1;\n", "an empty comment");
rejects("src/services/example.ts", "/***/\nconst a = 1;\n", "a star-only comment");
rejects("src/services/example.ts", "// @ts-ignore-everything\nconst a = 1;\n", "a directive-prefix lookalike");
accepts(
  "src/services/example.ts",
  "// @ts-expect-error: legacy cast retained from the v1 port\nconst a: number = \"1\";\n",
  "a directive carrying a short reason",
);
rejects("src/services/example.ts", "// @ts-expect-error-everything\nconst a = 1;\n", "a glued directive lookalike");
rejects("src/services/example.ts", "// @ts-ignorer\nconst a = 1;\n", "a glued ts-ignore lookalike");
rejects("src/services/example.ts", "/*#__PURE__ write a poem about water */\nconst a = 1;\n", "a PURE annotation used as prose");
rejects("src/services/example.ts", "/* eslint-disabled */\nconst a = 1;\n", "an eslint lookalike");
rejects("src/services/example.ts", `const s = "${yes}";\n`, "an Arabic literal outside the exempt files");
rejects("src/services/example.ts", `const s = "${no}";\n`, "an Arabic denial literal outside the exempt files");
rejects("scripts/helper.ts", `const s = "${yes}";\n`, "an Arabic literal in a script");
rejects("src/data/strings.json", `{"k": "${yes}"}\n`, "an Arabic literal in JSON");
rejects("src/services/example.d.ts", `export declare const s: string; // ${yes}\nexport declare const t: string;\n`, "an Arabic literal in a declaration file");
rejects(
  "src/services/example.ts",
  `const s = "${[particleQ, particleYa, particleFrom, particleNo, particleAll].join(" ")}";\n`,
  "Arabic assembled only from formerly allow-listed particles",
);

accepts("src/services/ask-channel-parse.ts", `const s = "${yes}";\n`, "an Arabic literal in a path-exempt matcher");
accepts("src/hooks/guards/consent-gate-guard.ts", `const s = "${yes}";\n`, "an Arabic literal in a path-exempt guard");
accepts("src/i18n/en.json", `{"k": "${yes}"}\n`, "an Arabic literal in a path-exempt locale file");

const identifiersPass = checkSource("src/services/example.ts", `const ${ar(0x0633) + ar(0x0624) + ar(0x0627)} = 1;\n`);
assert(identifiersPass.length === 0, "known limitation: non-literal identifiers are not Arabic-checked");

console.log(`PROOF PASS: rule gate (${passed} assertions)`);