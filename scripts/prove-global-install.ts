import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  claimCoexistence,
  detectInstallScope,
  isCoexistenceOwner,
  releaseCoexistence,
} from "../src/core/install-scope.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: boolean, name: string): void {
  if (!cond) fail(name);
  console.log(`ok ${name}`);
}

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = mkdtempSync(join(tmpdir(), "tawassul-global-install-"));
const HOME = join(ROOT, "home");
const CONFIG = join(HOME, ".config");
const GLOBAL = join(CONFIG, "opencode");
const TARGET = join(GLOBAL, "plugins", "tawassul.js");
const LEGACY = join(GLOBAL, "plugins", "tawassul");
const RUNTIME = join(GLOBAL, "tawassul-runtime");
const MARKER = join(RUNTIME, "VERSION");
const WASM = join(RUNTIME, "wasm");
const USER_CONFIG = join(GLOBAL, "opencode.jsonc");
const BODY = `{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "opencode/big-pickle"\n}\n`;
const WASM_FILES = [
  join(WASM, "web-tree-sitter", "web-tree-sitter.wasm"),
  join(WASM, "tree-sitter-javascript", "tree-sitter-javascript.wasm"),
  join(WASM, "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  join(WASM, "tree-sitter-typescript", "tree-sitter-tsx.wasm"),
];

type Marker = {
  package?: string;
  version?: string;
  host?: string;
  bundle?: { path?: string; sha256?: string; bytes?: number };
  wasm?: Record<string, { path?: string; sha256?: string; bytes?: number }>;
};

function proofEnv(): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...process.env,
    HOME,
    XDG_CONFIG_HOME: CONFIG,
    XDG_DATA_HOME: join(HOME, ".local", "share"),
    XDG_STATE_HOME: join(HOME, ".local", "state"),
    XDG_CACHE_HOME: join(HOME, ".cache"),
    PATH: "/usr/bin:/bin",
    TAWASSUL_OPENCODE_VERSION: "2.1.4",
  };
  delete next.TAWASSUL_GLOBAL_DIR;
  delete next.TAWASSUL_SCOPE;
  delete next.OPENCODE_BIN;
  return next;
}

function run(args: string[]): { code: number; out: string } {
  const result = spawnSync(
    process.execPath,
    [join(REPO, "scripts", "install-global.ts"), ...args],
    { env: proofEnv(), encoding: "utf-8" },
  );
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function marker(): Marker {
  return JSON.parse(readFileSync(MARKER, "utf-8")) as Marker;
}

function selfContainedBundle(text: string): boolean {
  return !/(?:from|import\()\s*["'](?:@opencode|zod|web-tree-sitter|effect)(?:\/[^"']*)?["']/.test(
    text,
  );
}

try {
  mkdirSync(GLOBAL, { recursive: true });
  writeFileSync(USER_CONFIG, BODY);

  const installed = run([]);
  assert(installed.code === 0, "install exits 0");
  assert(existsSync(TARGET), "flat plugin file is written");
  assert(!existsSync(LEGACY), "no package directory is created");
  assert(!existsSync(join(GLOBAL, "node_modules")), "no node_modules is created");
  assert(!existsSync(join(GLOBAL, "package.json")), "installer does not create a global package.json");
  assert(sha256(TARGET) === sha256(join(REPO, "dist", "global.js")), "plugin hash matches dist/global.js");
  assert(selfContainedBundle(readFileSync(TARGET, "utf-8")), "plugin bundle has no bare runtime imports");
  assert(existsSync(MARKER), "runtime marker is written");
  const record = marker();
  assert(record.package === "tawassul-v2", "marker identifies the plugin");
  assert(record.host === "2.1.4", "marker records the host pin");
  assert(record.bundle?.sha256 === sha256(TARGET), "marker records the bundle hash");
  assert(record.bundle?.path === "plugins/tawassul.js", "marker records the plugin path");
  assert(Object.keys(record.wasm ?? {}).length === WASM_FILES.length, "marker records every wasm asset");
  for (const file of WASM_FILES) {
    assert(existsSync(file), `wasm asset exists (${file.split("/").slice(-1)[0]})`);
  }
  for (const [id, entry] of Object.entries(record.wasm ?? {})) {
    assert(Boolean(entry.sha256), `${id} has a recorded hash`);
    assert(existsSync(join(GLOBAL, entry.path ?? "")), `${id} path resolves under the global config`);
  }
  assert(readFileSync(USER_CONFIG, "utf-8") === BODY, "install leaves the user config byte-identical");

  const again = run([]);
  assert(again.code === 0 && again.out.includes("already installed"), "second install is a no-op");

  process.env.HOME = HOME;
  process.env.XDG_CONFIG_HOME = CONFIG;
  delete process.env.TAWASSUL_GLOBAL_DIR;
  assert(detectInstallScope(pathToFileURL(TARGET).href) === "global", "installed file resolves to global scope");
  assert(
    detectInstallScope(pathToFileURL(join(REPO, ".opencode", "plugin", "tawassul.js")).href) ===
      "project",
    "project bundle resolves to project scope",
  );

  const workspace = join(ROOT, "workspace");
  const globalClaim = claimCoexistence("global", "global-token", workspace);
  const projectClaim = claimCoexistence("project", "project-token", workspace);
  assert(globalClaim.shouldRegister, "global claims the workspace first");
  assert(projectClaim.shouldRegister, "project copy supersedes the global copy");
  assert(isCoexistenceOwner("project", "project-token", workspace), "project copy owns the workspace");
  assert(!isCoexistenceOwner("global", "global-token", workspace), "global copy yields to the project copy");
  releaseCoexistence("project", "project-token", workspace);

  mkdirSync(join(HOME, ".opencode"), { recursive: true });
  const refused = run([]);
  assert(
    refused.code !== 0 && refused.out.includes("v1 artifacts"),
    "install refuses while a v1 artifact exists",
  );
  assert(existsSync(TARGET), "refusal leaves the install intact");
  rmSync(join(HOME, ".opencode"), { recursive: true, force: true });

  mkdirSync(LEGACY, { recursive: true });
  writeFileSync(join(LEGACY, "index.js"), "export default 1;\n");
  const legacyRefused = run([]);
  assert(
    legacyRefused.code !== 0 && legacyRefused.out.includes("legacy package-directory"),
    "install refuses a legacy package directory",
  );
  rmSync(LEGACY, { recursive: true, force: true });

  appendFileSync(WASM_FILES[1] as string, Buffer.from([0]));
  const tampered = run(["--verify"]);
  assert(tampered.code !== 0 && tampered.out.includes("wasm size mismatch"), "verify fails on a tampered wasm asset");
  const repaired = run([]);
  assert(repaired.code === 0 && !repaired.out.includes("already installed"), "install repairs a tampered wasm asset");
  assert(run(["--verify"]).code === 0, "verify passes after repair");

  const removed = run(["--uninstall"]);
  assert(removed.code === 0 && !existsSync(TARGET), "uninstall removes the flat plugin file");
  assert(!existsSync(RUNTIME), "uninstall removes the runtime directory");
  assert(readFileSync(USER_CONFIG, "utf-8") === BODY, "uninstall leaves the user config byte-identical");

  const dry = run(["--dry-run"]);
  assert(dry.code === 0 && !existsSync(TARGET) && !existsSync(RUNTIME), "dry run writes nothing");

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, "export default 1;\n");
  const unmarked = run([]);
  assert(
    unmarked.code !== 0 && unmarked.out.includes("without a Tawassul marker"),
    "install refuses an unmarked target",
  );
  const unmarkedRemove = run(["--uninstall"]);
  assert(unmarkedRemove.code !== 0, "uninstall refuses an unmarked target");
  const forced = run(["--force"]);
  assert(forced.code === 0, "--force replaces an unmarked target");
  assert(run(["--uninstall"]).code === 0, "uninstall removes a forced install");

  const stateRoot = join(CONFIG, "tawassul-v2", "state");
  const runtimeRoot = join(GLOBAL, "tawassul-v2-state");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(join(stateRoot, "state.json"), "{}\n");
  writeFileSync(join(runtimeRoot, "metrics.json"), "{}\n");
  writeFileSync(join(GLOBAL, "tawassul.jsonc"), "{}\n");
  assert(run([]).code === 0, "install succeeds before purge");
  const purged = run(["--uninstall", "--purge"]);
  assert(purged.code === 0, "uninstall --purge exits 0");
  assert(
    !existsSync(TARGET) &&
      !existsSync(RUNTIME) &&
      !existsSync(stateRoot) &&
      !existsSync(runtimeRoot) &&
      !existsSync(join(GLOBAL, "tawassul.jsonc")),
    "uninstall --purge removes the runtime, state, and roster",
  );

  const verifiedMissing = run(["--verify"]);
  assert(verifiedMissing.code !== 0, "verify fails when nothing is installed");

  console.log("PROOF PASS: global installation");
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
