import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { UsageLedger } from "../../../src/services/usage-ledger.ts";

const source = join(homedir(), ".local", "share", "tawassul-v2", "usage-ledger.jsonl");
const work = mkdtempSync(join(tmpdir(), "tawassul-live-reload-"));
const copy = join(work, "usage-ledger.jsonl");
try {
  copyFileSync(source, copy);
  if (existsSync(`${source}.1`)) copyFileSync(`${source}.1`, `${copy}.1`);
  const ledger = new UsageLedger({ path: copy, now: () => 1_760_000_000_000 });
  await ledger.start();
  const s = ledger.summary();
  console.log(JSON.stringify({
    rows: s.rows, usageRows: s.usageRows, injectionRows: s.injectionRows, injectionBytes: s.injectionBytes,
    shadowRows: s.shadowRows, noAgentRows: s.noAgentRows, sessions: s.sessions, roots: s.roots,
    children: s.children, lineageUnknown: s.lineageUnknown, priced: s.pricedSessions, unpriced: s.unpricedSessions,
    unit: s.unit, root: s.root, child: s.child, lastEventAt: s.lastEventAt,
  }, null, 1));
  await ledger.dispose();
} finally {
  rmSync(work, { recursive: true, force: true });
}
