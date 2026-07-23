import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { createSkillMarkdown } from "../src/skill.js";

// The committed SKILL.md is a PUBLISHED artifact (listed in package.json
// "files") generated from src/skill.ts. CI runs `build:skill -- --check` as
// the drift guard; this test is the same guard at `pnpm test` speed, so a
// src/skill.ts edit without a regenerate fails locally too.
describe("skills/jira-axi/SKILL.md", () => {
  it("matches createSkillMarkdown() (run `pnpm run build:skill` if this fails)", async () => {
    const committed = await readFile(
      new URL("../skills/jira-axi/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(createSkillMarkdown());
  });
});
