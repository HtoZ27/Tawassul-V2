import { permissionGuard } from "../src/hooks/guards/permission-guard.ts";

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

async function bashIsAgentTierForSubagents(): Promise<void> {
  const output: { args: Record<string, unknown>; error?: string } = { args: { command: "git status --short" } };
  const allowed = await permissionGuard.check(
    {} as never,
    { tool: "bash", agent: "dev", sessionID: "proof-g002i5" },
    output,
  );
  assert(allowed === true, "a subagent named dev can run bash at agent tier");
  assert(output.error === undefined, "bash is no longer tier-denied to a subagent");

  const kebabDev: { args: Record<string, unknown>; error?: string } = { args: { command: "make -C repo all" } };
  const kebabAllowed = await permissionGuard.check(
    {} as never,
    { tool: "bash", agent: "dev-gemini", sessionID: "proof-g002i5" },
    kebabDev,
  );
  assert(kebabAllowed === true, "a variant agent keeps bash available at agent tier");
}

async function adminToolsStayGated(): Promise<void> {
  const kickOutput: { args: Record<string, unknown>; error?: string } = { args: { agent: "dev" } };
  const kickAllowed = await permissionGuard.check(
    {} as never,
    { tool: "kick", agent: "dev", sessionID: "proof-g002i5" },
    kickOutput,
  );
  assert(kickAllowed === false, "kick stays admin-only for a subagent");
  assert(typeof kickOutput.error === "string" && kickOutput.error.length > 0, "kick denial keeps a message");

  const addOutput: { args: Record<string, unknown>; error?: string } = { args: {} };
  const addAllowed = await permissionGuard.check(
    {} as never,
    { tool: "addagent", agent: "dev", sessionID: "proof-g002i5" },
    addOutput,
  );
  assert(addAllowed === false, "addagent stays admin-only for a subagent");
}

async function unknownToolDefaultsToAgent(): Promise<void> {
  const output: { args: Record<string, unknown>; error?: string } = { args: {} };
  const allowed = await permissionGuard.check(
    {} as never,
    { tool: "someFutureHostTool", agent: "dev", sessionID: "proof-g002i5" },
    output,
  );
  assert(allowed === true, "an unlisted host tool defaults to agent tier, not admin");
}

async function mainSessionStillAdmin(): Promise<void> {
  const output: { args: Record<string, unknown>; error?: string } = { args: {} };
  const allowed = await permissionGuard.check(
    {} as never,
    { tool: "delete", agent: "", sessionID: "proof-g002i5" },
    output,
  );
  assert(allowed === true, "the main session keeps admin-tier access to roster-managed tools");
}

try {
  await bashIsAgentTierForSubagents();
  await adminToolsStayGated();
  await unknownToolDefaultsToAgent();
  await mainSessionStillAdmin();
  console.log(`PROOF PASS: bash is agent-tier with the roster, admin tools stay gated (${passed} assertions)`);
} catch (e) {
  if (!String((e as Error)?.message ?? "").includes("PROOF FAIL")) {
    console.error(`PROOF FAIL: ${(e as Error)?.message ?? e}`);
    process.exitCode = 1;
  }
}
