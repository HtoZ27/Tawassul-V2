import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type BundleFingerprint = {
  entry: string;
  sha256: string;
  bytes: number;
};

export function bundleFingerprint(entry?: string): BundleFingerprint | null {
  try {
    const path = entry ?? fileURLToPath(import.meta.url);
    if (!existsSync(path)) return null;
    const bytes = readFileSync(path);
    return {
      entry: path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    };
  } catch {
    return null;
  }
}
