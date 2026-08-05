import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { createSkillMarkdown } from "../src/skill.js";

const SKILL_URL = new URL("../skills/confluence-axi/SKILL.md", import.meta.url);

type Frontmatter = Record<string, string | boolean>;

/**
 * Minimal typed parse of the frontmatter block, enough for the scalars a skill
 * installer reads. Nested blocks (`metadata:`) are skipped; a line that is not
 * a well-formed `key: value` scalar, or a quoted scalar that does not close, is
 * a hard error rather than a silently wrong value.
 */
function parseFrontmatter(markdown: string): Frontmatter {
  const delimited = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!delimited) throw new Error("no delimited frontmatter block");

  const parsed: Frontmatter = {};
  for (const line of delimited[1].split("\n")) {
    if (line === "" || line.startsWith(" ")) continue;
    const separator = line.indexOf(": ");
    if (separator > 0) {
      const key = line.slice(0, separator);
      parsed[key] = parseScalar(key, line.slice(separator + 2));
      continue;
    }
    if (!line.endsWith(":")) throw new Error(`malformed line: ${line}`);
  }
  return parsed;
}

function parseScalar(key: string, raw: string): string | boolean {
  if (raw === "true" || raw === "false") return raw === "true";
  if (!raw.startsWith('"')) {
    if (raw.includes(": ")) throw new Error(`unquoted colon in ${key}: ${raw}`);
    return raw;
  }
  if (!/^"([^"\\]|\\.)*"$/.test(raw)) {
    throw new Error(`unterminated quoted value for ${key}: ${raw}`);
  }
  return raw.slice(1, -1).replace(/\\(.)/g, "$1");
}

// The committed SKILL.md is a PUBLISHED artifact (listed in package.json
// "files") generated from src/skill.ts. CI runs `build:skill -- --check` as
// the drift guard; this test is the same guard at `pnpm test` speed, so a
// src/skill.ts edit without a regenerate fails locally too.
describe("skills/confluence-axi/SKILL.md", () => {
  it("matches createSkillMarkdown() (run `pnpm run build:skill` if this fails)", async () => {
    const committed = await readFile(SKILL_URL, "utf8");
    expect(committed).toBe(createSkillMarkdown());
  });

  // The frontmatter is the machine-consumed contract an agent harness reads to
  // decide whether to load the skill at all, so it is asserted semantically:
  // the drift guard above would happily agree with identically broken YAML.
  it("carries frontmatter a skill installer can load", async () => {
    const frontmatter = parseFrontmatter(await readFile(SKILL_URL, "utf8"));

    expect(frontmatter.name).toBe("confluence-axi");
    expect(typeof frontmatter.description).toBe("string");
    expect(frontmatter.description).not.toBe("");
    expect(frontmatter["user-invocable"]).toBe(false);
  });
});
