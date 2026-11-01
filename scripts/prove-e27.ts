import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { TOOL_COUNT, TOOL_NAME_SET_HASH } from "../src/generated/tool-tripwire.ts";

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

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "tawassul-e27-"));
const bootMarker = `v2 registered ${TOOL_COUNT} tools name-set ${TOOL_NAME_SET_HASH}`;

type Mode = "hang" | "refusal" | "reply";

function stub(mode: Mode): string {
  const path = join(work, `stub-${mode}.sh`);
  const body =
    mode === "hang"
      ? "sleep 30\n"
      : mode === "refusal"
        ? `echo '{"type":"error","error":{"data":{"message":"FreeUsageLimitError: free usage limit reached"}}}'\nexit 1\n`
        : `echo '{"type":"text","text":"SMOKE"}'\nexit 0\n`;
  writeFileSync(
    path,
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then printf '2.2.0\\n'; exit 0; fi
if [ "$1" = "run" ]; then
  printf 'initPlugin=1\\n' >> "$TAWASSUL_LOG_FILE"
  printf '${bootMarker}\\n' >> "$TAWASSUL_LOG_FILE"
  ${body}fi
exit 0
`,
    { mode: 0o755, encoding: "utf8" },
  );
  return path;
}

function runSmoke(mode: Mode, extraEnv: Record<string, string> = {}): { code: number; text: string } {
  const result = spawnSync("bash", [join(repo, "scripts", "release-smoke.sh")], {
    cwd: repo,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      TAWASSUL_OPENCODE_BIN: stub(mode),
      TAWASSUL_SMOKE_SKIP_BUILD: "1",
      TAWASSUL_SMOKE_TIMEOUT: "2",
      TAWASSUL_SMOKE_AUTH_SRC: join(work, "missing-auth.json"),
      ...extraEnv,
    },
  });
  return { code: result.status ?? -1, text: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function main(): void {
  const hang = runSmoke("hang");
  assert(hang.code === 3, "a boot that hangs without a provider refusal fails the smoke");
  assert(
    hang.text.includes("no provider refusal code"),
    "the failure names the missing refusal instead of blaming the transport",
  );
  assert(!hang.text.includes("SMOKE PASS"), "a plugged boot that never replies is never reported as a pass");

  const optOut = runSmoke("hang", { TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY: "0" });
  assert(optOut.code === 0, "TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=0 keeps the explicit tolerance");
  assert(
    optOut.text.includes("SMOKE PASS (no model reply"),
    "the tolerated boot says it had no reply",
  );
  assert(optOut.text.includes("TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=0"), "the tolerated boot names the switch");

  const refusal = runSmoke("refusal");
  assert(refusal.code === 0, "a provider refusal still lets the boot pass");
  assert(refusal.text.includes("provider refused"), "the refusal is reported as the reason");
  assert(
    refusal.text.includes("SMOKE PASS (no model reply"),
    "a refused reply is not reported as a model reply",
  );

  const reply = runSmoke("reply");
  assert(reply.code === 0, "a boot with a real reply passes");
  assert(
    reply.text.includes("SMOKE PASS:") && reply.text.includes("model reply"),
    "a real reply is reported as a model reply",
  );
}

try {
  main();
  console.log(`PROOF PASS: the smoke gate requires a real reply or an explicit provider refusal (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
