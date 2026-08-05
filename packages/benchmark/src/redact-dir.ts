// Applies src/redact.ts substitutions in place to every file in a directory.
// Used to sanitize accuracy-run transcripts before they are committed:
//   pnpm run bench:redact -- <dir>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./redact.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: tsx src/redact-dir.ts <dir>");
  process.exit(2);
}

let changed = 0;
for (const name of readdirSync(dir)) {
  const path = join(dir, name);
  if (!statSync(path).isFile()) continue;
  const original = readFileSync(path, "utf8");
  const redacted = redact(original);
  if (redacted !== original) {
    writeFileSync(path, redacted);
    changed += 1;
  }
}
console.log(`redact-dir: ${changed} file(s) changed in ${dir}`);
