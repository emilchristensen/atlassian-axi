import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setConfluenceFetch } from "../../../src/confluence.js";
import {
  spaceCommand,
  SPACE_HELP,
} from "../../../src/commands/confluence/space.js";
import { makeConfluenceFake, onPath } from "../../helpers/confluenceFake.js";
import {
  spacesPayload,
  spacesPayloadWithNext,
} from "../../fixtures/confluence.js";

const ENV_KEYS = [
  "ATLASSIAN_SITE",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_API_TOKEN",
  "ATLASSIAN_AXI_NO_KEYCHAIN",
  "XDG_CONFIG_HOME",
] as const;
let savedEnv: Record<string, string | undefined>;
let tmp: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  tmp = mkdtempSync(join(tmpdir(), "axi-space-"));
  process.env["ATLASSIAN_SITE"] = "example.atlassian.net";
  process.env["ATLASSIAN_EMAIL"] = "me@acme.com";
  process.env["ATLASSIAN_API_TOKEN"] = "test-token";
  process.env["ATLASSIAN_AXI_NO_KEYCHAIN"] = "1";
  process.env["XDG_CONFIG_HOME"] = tmp;
});

afterEach(() => {
  setConfluenceFetch(null);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

const spacesRoute = onPath("GET", "/wiki/api/v2/spaces");

describe("space list", () => {
  it("renders the TOON list from the recorded fixture (contract snapshot)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: spacesRoute, result: spacesPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await spaceCommand(["list"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2
      spaces[2]{key,name,type,id}:
        ENG,Engineering,global,"111"
        DOCS,Documentation,global,"222"
      help[2]:
        Run \`atlassian-axi confluence search "space = <KEY> AND type = page"\` to list a space's pages
        Run \`atlassian-axi confluence page create --space <KEY> --title "..." --body-file <path>\` to create a page"
    `);
  });

  it("passes --limit through and flags a truncated result via the next cursor", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: spacesRoute, result: spacesPayloadWithNext },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await spaceCommand(["list", "--limit", "2"]);
    expect(calls[0].url.searchParams.get("limit")).toBe("2");
    expect(out).toContain("count: 2 (showing first 2)");
  });

  it("suggests an auth check when no spaces are visible", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: spacesRoute, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await spaceCommand(["list"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("auth status");
  });

  it("rejects an invalid --limit", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(
      spaceCommand(["list", "--limit", "nope"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns help for no subcommand, --help, and an unknown subcommand errors", async () => {
    expect(await spaceCommand([])).toBe(SPACE_HELP);
    expect(await spaceCommand(["--help"])).toBe(SPACE_HELP);
    expect(await spaceCommand(["list", "--help"])).toBe(SPACE_HELP);
    const out = await spaceCommand(["bogus"]);
    expect(out).toContain("Unknown space subcommand: bogus");
  });
});
