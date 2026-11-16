

export type CapabilityPermissionBlock = {
  [key: string]: string | Record<string, string> | undefined;
};

export function buildCapabilitySummary(perm: CapabilityPermissionBlock | undefined): string {
  const caps: string[] = [];
  if (!perm) return "";
  const edit = perm.edit;
  if (typeof edit === "string") {
    if (edit === "allow") caps.push("edit: allowed");
    else caps.push("edit: " + edit);
  } else if (edit && typeof edit === "object") {
    const entries = Object.entries(edit);
    const denies = entries.filter(([, v]) => v === "deny").length;
    const allows = entries.filter(([, v]) => v === "allow").length;
    caps.push("edit: scoped (" + denies + " denied, " + allows + " allowed)");
  }
  const bash = perm.bash;
  if (typeof bash === "string") {
    caps.push(bash === "deny" ? "bash: denied" : `bash: ${bash}`);
  } else if (bash && typeof bash === "object") {
    const vals = Object.values(bash);
    const allows = vals.filter((v) => v === "allow").length;
    const denies = vals.filter((v) => v === "deny").length;
    caps.push(`bash: whitelist (${allows} allowed, ${denies} denied patterns)`);
  }
  return caps.length > 0 ? `\nCapabilities: ${caps.join("; ")}.` : "";
}
