import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const argDir = process.argv[2];
const OUT = resolve(REPO, argDir ?? join("dist", "release"));

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function bytes(file: string): number {
  return statSync(file).size;
}

const WASM = [
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-javascript/tree-sitter-javascript.wasm",
  "tree-sitter-typescript/tree-sitter-typescript.wasm",
  "tree-sitter-typescript/tree-sitter-tsx.wasm",
];

if (!existsSync(OUT)) {
  console.error(`verify-artifact: missing directory ${OUT}`);
  process.exit(2);
}

const versionFile = join(OUT, "VERSION");
check(existsSync(versionFile), "VERSION is missing");
const version = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "";
const NAME = `tawassul-${version}`;
const RUNTIME_NAME = `tawassul-runtime-${version}`;

const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version?: string };
check(manifest.version === version, `VERSION ${version} does not match package.json ${manifest.version}`);

const EXPECTED_ASSETS = [
  `${NAME}.tgz`,
  `${RUNTIME_NAME}.tar.gz`,
  `${NAME}.global.js`,
  `${NAME}.index.js`,
  `${NAME}.cdx.json`,
  "VERSION",
  "NOTICE.md",
];

const sumsFile = join(OUT, "SHA256SUMS");
check(existsSync(sumsFile), "SHA256SUMS is missing");
const sums = new Map<string, string>();
if (existsSync(sumsFile)) {
  for (const line of readFileSync(sumsFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line.trim());
    if (!match) {
      failures.push(`SHA256SUMS has an unreadable line: ${line}`);
      continue;
    }
    const [, hash, name] = match as unknown as [string, string, string];
    if (sums.has(name)) failures.push(`SHA256SUMS lists ${name} twice`);
    sums.set(name, hash);
  }
}

const listed = [...sums.keys()].sort();
const expected = [...EXPECTED_ASSETS].sort();
check(
  JSON.stringify(listed) === JSON.stringify(expected),
  `SHA256SUMS lists ${listed.join(", ")}; expected ${expected.join(", ")}`,
);

for (const [name, hash] of sums) {
  const file = join(OUT, name);
  if (!existsSync(file)) {
    failures.push(`SHA256SUMS names ${name}, which is absent`);
    continue;
  }
  const actual = sha256(file);
  check(actual === hash, `${name} hash ${actual.slice(0, 12)} does not match SHA256SUMS ${hash.slice(0, 12)}`);
}

function archiveFiles(file: string): string[] {
  try {
    const output = execFileSync("tar", ["-tzf", file], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.endsWith("/"))
      .sort();
  } catch (error) {
    failures.push(`cannot list ${file}: ${(error as Error).message}`);
    return [];
  }
}

const tarball = join(OUT, `${NAME}.tgz`);
if (existsSync(tarball)) {
  const expectedTar = [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/CHANGELOG.md",
    "package/NOTICE.md",
    "package/tawassul.schema.json",
    "package/dist/index.js",
    "package/dist/global.js",
    ...WASM.map((rel) => `package/tawassul-runtime/wasm/${rel}`),
  ].sort();
  const actualTar = archiveFiles(tarball);
  check(
    JSON.stringify(actualTar) === JSON.stringify(expectedTar),
    `tarball lists ${actualTar.length} files; expected ${expectedTar.length} and no others`,
  );
  for (const forbidden of ["src/", "scripts/", "tests/", "docs/", "node_modules/", ".github/", "dist/sbom"]) {
    check(
      actualTar.every((entry) => !entry.startsWith(`package/${forbidden}`)),
      `tarball contains forbidden path ${forbidden}`,
    );
  }
  for (const rel of WASM) {
    check(actualTar.includes(`package/tawassul-runtime/wasm/${rel}`), `tarball is missing wasm ${rel}`);
  }
}

const runtime = join(OUT, `${RUNTIME_NAME}.tar.gz`);
if (existsSync(runtime)) {
  const expectedRuntime = WASM.map((rel) => `tawassul-runtime/wasm/${rel}`).sort();
  const actualRuntime = archiveFiles(runtime);
  check(
    JSON.stringify(actualRuntime) === JSON.stringify(expectedRuntime),
    `runtime archive lists ${actualRuntime.join(", ")}; expected the four wasm grammars`,
  );
}

const globalFile = join(OUT, `${NAME}.global.js`);
if (existsSync(globalFile)) {
  const text = readFileSync(globalFile, "utf8");
  check(text.includes("TAWASSUL_CONTENT_SHA="), "global.js carries no content marker");
  check(text.length > 100_000, `global.js is only ${text.length} bytes; the self-contained bundle is larger`);
  for (const specifier of ["@opencode/plugin", "web-tree-sitter", "zod", "effect"]) {
    check(!new RegExp(`from\\s+"${specifier.replace("/", "\\/")}`).test(text), `global.js imports ${specifier} at runtime`);
  }
}

const indexFile = join(OUT, `${NAME}.index.js`);
if (existsSync(indexFile)) {
  check(readFileSync(indexFile, "utf8").includes("TAWASSUL_CONTENT_SHA="), "index.js carries no content marker");
}

const scratchBase = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
let extracted: string | undefined;
if (existsSync(runtime)) {
  try {
    extracted = mkdtempSync(join(scratchBase, "tawassul-verify-"));
    execFileSync("tar", ["-xzf", runtime, "-C", extracted], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    failures.push(`cannot extract ${runtime}: ${(error as Error).message}`);
  }
}

const sbomFile = join(OUT, `${NAME}.cdx.json`);
if (existsSync(sbomFile)) {
  try {
    const sbom = JSON.parse(readFileSync(sbomFile, "utf8")) as {
      bomFormat?: string;
      specVersion?: string;
      metadata?: { component?: { version?: string }; properties?: Array<{ name: string; value: string }> };
      components?: unknown[];
    };
    check(sbom.bomFormat === "CycloneDX", "SBOM is not CycloneDX");
    check(sbom.specVersion === "1.5", `SBOM specVersion is ${sbom.specVersion}`);
    check(sbom.metadata?.component?.version === version, "SBOM root version does not match VERSION");
    check((sbom.components?.length ?? 0) > 100, "SBOM component list is implausibly small");
    const properties = sbom.metadata?.properties ?? [];
    const wasmHash = (name: string) => properties.find((entry) => entry.name === `tawassul:wasm:${name}`)?.value;
    for (const rel of WASM) {
      const name = rel.split("/").pop() as string;
      const recorded = wasmHash(name);
      check(typeof recorded === "string" && recorded.length === 64, `SBOM records no hash for ${name}`);
      if (extracted) {
        const file = join(extracted, "tawassul-runtime", "wasm", rel);
        if (!existsSync(file)) {
          failures.push(`runtime archive is missing ${rel}`);
        } else {
          check(recorded === sha256(file), `SBOM hash for ${name} does not match the runtime archive`);
        }
      }
    }
    if (existsSync(globalFile)) {
      const recorded = properties.find((entry) => entry.name === "tawassul:bundle:sha256")?.value;
      check(recorded === sha256(globalFile), "SBOM bundle hash does not match global.js");
    }
  } catch (error) {
    failures.push(`SBOM is not readable JSON: ${(error as Error).message}`);
  }
}

const notice = join(OUT, "NOTICE.md");
if (existsSync(notice)) {
  check(bytes(notice) > 500, "NOTICE.md is unexpectedly small");
} else {
  failures.push("NOTICE.md is missing");
}

if (extracted) rmSync(extracted, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`verify-artifact: ${failures.length} problem(s) in ${OUT}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const total = EXPECTED_ASSETS.reduce((sum, name) => sum + bytes(join(OUT, name)), 0);
console.log(
  `verify-artifact: OK (${version}; ${EXPECTED_ASSETS.length} assets, ${(total / 1024 / 1024).toFixed(1)} MiB; ` +
    `tarball, runtime archive, bundle, index, SBOM, notices and checksums agree)`,
);
