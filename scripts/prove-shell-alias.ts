import { normalizeToolName } from "../src/utils/name-utils.ts";
import { toolNameToV1 } from "../src/v2/delegation.ts";
import { requiresConsent } from "../src/hooks/guards/shared/limits.ts";
import { permissionGuard } from "../src/hooks/guards/permission-guard.ts";
import { SecurityPolicy } from "../src/security-policy.ts";

let failures = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`ok ${name}`);
    return;
  }
  failures += 1;
  console.error(`PROOF FAIL: ${name}`);
}

check("v2 host shell normalizes to bash", normalizeToolName("shell") === "bash");
check("uppercase shell normalizes to bash", normalizeToolName("SHELL") === "bash");
check("bash stays bash", normalizeToolName("bash") === "bash");
check("v1 bridge maps shell to bash", toolNameToV1("shell") === "bash");
check("v1 bridge keeps task mapping", toolNameToV1("subagent") === "task");

check(
  "consent applies to a raw shell force push",
  requiresConsent("shell", { command: "git push origin main --force" }),
);
check(
  "consent applies to a normalized shell force push",
  requiresConsent(normalizeToolName("shell"), { command: "git push origin main --force" }),
);
check(
  "consent applies to a raw shell sudo command",
  requiresConsent("shell", { command: "sudo systemctl restart sshd" }),
);
check(
  "consent ignores a read-only shell command",
  !requiresConsent("shell", { command: "git status --short" }),
);

const dangerousOutput: { args: Record<string, unknown>; error?: string } = {
  args: { command: "rm -rf /tmp/tawassul-proof-target" },
};
const dangerousAllowed = await permissionGuard.check(
  {} as never,
  { tool: "bash", sessionID: "proof-shell-alias" },
  dangerousOutput,
);
check("permission guard blocks a dangerous shell command", dangerousAllowed === false);
check(
  "permission guard reports the dangerous command",
  typeof dangerousOutput.error === "string" && dangerousOutput.error.includes("Dangerous"),
);

const safeOutput: { args: Record<string, unknown>; error?: string } = {
  args: { command: "git status --short" },
};
const safeAllowed = await permissionGuard.check(
  {} as never,
  { tool: "bash", sessionID: "proof-shell-alias" },
  safeOutput,
);
check("permission guard allows a read-only shell command", safeAllowed === true);

const tawaShell = SecurityPolicy.enforce({
  agent: "tawa",
  tool: "shell",
  args: { command: "git status --short" },
});
check("tawa cannot use the shell alias", tawaShell.allowed === false);
check("tawa cannot use bash", SecurityPolicy.enforce({ agent: "tawa", tool: "bash", args: {} }).allowed === false);

if (failures > 0) {
  console.error(`PROOF FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("PROOF PASS: the v2 shell alias is canonicalized before every guard");
