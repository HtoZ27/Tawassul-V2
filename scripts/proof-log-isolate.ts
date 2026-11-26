import { join } from "node:path";
import { tmpdir } from "node:os";

if (process.env.TAWASSUL_LOG_FILE === undefined) {
  process.env.TAWASSUL_LOG_FILE = join(tmpdir(), `tawassul-proof-${process.pid}.log`);
}
