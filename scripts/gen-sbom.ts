import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

type Manifest = {
  name?: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type LockEntry = {
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  optional?: boolean;
  license?: string;
};

type Lock = { packages?: Record<string, LockEntry> };

type PackageJson = { name?: string; version?: string; license?: string };

type LicenseEntry = { license: { id: string } } | { expression: string };

type Component = {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  licenses: LicenseEntry[];
  hashes?: Array<{ alg: "SHA-512"; content: string }>;
  properties: Array<{ name: string; value: string }>;
};

const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as Manifest;
const lock = JSON.parse(readFileSync(join(REPO, "package-lock.json"), "utf8")) as Lock;

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const outPath = argValue("--out") ?? join(REPO, "dist", "sbom.cdx.json");
const bundlePath = resolve(REPO, argValue("--bundle") ?? join("dist", "global.js"));
const wasmArg = argValue("--wasm");
const wasmDir = wasmArg ? resolve(REPO, wasmArg) : "";

const WASM_FALLBACK = [
  join("node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
  join("node_modules", "tree-sitter-javascript", "tree-sitter-javascript.wasm"),
  join("node_modules", "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  join("node_modules", "tree-sitter-typescript", "tree-sitter-tsx.wasm"),
];

const SHIPPED: Record<string, string> = {
  "@opencode/plugin": "external",
  "confbox": "bundle",
  "zod": "bundle",
  "web-tree-sitter": "bundle",
  "tree-sitter-javascript": "wasm",
  "tree-sitter-typescript": "wasm",
};

const COPYLEFT = /(^|[^A-Za-z])(A?GPL|LGPL|MPL|SSPL|CPAL|EUPL)([^A-Za-z]|$)/;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function purlOf(name: string, version: string): string {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encoded}@${version}`;
}

function licenseEntry(raw: string): LicenseEntry {
  const value = raw.trim();
  if (value.includes(" OR ") || value.includes(" AND ")) {
    return { expression: value.replace(/[()]/g, "").trim() };
  }
  return { license: { id: value } };
}

function hashFromIntegrity(integrity: string | undefined): Array<{ alg: "SHA-512"; content: string }> {
  if (!integrity) return [];
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
  if (!match) return [];
  const payload = match[1] ?? "";
  if (!payload) return [];
  const hex = Buffer.from(payload, "base64").toString("hex");
  return [{ alg: "SHA-512", content: hex }];
}

function packageJsonFor(path: string): PackageJson | undefined {
  const file = join(REPO, path, "package.json");
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

const rootDeps = new Set(Object.keys(manifest.dependencies ?? {}));
const components: Component[] = [];
const problems: string[] = [];

for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  if (!key.startsWith("node_modules/")) continue;
  const segments = key.split("node_modules/").filter(Boolean);
  const name = segments[segments.length - 1];
  if (!name || name.startsWith(".")) continue;
  const installed = packageJsonFor(key);
  const version = entry.version ?? installed?.version ?? "";
  const license = installed?.license ?? entry.license ?? "";
  if (!version) {
    problems.push(`${name} has no version`);
    continue;
  }
  if (!license) {
    problems.push(`${name}@${version} has no licence field`);
    continue;
  }
  if (COPYLEFT.test(license)) {
    problems.push(`${name}@${version} carries a copyleft licence (${license})`);
  }
  const shipped = SHIPPED[name] ?? (name === "effect" || name.startsWith("@opencode/") ? "external" : "build");
  components.push({
    type: "library",
    "bom-ref": purlOf(name, version),
    name,
    version,
    purl: purlOf(name, version),
    licenses: [licenseEntry(license)],
    hashes: hashFromIntegrity(entry.integrity),
    properties: [
      { name: "tawassul:shipped", value: shipped },
      { name: "tawassul:declared", value: rootDeps.has(name) ? "dependencies" : "devDependencies" },
    ],
  });
}

components.sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));

if (problems.length > 0) {
  console.error("sbom: refusing to write an incomplete inventory");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const bundleHash = existsSync(bundlePath) ? sha256Hex(readFileSync(bundlePath)) : "";
const bundleBytes = existsSync(bundlePath) ? statSync(bundlePath).size : 0;
const wasm = (() => {
  if (wasmDir && existsSync(wasmDir)) {
    return readdirSync(wasmDir)
      .filter((name) => name.endsWith(".wasm"))
      .sort()
      .map((name) => ({ name, sha256: sha256Hex(readFileSync(join(wasmDir, name))) }));
  }
  return WASM_FALLBACK.filter((rel) => existsSync(join(REPO, rel))).map((rel) => ({
    name: rel.split("/").pop() ?? rel,
    sha256: sha256Hex(readFileSync(join(REPO, rel))),
  }));
})();

const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? "");
const timestamp = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : new Date().toISOString();
const contentKey = sha256Hex(JSON.stringify(components));
const serial = `${contentKey.slice(0, 8)}-${contentKey.slice(8, 12)}-5${contentKey.slice(13, 16)}-8${contentKey.slice(17, 20)}-${contentKey.slice(20, 32)}`;

const rootVersion = manifest.version ?? "0.0.0";
const rootName = manifest.name ?? "tawassul-v2";

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serial}`,
  version: 1,
  metadata: {
    timestamp,
    tools: {
      components: [
        { type: "application", name: "tawassul-sbom", version: rootVersion },
      ],
    },
    component: {
      type: "application",
      "bom-ref": purlOf(rootName, rootVersion),
      name: rootName,
      version: rootVersion,
      licenses: [licenseEntry(manifest.license ?? "Apache-2.0")],
    },
    properties: [
      { name: "tawassul:bundle:path", value: "dist/global.js" },
      { name: "tawassul:bundle:sha256", value: bundleHash },
      { name: "tawassul:bundle:bytes", value: String(bundleBytes) },
      { name: "tawassul:components", value: String(components.length) },
      ...wasm.map((file) => ({ name: `tawassul:wasm:${file.name}`, value: file.sha256 })),
    ],
  },
  components,
};

const json = `${JSON.stringify(sbom, null, 2)}\n`;
if (args.includes("--check")) {
  console.log(`sbom: OK (${components.length} components, ${wasm.length} wasm, no copyleft)`);
} else if (outPath === "-") {
  process.stdout.write(json);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  console.log(`sbom: wrote ${outPath} (${components.length} components, bundle ${bundleHash ? bundleHash.slice(0, 12) : "absent"}, ${wasm.length} wasm)`);
}
