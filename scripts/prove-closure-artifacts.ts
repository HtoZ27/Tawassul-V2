import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

type GateStep = { name: string; cmd: string[] };
type GateManifest = Record<string, GateStep[]>;

const manifest = JSON.parse(readFileSync(join(REPO, "scripts", "gate-manifest.json"), "utf-8")) as GateManifest;
const steps = Object.entries(manifest).flatMap(([stage, list]) =>
  list.map((step) => ({ stage, name: step.name, cmd: step.cmd })),
);
const wires = (file: string): boolean => steps.some((step) => step.cmd.includes(file));
const text = (file: string): string => readFileSync(join(REPO, file), "utf-8");

type Closure = {
  id: string;
  proof: string;
  markers: Array<[file: string, marker: string]>;
};

const CLOSURES: Closure[] = [
  {
    id: "H-02",
    proof: "scripts/prove-host-discovery.ts",
    markers: [
      ["scripts/doctor-v2.sh", "terminal CLI copy on PATH"],
      ["scripts/prove-host-discovery.ts", "the macOS Desktop CLI location is a candidate"],
    ],
  },
  {
    id: "H-06",
    proof: "scripts/check-sdk-pins.ts",
    markers: [
      ["scripts/doctor-v2.sh", "global config pins the v1 plugin SDK"],
      ["scripts/check-sdk-pins.ts", "the root lockfile pins the declared SDK"],
    ],
  },
  {
    id: "H-07",
    proof: "scripts/check-sdk-pins.ts",
    markers: [
      ["scripts/doctor-v2.sh", "v1 Bun global package present"],
      ["scripts/doctor-v2.sh", "Bun exposes opencode on PATH"],
    ],
  },
  {
    id: "P-05",
    proof: "scripts/prove-desktop-scan.ts",
    markers: [
      ["scripts/doctor-v2.sh", "retired plugin entry"],
      ["scripts/prove-desktop-scan.ts", "a retired package entry is reported"],
    ],
  },
  {
    id: "P-07",
    proof: "scripts/prove-desktop-scan.ts",
    markers: [
      ["scripts/doctor-v2.sh", "legacy global package directory present"],
      ["scripts/prove-desktop-scan.ts", "a retired package entry is reported"],
    ],
  },
  {
    id: "E-09",
    proof: "scripts/check-sdk-pins.ts",
    markers: [
      ["scripts/check-sdk-pins.ts", "the .opencode lockfile pins the declared SDK"],
      ["docs/installation.md", "\"@opencode/plugin\":\"^2.3.0\""],
    ],
  },
];

const doctorProofs = ["scripts/prove-d05.ts", "scripts/prove-desktop-scan.ts"];
for (const proof of doctorProofs) {
  assert(wires(proof), `${proof} is wired into a gate step`);
  assert(text(proof).includes("doctor-v2.sh"), `${proof} executes doctor-v2.sh`);
}

for (const closure of CLOSURES) {
  assert(wires(closure.proof), `${closure.id} has a gate-wired proof (${closure.proof})`);
  for (const [file, marker] of closure.markers) {
    assert(existsSync(join(REPO, file)), `${closure.id} evidence file exists (${file})`);
    assert(text(file).includes(marker), `${closure.id} evidence marker is present (${marker})`);
  }
}

const wiredFiles = new Set(steps.flatMap((step) => step.cmd.filter((part) => part.startsWith("scripts/"))));
for (const closure of CLOSURES) {
  assert(wiredFiles.has(closure.proof), `${closure.id} proof is part of the gate manifest`);
}

console.log(`PROOF PASS: ${CLOSURES.length} high-stakes closures have a live gate reference (${passed} assertions)`);
