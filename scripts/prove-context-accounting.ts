import "./proof-log-isolate.ts";
import { byteLength, messageRequestBytes } from "../src/services/context-pack/accounting.ts";
import type { PackMessage } from "../src/services/context-pack/types.ts";

function fail(message: string): never {
  console.error(`PROOF FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function main(): void {
  eq(byteLength("a"), 1, "ascii byte");
  eq(byteLength("😀"), 4, "astral codepoint is 4 utf-8 bytes");
  if (byteLength("日本語") !== 9) fail("CJK must be 3 utf-8 bytes per codepoint");

  const arabic = Buffer.from([217, 133, 216, 177, 216, 173, 216, 168, 216, 167, 32, 216, 168, 216, 167, 217, 132, 216, 185, 216, 167, 217, 132, 217, 133]).toString("utf8");
  const cjk = Buffer.from([230, 151, 165, 230, 156, 172, 232, 170, 158, 227, 129, 174, 227, 131, 134, 227, 130, 173, 227, 130, 185, 227, 131, 136]).toString("utf8");
  eq(byteLength(arabic), Buffer.byteLength(arabic, "utf8"), "arabic accounting matches Buffer.byteLength");
  eq(byteLength(cjk), Buffer.byteLength(cjk, "utf8"), "CJK accounting matches Buffer.byteLength");
  if (byteLength(arabic) <= arabic.length) fail("arabic must cost more than one byte per character");

  const messages: PackMessage[] = [
    { role: "user", content: [{ type: "text", text: "ab" }] },
    { role: "user", content: [{ type: "image", mimeType: "image/png", url: "file:///tmp/a.png" }] },
    { role: "user", content: [{ type: "file", filename: "b.txt", url: "file:///tmp/b.txt" }] },
    { role: "assistant", content: "assistant text" },
    { role: "tool", content: [{ type: "text", text: "result body" }] },
  ];
  const total = messageRequestBytes(messages);
  eq(
    total,
    2 + 8192 + 4096 + byteLength("assistant text") + byteLength("result body"),
    "attachment charging",
  );
  eq(messageRequestBytes([]), 0, "empty history charges nothing");
  console.log("PROOF PASS: accounting is one byte per utf-8 byte");
}

main();
