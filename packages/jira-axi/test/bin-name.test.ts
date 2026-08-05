import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = new URL("../src/", import.meta.url).pathname;

/**
 * Help text, suggestions, examples and error messages must name the real
 * binary (`jira-axi`), never a bare `jira` - an agent that reads a bare
 * prefix runs a command that does not exist. Matches a quote or backtick
 * (including the escaped \` inside template-literal help docs) directly
 * followed by the bare name and a space, which is how every past instance
 * of this defect appeared; `jira-axi ...` never matches because the dash
 * follows immediately.
 */
const BARE_BIN_PREFIX = /[`"'](jira|confluence) /;

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return tsFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("bin name in user-visible strings", () => {
  it("never names a bare `jira` or `confluence` binary in src", async () => {
    const files = await tsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const match = BARE_BIN_PREFIX.exec(content);
      expect(
        match,
        `${file} names a bare \`${match?.[1]}\` binary; use \`${match?.[1]}-axi\``,
      ).toBeNull();
    }
  });
});
