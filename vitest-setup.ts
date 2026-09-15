import crypto from "node:crypto";
import { setLanguage } from "./translations.ts";


setLanguage("en");

if (!globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}
