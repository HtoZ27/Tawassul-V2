

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  readFileSync,
  openSync,
  writeSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  unlinkSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.ts";
import { globalConfigBaseDir, globalConfigDir, evaluateIsolationSync } from "./path-resolver.ts";

export const HMAC_PREFIX = "TAWASSUL_V2_HMAC_V1:";
const LEGACY_HMAC_PREFIXES = ["TAWASSUL_HMAC_V1:", "TAWASSULL_HMAC_V1:"];
const KEY_LENGTH = 32;
const HMAC_ALGORITHM = "sha256";
const HMAC_KEY_FILE = ".tawassul-hmac-key";
const OLD_KEY_FILE = ".tawassul-key";
const OLD_SALT_FILE = ".tawassul-salt";
const OLD_VERSION_FILE = ".tawassul-key-version";

let _cachedHmacKey: Buffer | null = null;


export const SENTINEL_HMAC_KEY = Buffer.from("tawassul-isolation-sentinel".padEnd(KEY_LENGTH, "."), "utf-8");


export class HmacKeyIsolationError extends Error {
  constructor() {
    super(
      "HMAC key is unavailable: the session is isolated (fail-safe read-only). " +
        "No signing key is used and no state write is allowed.",
    );
    this.name = "HmacKeyIsolationError";
  }
}


function isSentinelKey(key: Buffer | null | undefined): boolean {
  return !!key && key.length === SENTINEL_HMAC_KEY.length && key.equals(SENTINEL_HMAC_KEY);
}


let _detectOnly = false;

function getKeyDir(): string {
  
  
  
  
  
  
  
  
  
  
  
  const envKeyDir = process.env.TAWASSUL_HMAC_KEY_DIR?.trim();
  if (envKeyDir) return resolve(envKeyDir);
  return resolve(globalConfigBaseDir(), "tawassul");
}


export function hmacKeyFileExists(): boolean {
  try {
    if (existsSync(resolve(getKeyDir(), HMAC_KEY_FILE))) return true;
  } catch {

  }
  try {
    return existsSync(resolve(getLegacyKeyDir(), HMAC_KEY_FILE));
  } catch {
    return false;
  }
}


export class HmacKeyUnavailableError extends Error {
  constructor(keyFile: string) {
    super(
      `HMAC key not found at env-configured path (${keyFile}). ` +
        "TAWASSUL_HMAC_KEY_DIR is read-only: it must point at an existing key file. " +
        "Unset it to let Tawassul manage the key under ~/.config/tawassul.",
    );
    this.name = "HmacKeyUnavailableError";
  }
}

function sleepSync(ms: number): void {
  
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {

    }
  }
}


function createKeyExclusive(keyFile: string, keyBytes: Buffer, isSelfHeal = false): Buffer {
  let fh: number;
  try {
    fh = openSync(keyFile, "wx", 0o600);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      
      let content: Buffer;
      try {
        content = readFileSync(keyFile);
      } catch {
        content = Buffer.alloc(0);
      }
      if (content.length === 0) {
        for (let i = 0; i < 10; i++) {
          sleepSync(10);
          try {
            content = readFileSync(keyFile);
          } catch {
            content = Buffer.alloc(0);
          }
          if (content.length > 0) break;
        }
        if (content.length === 0) {
          
          if (!isSelfHeal) {
            try {
              unlinkSync(keyFile);
            } catch {

            }
            return createKeyExclusive(keyFile, keyBytes, true);
          }
          throw new Error(`HMAC key at ${keyFile} stayed empty after 100ms poll`, { cause: e });
        }
      }
      if (content.length !== KEY_LENGTH) {
        throw new Error(`HMAC key at ${keyFile} is ${content.length} bytes; expected ${KEY_LENGTH}`, { cause: e });
      }
      return content;
    }
    throw e; 
  }
  try {
    writeSync(fh, keyBytes);
    fsyncSync(fh);
  } finally {
    closeSync(fh);
  }
  return keyBytes;
}

function getLegacyKeyDir(): string {
  
  
  return globalConfigDir();
}

function loadOrCreateHmacKey(): Buffer {
  
  
  
  
  
  const iso = evaluateIsolationSync();
  if (iso.isolated) {
    _cachedHmacKey = SENTINEL_HMAC_KEY;
    return SENTINEL_HMAC_KEY;
  }
  
  
  if (isSentinelKey(_cachedHmacKey)) {
    _cachedHmacKey = null;
  }
  if (_cachedHmacKey) return _cachedHmacKey;

  const keyDir = getKeyDir();
  const hmacKeyFile = resolve(keyDir, HMAC_KEY_FILE);

  
  
  
  const envKeyDir = process.env.TAWASSUL_HMAC_KEY_DIR?.trim();
  if (envKeyDir && !existsSync(hmacKeyFile)) {
    throw new HmacKeyUnavailableError(hmacKeyFile);
  }

  
  
  if (_detectOnly) {
    if (existsSync(hmacKeyFile)) {
      const k = readFileSync(hmacKeyFile);
      if (k.length !== KEY_LENGTH) {
        throw new Error(`HMAC key at ${hmacKeyFile} is ${k.length} bytes; expected ${KEY_LENGTH}`);
      }
      _cachedHmacKey = k;
      return k;
    }
    
    const legacyHmacKeyFile = resolve(getLegacyKeyDir(), HMAC_KEY_FILE);
    if (existsSync(legacyHmacKeyFile)) {
      const k = readFileSync(legacyHmacKeyFile);
      if (k.length === KEY_LENGTH) {
        _cachedHmacKey = k;
        return k;
      }
    }
    logger.warn(
      "⛔ HMAC key re-detect: no key file found — staying fail-safe (no silent regeneration). " +
        "Run outside the isolated context (or restore the host key) to resume writes.",
    );
    _cachedHmacKey = SENTINEL_HMAC_KEY;
    return SENTINEL_HMAC_KEY;
  }

  
  if (!existsSync(keyDir)) {
    mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  }

  
  if (existsSync(hmacKeyFile)) {
    _cachedHmacKey = readFileSync(hmacKeyFile);
    if (_cachedHmacKey.length !== KEY_LENGTH) {
      throw new Error(`HMAC key at ${hmacKeyFile} is ${_cachedHmacKey.length} bytes; expected ${KEY_LENGTH}`);
    }
    return _cachedHmacKey;
  }

  
  const legacyKeyDir = getLegacyKeyDir();
  const legacyHmacKeyFile = resolve(legacyKeyDir, HMAC_KEY_FILE);
  if (existsSync(legacyHmacKeyFile)) {
    try {
      const legacyKey = readFileSync(legacyHmacKeyFile);
      
      _cachedHmacKey = createKeyExclusive(hmacKeyFile, legacyKey);
      logger.debug(`Migrated HMAC key from legacy location: ${legacyHmacKeyFile} → ${hmacKeyFile}`);
      return _cachedHmacKey;
    } catch {

    }
  }

  
  const oldKeyFile = resolve(legacyKeyDir, OLD_KEY_FILE);
  try {
    const oldKey = readFileSync(oldKeyFile);

    
    const oldKeyBak = oldKeyFile + ".bak";
    try {
      writeFileSync(oldKeyBak, oldKey, { mode: 0o600 });
    } catch {

    }

    
    
    _cachedHmacKey = createHmac("sha256", oldKey).update("tawassul-hmac-v1").digest();

    
    _cachedHmacKey = createKeyExclusive(hmacKeyFile, _cachedHmacKey);
    logger.debug("Migrated HMAC key from old encryption key");

    
    
    try {
      rmSync(oldKeyFile);
    } catch {

    }
    try {
      rmSync(oldKeyBak);
    } catch {

    }
    try {
      rmSync(resolve(legacyKeyDir, OLD_SALT_FILE));
    } catch {

    }
    try {
      rmSync(resolve(legacyKeyDir, OLD_VERSION_FILE));
    } catch {

    }
    logger.debug("Cleaned up old encryption key files and backup");

    return _cachedHmacKey;
  } catch (error) {
    
    
    
    
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {

    } else {
      throw error;
    }
  }

  
  _cachedHmacKey = createKeyExclusive(hmacKeyFile, randomBytes(KEY_LENGTH));
  logger.debug("New HMAC key generated at", hmacKeyFile);

  return _cachedHmacKey;
}


export function hmacSign(payload: string): string {
  const key = loadOrCreateHmacKey();
  if (isSentinelKey(key)) {
    throw new HmacKeyIsolationError();
  }
  return createHmac(HMAC_ALGORITHM, key).update(payload, "utf-8").digest("hex");
}


export function hmacVerify(payload: string, signature: string): boolean {
  const key = loadHmacKeyReadOnly();
  if (!key) return false;
  const expected = createHmac(HMAC_ALGORITHM, key).update(payload, "utf-8").digest("hex");
  if (!/^[0-9a-f]{64}$/.test(signature) || expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}


function loadExistingHmacKey(): Buffer | null {
  const candidates = [resolve(getKeyDir(), HMAC_KEY_FILE), resolve(getLegacyKeyDir(), HMAC_KEY_FILE)];
  for (const keyFile of candidates) {
    try {
      if (!existsSync(keyFile)) continue;
      const k = readFileSync(keyFile);
      if (k.length === KEY_LENGTH) return k;
    } catch {

    }
  }
  return null;
}


function loadHmacKeyReadOnly(): Buffer | null {
  if (evaluateIsolationSync().isolated) return null;
  if (_cachedHmacKey && !isSentinelKey(_cachedHmacKey)) return _cachedHmacKey;
  const k = loadExistingHmacKey();
  if (k) _cachedHmacKey = k;
  return k;
}


export function hmacVerifyReadOnly(payload: string, signature: string): boolean {
  const key = loadExistingHmacKey();
  if (!key) return false;
  const expected = createHmac(HMAC_ALGORITHM, key).update(payload, "utf-8").digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}


export function resetHmacKeyCache(): void {
  _cachedHmacKey = null;
  _detectOnly = true;
}


export function isHmacIsolationActive(): boolean {
  if (isSentinelKey(_cachedHmacKey)) return true;
  return evaluateIsolationSync().isolated;
}


export function wrapWithHmac(jsonPayload: string): string {
  const signature = hmacSign(jsonPayload);
  return `${HMAC_PREFIX}${signature}:${jsonPayload}`;
}


export function isHmacSigned(signedData: string): boolean {
  return signedData.startsWith(HMAC_PREFIX) || LEGACY_HMAC_PREFIXES.some((p) => signedData.startsWith(p));
}


export function unwrapWithHmac(signedData: string): string | null {
  return unwrapWithHmacImpl(signedData, false);
}


export function unwrapWithHmacReadOnly(signedData: string): string | null {
  return unwrapWithHmacImpl(signedData, true);
}

function unwrapWithHmacImpl(signedData: string, readOnly: boolean): string | null {
  const verify = readOnly ? hmacVerifyReadOnly : hmacVerify;
  
  if (signedData.startsWith(HMAC_PREFIX)) {
    const rest = signedData.slice(HMAC_PREFIX.length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return null;
    const signature = rest.slice(0, colonIdx);
    const payload = rest.slice(colonIdx + 1);
    if (!verify(payload, signature)) {
      logger.warn("🔐 HMAC signature verification FAILED — file may be tampered with");
      return null;
    }
    return payload;
  }

  
  for (const oldPrefix of LEGACY_HMAC_PREFIXES) {
    if (signedData.startsWith(oldPrefix)) {
      const rest = signedData.slice(oldPrefix.length);
      const colonIdx = rest.indexOf(":");
      if (colonIdx === -1) return null;
      const signature = rest.slice(0, colonIdx);
      const payload = rest.slice(colonIdx + 1);
      if (!verify(payload, signature)) {
        logger.warn("🔐 HMAC signature verification FAILED (legacy prefix) — file may be tampered with");
        return null;
      }
      logger.warn("⚠️ Legacy HMAC prefix detected — file will be re-signed with current prefix on next save");
      return payload;
    }
  }

  
  logger.warn("⛔ Rejected UNSIGNED state file — HMAC signature required for integrity.");
  return null;
}


export function secureId(): string {
  return randomBytes(4).toString("hex");
}


export function secureRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}
