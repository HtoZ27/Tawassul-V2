import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMessage, type RoutingResult } from "../src/services/routing-algorithm.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`ok ${message}`);
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

type Expectation = {
  text: string;
  role?: string | null;
  action?: RoutingResult["action"];
  size?: RoutingResult["size"];
  direct?: boolean;
  warn?: boolean;
  note: string;
};

const ROUTE: Expectation[] = [
  { text: "@dev fix the null pointer in main.ts", role: "dev", direct: true, action: "auto-record", note: "an explicit mention wins" },
  { text: "review this pull request for correctness", role: "reviewer", action: "auto-record", note: "review routes to the reviewer" },
  { text: "document the install steps", role: "doc", action: "auto-record", note: "document routes to doc" },
  { text: "design a landing page for the product", role: "designer", action: "auto-record", note: "design routes to designer" },
  { text: "analyze the tradeoffs of this approach", role: "analyst", action: "auto-record", note: "analyze routes to analyst" },
  { text: "refactor the auth module and add integration tests", role: "dev", note: "dev work routes to dev" },
  { text: "@tester run the suite again", role: "tester", direct: true, note: "a direct mention reaches a tester" },
  { text: "audit the login flow for xss", role: "reviewer", note: "a security keyword reaches the reviewer" },
];

const IGNORE: Expectation[] = [
  { text: "hi", note: "a greeting is not a task" },
  { text: "hello", note: "hello is not a task" },
  { text: "thanks", note: "thanks is not a task" },
  { text: "ok", note: "ok is not a task" },
  { text: "good morning", note: "a greeting is not a task" },
  { text: "how are you", note: "small talk is not a task" },
  { text: "sounds good", note: "agreement is not a task" },
  { text: "no problem", note: "acknowledgement is not a task" },
  { text: "go on", note: "continuation is not a task" },
  { text: "please continue", note: "continuation is not a task" },
  { text: "this is fine", note: "commentary is not a task" },
  { text: "maybe later", note: "deferral is not a task" },
  { text: "see you later", note: "a sign-off is not a task" },
  { text: "the main thing is the email", note: "a bare word must not match a short keyword" },
  { text: "said nothing", note: "a short keyword inside a word is not a match" },
  { text: "let us meet tomorrow", note: "a two letter keyword must not fuzzy match a pronoun" },
  { text: "carry on", note: "a curated typo must not match inside a longer word" },
  { text: "I will be there soon", note: "plain prose is not a task" },
  { text: "what time is it", note: "a question about the time is not a task" },
  { text: "the weather is nice today", note: "plain prose is not a task" },
  { text: "I like this", note: "an opinion is not a task" },
];

const SIZE: Expectation[] = [
  { text: "complete the full system integration", size: "complex", note: "a completion across a system is complex" },
  { text: "fix the typo", size: "small", note: "a one line fix is small" },
  { text: "review all of the modules for consistency across every package", size: "complex", note: "a plural all of request is complex" },
  { text: "address the config file", size: "small", note: "add inside address never votes" },
  { text: "the awful output is fine", size: "small", note: "full inside awful never votes" },
  { text: "add a config file", size: "medium", note: "the whole keyword still votes" },
];

const SAFETY: Expectation[] = [
  { text: "my password is hunter2, store it in the config", warn: true, action: "none", note: "a secret is warned about and not routed" },
];

function evaluate(expectation: Expectation): string | null {
  const result = analyzeMessage(expectation.text);
  if (expectation.role !== undefined && result.role !== expectation.role) {
    return `role ${String(result.role)} != ${String(expectation.role)}`;
  }
  if (expectation.action !== undefined && result.action !== expectation.action) {
    return `action ${result.action} != ${expectation.action}`;
  }
  if (expectation.size !== undefined && result.size !== expectation.size) {
    return `size ${String(result.size)} != ${expectation.size}`;
  }
  if (expectation.direct !== undefined && result.isDirectRouting !== expectation.direct) {
    return `direct ${result.isDirectRouting} != ${expectation.direct}`;
  }
  if (expectation.warn !== undefined && result.warnings.length > 0 !== expectation.warn) {
    return `warning ${result.warnings.length > 0} != ${expectation.warn}`;
  }
  return null;
}

function runGroup(name: string, group: Expectation[], extra?: (result: RoutingResult) => string | null): void {
  const failures: string[] = [];
  for (const expectation of group) {
    const result = analyzeMessage(expectation.text);
    const problem = evaluate(expectation) ?? extra?.(result) ?? null;
    if (problem) failures.push(`"${expectation.text}" — ${problem} (${expectation.note})`);
  }
  assert(failures.length === 0, `${name}: ${group.length} fixture(s) hold${failures.length > 0 ? ` — ${failures.join("; ")}` : ""}`);
}

runGroup("task routing", ROUTE);
runGroup("non task routing", IGNORE, (result) =>
  result.action === "none" ? null : `action ${result.action} must stay none`,
);
runGroup("size detection", SIZE);
runGroup("safety", SAFETY);

{
  const empty = analyzeMessage("");
  assert(empty.role === null && empty.action === "none", "an empty message routes nowhere");
  const long = analyzeMessage("word ".repeat(240));
  assert(long.role === null && long.action === "none", "a long unstructured message routes nowhere");
  const mention = analyzeMessage("@unknown-agent do something");
  assert(mention.isDirectRouting && mention.directAgent === "unknown-agent", "an unknown mention is reported verbatim");
  assert(mention.confidence <= 0.95, "confidence never exceeds the documented ceiling");
}

{
  const results = IGNORE.map((fixture) => analyzeMessage(fixture.text));
  const routed = results.filter((result) => result.action !== "none").length;
  assert(routed === 0, `no non task fixture auto-routes (found ${routed})`);
  const keywordMatches = results.filter((result) => result.confidence >= 0.65).length;
  assert(keywordMatches === 0, `no non task fixture reaches the routing threshold (found ${keywordMatches})`);
}

{
  const fuzzySources = readFileSync(join(repo, "src", "services", "fuzzy-match.ts"), "utf-8");
  assert(fuzzySources.includes("MIN_FUZZY_KEYWORD_LENGTH"), "the fuzzy branch declares a minimum keyword length");
  assert(fuzzySources.includes("function normalizeText"), "the matcher normalizes the text once");
  assert(!fuzzySources.includes("lower.includes(kw.toLowerCase())"), "the exact branch no longer matches inside a word");
  assert(fuzzySources.includes("export function containsWholePhrase"), "the whole-word matcher is reusable");

  const routingSources = readFileSync(join(repo, "src", "services", "routing-algorithm.ts"), "utf-8");
  assert(routingSources.includes("containsWholePhrase(text, keyword)"), "size votes use the whole-word matcher");
  assert(!routingSources.includes("lower.includes(keyword)"), "size votes never match inside a word");
}

console.log("PROOF PASS: routing evals separate tasks from chatter");
