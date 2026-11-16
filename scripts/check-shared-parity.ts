import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_PATH = resolve(repo, "SHARED.md");
const DATA_PATH = resolve(repo, "scripts", "shared-parity.json");
const DOC_PATH = resolve(repo, "docs", "SHARED-PARITY.md");
const ISSUES_PATH = resolve(repo, "ISSUES.md");

type Status = "verified" | "anchored" | "partial" | "missing" | "host-bound" | "n-a" | "doc-only";

type Anchor = { file: string; line: number; marker: string };

type Requirement = {
  text: string;
  status: Status;
  anchor: Anchor | null;
  proofs: string[];
  issue: string | null;
  note: string | null;
  hostNote: string | null;
};

type Entry = {
  id: string;
  title: string;
  sharedLine: number;
  status: Status;
  requirements: Requirement[];
};

type Parity = {
  source: string;
  frozenEntries: number;
  entries: Entry[];
};

type Heading = { id: string; title: string; line: number };

const STATUSES: Status[] = ["verified", "anchored", "partial", "missing", "host-bound", "n-a", "doc-only"];
const RANK: Record<Status, number> = {
  verified: 0,
  anchored: 1,
  "host-bound": 2,
  partial: 3,
  missing: 4,
  "n-a": -1,
  "doc-only": -1,
};

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function sharedHeadings(): Heading[] {
  const lines = readText(SHARED_PATH).split("\n");
  const headings: Heading[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^## (S-\d{3})\s+(.*)$/.exec(lines[index] ?? "");
    if (match) {
      const raw = (match[2] ?? "").trim();
      const title = raw.replace(/\s*\(reference:[^)]*\)/i, " (reference: retired)");
      headings.push({ id: match[1] ?? "", title, line: index + 1 });
    }
  }
  return headings;
}

function lineCount(path: string): number {
  return readText(path).split("\n").length;
}

function deriveStatus(requirements: Requirement[]): Status {
  let best: Status = "n-a";
  let rank = -1;
  let sawDoc = false;
  let sawNa = false;
  for (const requirement of requirements) {
    if (requirement.status === "doc-only") {
      sawDoc = true;
      continue;
    }
    if (requirement.status === "n-a") {
      sawNa = true;
      continue;
    }
    const value = RANK[requirement.status];
    if (value > rank) {
      rank = value;
      best = requirement.status;
    }
  }
  if (rank < 0) return sawDoc ? "doc-only" : sawNa ? "n-a" : "n-a";
  return best;
}

function loadData(): Parity {
  return JSON.parse(readText(DATA_PATH)) as Parity;
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}

function checkAnchor(entry: Entry, requirement: Requirement, problems: string[]): void {
  const anchor = requirement.anchor;
  if (!anchor) {
    problems.push(`${entry.id}: ${requirement.status} requires an anchor`);
    return;
  }
  if (typeof anchor.file !== "string" || anchor.file.length === 0) {
    problems.push(`${entry.id}: anchor file is empty`);
    return;
  }
  if (anchor.file.startsWith("/") || anchor.file.split("/").includes("..")) {
    problems.push(`${entry.id}: anchor file must stay inside the repository (${anchor.file})`);
    return;
  }
  const path = resolve(repo, anchor.file);
  if (!existsSync(path)) {
    problems.push(`${entry.id}: anchor file not found (${anchor.file})`);
    return;
  }
  if (typeof anchor.marker !== "string" || anchor.marker.trim().length < 3) {
    problems.push(`${entry.id}: anchor marker is too short`);
    return;
  }
  if (!Number.isInteger(anchor.line) || anchor.line < 1 || anchor.line > lineCount(path)) {
    problems.push(`${entry.id}: anchor line out of range (${anchor.file}:${anchor.line})`);
    return;
  }
  const lines = readText(path).split("\n");
  const line = lines[anchor.line - 1] ?? "";
  if (!line.includes(anchor.marker)) {
    problems.push(
      `${entry.id}: anchor drift at ${anchor.file}:${anchor.line} — marker "${anchor.marker}" is not on that line (run --write)`,
    );
  }
}

function checkProofs(entry: Entry, requirement: Requirement, problems: string[]): void {
  if (!Array.isArray(requirement.proofs)) {
    problems.push(`${entry.id}: proofs must be an array`);
    return;
  }
  if (requirement.status === "verified" && requirement.proofs.length === 0) {
    problems.push(`${entry.id}: verified requires at least one proof`);
  }
  for (const proof of requirement.proofs) {
    if (typeof proof !== "string" || proof.length === 0) {
      problems.push(`${entry.id}: proof path is empty`);
      continue;
    }
    if (proof === "SHARED.md") {
      problems.push(`${entry.id}: the frozen source cannot be its own proof`);
      continue;
    }
    if (!existsSync(resolve(repo, proof))) problems.push(`${entry.id}: proof not found (${proof})`);
  }
}

function checkIssue(entry: Entry, requirement: Requirement, issues: string, problems: string[]): void {
  if (requirement.issue === null) {
    problems.push(`${entry.id}: ${requirement.status} requires an ISSUES.md entry id`);
    return;
  }
  if (!/^E-\d+$/.test(requirement.issue)) {
    problems.push(`${entry.id}: issue id must look like E-12 (${requirement.issue})`);
    return;
  }
  const heading = new RegExp(`^#{2,4}\\s+${requirement.issue}\\b`, "m");
  if (!heading.test(issues)) problems.push(`${entry.id}: ${requirement.issue} has no heading in ISSUES.md`);
}

function validate(data: Parity): string[] {
  const problems: string[] = [];
  const headings = sharedHeadings();
  const issues = readText(ISSUES_PATH);

  if (data.source !== "SHARED.md") problems.push("source must be SHARED.md");
  if (data.frozenEntries !== headings.length) {
    problems.push(`frozenEntries ${data.frozenEntries} != SHARED.md headings ${headings.length}`);
  }
  if (!Array.isArray(data.entries)) {
    problems.push("entries must be an array");
    return problems;
  }
  if (data.entries.length !== headings.length) {
    problems.push(`entry count ${data.entries.length} != SHARED.md headings ${headings.length}`);
  }

  const seen = new Set<string>();
  for (let index = 0; index < data.entries.length; index++) {
    const entry = data.entries[index];
    if (!entry) continue;
    const heading = headings[index];
    if (!heading) {
      problems.push(`extra entry ${entry.id} has no SHARED.md heading`);
      continue;
    }
    if (entry.id !== heading.id) {
      problems.push(`entry ${index + 1} is ${entry.id} but SHARED.md has ${heading.id}`);
    }
    if (seen.has(entry.id)) problems.push(`${entry.id} is duplicated`);
    seen.add(entry.id);
    if (entry.title !== heading.title) {
      problems.push(`${entry.id}: title differs from SHARED.md (${heading.title})`);
    }
    if (entry.sharedLine !== heading.line) {
      problems.push(`${entry.id}: sharedLine ${entry.sharedLine} != ${heading.line}`);
    }
    if (!Array.isArray(entry.requirements) || entry.requirements.length === 0) {
      problems.push(`${entry.id}: at least one requirement is required`);
      continue;
    }
    for (const requirement of entry.requirements) {
      if (typeof requirement.text !== "string" || requirement.text.trim().length < 20) {
        problems.push(`${entry.id}: requirement text is too short`);
      }
      if (!isStatus(requirement.status)) {
        problems.push(`${entry.id}: unknown status ${String(requirement.status)}`);
        continue;
      }
      if (requirement.status === "verified" || requirement.status === "anchored") {
        checkAnchor(entry, requirement, problems);
      }
      if (requirement.status === "host-bound") {
        checkAnchor(entry, requirement, problems);
        if (typeof requirement.hostNote !== "string" || requirement.hostNote.trim().length < 20) {
          problems.push(`${entry.id}: host-bound requires a host note`);
        }
      }
      if (requirement.status === "partial" || requirement.status === "missing") {
        checkIssue(entry, requirement, issues, problems);
      }
      if (requirement.status === "n-a" || requirement.status === "doc-only") {
        if (typeof requirement.note !== "string" || requirement.note.trim().length < 20) {
          problems.push(`${entry.id}: ${requirement.status} requires a written reason`);
        }
      }
      checkProofs(entry, requirement, problems);
    }
    if (!isStatus(entry.status)) {
      problems.push(`${entry.id}: unknown entry status ${String(entry.status)}`);
    } else if (entry.status !== deriveStatus(entry.requirements)) {
      problems.push(`${entry.id}: entry status ${entry.status} != derived ${deriveStatus(entry.requirements)}`);
    }
  }

  for (const heading of headings) {
    if (!seen.has(heading.id)) problems.push(`${heading.id} has no ledger row`);
  }
  return problems;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function renderAnchor(anchor: Anchor | null): string {
  if (!anchor) return "-";
  return `\`${anchor.file}:${anchor.line}\` \`${cell(anchor.marker)}\``;
}

function renderProofs(proofs: string[]): string {
  if (proofs.length === 0) return "-";
  return proofs.map((proof) => `\`${proof}\``).join(", ");
}

function render(data: Parity): string {
  const counts = new Map<Status, number>();
  let requirementCount = 0;
  for (const entry of data.entries) {
    for (const requirement of entry.requirements) {
      counts.set(requirement.status, (counts.get(requirement.status) ?? 0) + 1);
      requirementCount += 1;
    }
  }
  const lines: string[] = [];
  lines.push("# SHARED parity ledger");
  lines.push("");
  lines.push("Generated from `scripts/shared-parity.json` by `bun scripts/check-shared-parity.ts --write`.");
  lines.push("Hand edits are rejected by `bun scripts/check-shared-parity.ts --check`, which runs in `gate:fast`.");
  lines.push("`SHARED.md` stays frozen at the 2026-10-24 cutover; this ledger is the v2 disposition of every entry.");
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push("| Status | Requirements |");
  lines.push("| --- | --- |");
  for (const status of STATUSES) lines.push(`| ${status} | ${counts.get(status) ?? 0} |`);
  lines.push(`| total | ${requirementCount} |`);
  lines.push("");
  lines.push(`${data.entries.length} entries, ${requirementCount} requirements.`);
  lines.push("");
  lines.push("## Ledger");
  lines.push("");
  lines.push("| Entry | Requirement | v2 anchor | Proof | Status |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const entry of data.entries) {
    for (let index = 0; index < entry.requirements.length; index++) {
      const requirement = entry.requirements[index];
      if (!requirement) continue;
      const id = entry.requirements.length > 1 ? `${entry.id}.${index + 1}` : entry.id;
      lines.push(
        `| ${id} | ${cell(requirement.text)} | ${renderAnchor(requirement.anchor)} | ${renderProofs(requirement.proofs)} | ${requirement.status} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Open items");
  lines.push("");
  const open = data.entries.flatMap((entry) =>
    entry.requirements
      .filter((requirement) => requirement.status === "partial" || requirement.status === "missing")
      .map((requirement) => ({ entry, requirement })),
  );
  if (open.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Entry | Requirement | Issue |");
    lines.push("| --- | --- | --- |");
    for (const item of open) {
      lines.push(`| ${item.entry.id} | ${cell(item.requirement.text)} | ${item.requirement.issue ?? "-"} |`);
    }
  }
  lines.push("");
  lines.push("## Host-bound items");
  lines.push("");
  const hostBound = data.entries.flatMap((entry) =>
    entry.requirements
      .filter((requirement) => requirement.status === "host-bound")
      .map((requirement) => ({ entry, requirement })),
  );
  if (hostBound.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Entry | Requirement | Host note |");
    lines.push("| --- | --- | --- |");
    for (const item of hostBound) {
      lines.push(`| ${item.entry.id} | ${cell(item.requirement.text)} | ${cell(item.requirement.hostNote ?? "-")} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function refresh(parity: Parity): string[] {
  const problems: string[] = [];
  const headings = sharedHeadings();
  const byId = new Map(headings.map((heading) => [heading.id, heading]));
  for (const entry of parity.entries) {
    const heading = byId.get(entry.id);
    if (!heading) {
      problems.push(`${entry.id} has no SHARED.md heading`);
      continue;
    }
    entry.title = heading.title;
    entry.sharedLine = heading.line;
    for (const requirement of entry.requirements) {
      const anchor = requirement.anchor;
      if (!anchor) continue;
      const path = resolve(repo, anchor.file);
      if (!existsSync(path)) {
        problems.push(`${entry.id}: anchor file not found (${anchor.file})`);
        continue;
      }
      const lines = readText(path).split("\n");
      const current = lines[anchor.line - 1] ?? "";
      if (current.includes(anchor.marker)) continue;
      const at = lines.findIndex((line) => line.includes(anchor.marker));
      if (at < 0) {
        problems.push(`${entry.id}: marker not found "${anchor.marker}" in ${anchor.file}`);
        continue;
      }
      anchor.line = at + 1;
    }
    entry.status = deriveStatus(entry.requirements);
  }
  return problems;
}

function usage(): string {
  return [
    "usage: bun scripts/check-shared-parity.ts [--check|--write]",
    "",
    "  --check   validate the ledger and the generated document (default)",
    "  --write   re-resolve anchor lines, refresh titles, rewrite the JSON and the document",
  ].join("\n");
}

function main(argv: string[]): number {
  let mode: "check" | "write" = "check";
  for (const arg of argv) {
    if (arg === "--check") {
      mode = "check";
      continue;
    }
    if (arg === "--write") {
      mode = "write";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    process.stderr.write(`[shared-parity] unknown argument ${arg}\n${usage()}\n`);
    return 2;
  }

  if (!existsSync(SHARED_PATH) || !existsSync(ISSUES_PATH)) {
    if (mode === "write") {
      process.stderr.write("[shared-parity] write needs SHARED.md and ISSUES.md\n");
      return 2;
    }
    process.stdout.write("[shared-parity] no v1 shared log in this tree; nothing to compare\n");
    return 0;
  }

  let data: Parity;
  try {
    data = loadData();
  } catch (error) {
    process.stderr.write(
      `[shared-parity] cannot read scripts/shared-parity.json: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  if (mode === "write") {
    const refreshProblems = refresh(data);
    if (refreshProblems.length > 0) {
      for (const problem of refreshProblems) process.stderr.write(`[shared-parity] ${problem}\n`);
      process.stderr.write(`[shared-parity] write ABORTED (${refreshProblems.length} problem(s))\n`);
      return 1;
    }
    const problems = validate(data);
    const fatal = problems.filter((problem) => !problem.includes("anchor drift"));
    if (fatal.length > 0) {
      for (const problem of fatal) process.stderr.write(`[shared-parity] ${problem}\n`);
      process.stderr.write(`[shared-parity] write ABORTED (${fatal.length} problem(s))\n`);
      return 1;
    }
    writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
    writeFileSync(DOC_PATH, render(data));
    process.stdout.write(`[shared-parity] wrote scripts/shared-parity.json and docs/SHARED-PARITY.md\n`);
  }

  const problems = validate(data);
  const expected = render(data);
  const actual = existsSync(DOC_PATH) ? readText(DOC_PATH) : "";
  if (actual !== expected) problems.push("docs/SHARED-PARITY.md is stale (run --write)");

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`[shared-parity] ${problem}\n`);
    process.stderr.write(`[shared-parity] ledger FAILED (${problems.length} problem(s))\n`);
    return 1;
  }

  const requirements = data.entries.reduce((total, entry) => total + entry.requirements.length, 0);
  process.stdout.write(
    `[shared-parity] ${data.entries.length} entries, ${requirements} requirements, document current\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
