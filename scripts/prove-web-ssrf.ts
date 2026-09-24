import { isBlockedUrl } from "../src/tools/web.ts";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

const evil = [
  "http://127.0.0.1/",
  "http://0x7f.0.0.1/",
  "http://0177.0.0.1/",
  "http://2130706433/",
  "http://10.0.0.5/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://169.254.169.254/",
  "http://0.0.0.0/",
  "http://[::1]/",
  "http://[fc00::1]/",
  "http://[fe80::1]/",
  "http://[::ffff:127.0.0.2]/",
  "file:///etc/passwd",
];

const benign = ["https://example.com/", "https://8.8.8.8/", "https://1.1.1.1/"];

for (const url of evil) {
  if (isBlockedUrl(url) === null) fail(`evil url passed: ${url}`);
}
console.log(`evil ok (${evil.length} blocked)`);

for (const url of benign) {
  const reason = isBlockedUrl(url);
  if (reason !== null) fail(`benign url blocked: ${url} :: ${reason}`);
}
console.log(`benign ok (${benign.length} passed)`);

console.log("PROOF PASS: web SSRF CIDR backstop");
