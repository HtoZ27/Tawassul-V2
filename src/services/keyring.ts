

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.ts";
import { safeHomedir } from "../utils/path-resolver.ts";
import { isIsolationActiveSync } from "./isolation.ts";


function resolveSecretsDir(): string {
  return join(safeHomedir(), ".tawassul");
}


export async function getSecret(name: string): Promise<string | null> {
  
  const envValue = process.env[name];
  if (envValue) {
    return envValue;
  }

  
  if (process.env.TAWASSUL_KEYRING === "1") {
    
    
    
    const safeName = /^[A-Za-z0-9_-]+$/.test(name) ? name : null;
    if (safeName) {
      try {
        const { execFileSync } = await import("node:child_process");
        
        const value = execFileSync("secret-tool", ["lookup", "tawassul", safeName], {
          encoding: "utf8",
          timeout: 5000,
        }).trim();
        if (value) return value;
      } catch {
        
        try {
          const { execFileSync } = await import("node:child_process");
          const value = execFileSync("security", ["find-generic-password", "-s", "tawassul", "-a", safeName, "-w"], {
            encoding: "utf8",
            timeout: 5000,
          }).trim();
          if (value) return value;
        } catch {

        }
      }
    }
  }

  
  try {
    const file = join(resolveSecretsDir(), "secrets.json");
    if (existsSync(file)) {
      const data = JSON.parse(await readFile(file, "utf8"));
      if (name in data) {
        return data[name];
      }
    }
  } catch (err) {
    logger.warn(`[keyring] Failed to read secrets file: ${err}`);
  }

  return null;
}


export async function setSecret(name: string, value: string): Promise<void> {
  if (isIsolationActiveSync()) {
    logger.warn(
      `[keyring] setSecret("${name}") blocked: isolated session (fail-safe read-only) — secret not persisted`,
    );
    return;
  }

  const dir = resolveSecretsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }

  const file = join(dir, "secrets.json");
  let data: Record<string, string> = {};
  try {
    if (existsSync(file)) {
      data = JSON.parse(await readFile(file, "utf8"));
    }
  } catch {

  }

  data[name] = value;
  await writeFile(file, JSON.stringify(data, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}


export async function hasSecret(name: string): Promise<boolean> {
  return (await getSecret(name)) !== null;
}
