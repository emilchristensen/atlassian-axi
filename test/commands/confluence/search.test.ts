import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfluenceFetch } from "../../../src/confluence.js";
import {
  searchCommand,
  SEARCH_HELP,
} from "../../../src/commands/confluence/search.js";
import { confluenceCommand } from "../../../src/commands/confluence/index.js";
import { makeConfluenceFake, onPath } from "../../helpers/confluenceFake.js";
import { FROZEN_NOW, searchPayload } from "../../fixtures/confluence.js";

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
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  tmp = mkdtempSync(join(tmpdir(), "axi-search-"));
  process.env["ATLASSIAN_SITE"] = "example.atlassian.net";
  process.env["ATLASSIAN_EMAIL"] = "me@acme.com";
  process.env["ATLASSIAN_API_TOKEN"] = "test-token";
  process.env["ATLASSIAN_AXI_NO_KEYCHAIN"] = "1";
  process.env["XDG_CONFIG_HOME"] = tmp;
});

afterEach(() => {
  setConfluenceFetch(null);
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

const searchRoute = onPath("GET", "/wiki/rest/api/search");

describe("confluence search", () => {
  it("renders the TOON results from the recorded fixture (contract snapshot)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: searchRoute, result: searchPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await searchCommand(["search", 'space = "ENG" AND type = page']);
    expect(out).toMatchInlineSnapshot(`
      "count: 2 of 2 total
      results[2]{id,type,title,space,modified,excerpt}:
        "12345",page,Release notes,Engineering,1d ago,Release notes for the July drop with the pagination fix.
        "67890",page,New page,Engineering,2h ago,Fresh page from the CLI.
      help[1]:
        Run \`atlassian-axi confluence page get <id>\` to read a result"
    `);
  });

  it("sends the CQL verbatim (URL-encoded) with the limit against the v1 endpoint", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: searchRoute, result: searchPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    await searchCommand([
      "search",
      "title ~ 'release notes' AND space = ENG",
      "--limit",
      "5",
    ]);
    const call = calls[0];
    expect(call.url.pathname).toBe("/wiki/rest/api/search");
    expect(call.url.searchParams.get("cql")).toBe(
      "title ~ 'release notes' AND space = ENG",
    );
    expect(call.url.searchParams.get("limit")).toBe("5");
  });

  it("strips highlight markers from titles and excerpts", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: searchRoute, result: searchPayload },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await searchCommand(["search", "text ~ 'release'"]);
    expect(out).not.toContain("@@@hl@@@");
    expect(out).not.toContain("@@@endhl@@@");
  });

  it("accepts --limit before the positional CQL", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: searchRoute, result: searchPayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await searchCommand(["search", "--limit", "5", "space = ENG"]);
    expect(calls[0].url.searchParams.get("cql")).toBe("space = ENG");
    expect(calls[0].url.searchParams.get("limit")).toBe("5");
  });

  it("routes through the confluence command with --site stripped", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: searchRoute, result: searchPayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await confluenceCommand([
      "search",
      "space = ENG",
      "--site",
      "other.atlassian.net",
    ]);
    expect(calls[0].url.searchParams.get("cql")).toBe("space = ENG");
  });

  it("suggests broadening the query when there are no hits", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: searchRoute, result: { results: [], totalSize: 0 } },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await searchCommand(["search", "text ~ 'nothing'"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("Broaden the CQL");
  });

  it("requires a CQL query", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(searchCommand(["search"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("returns help for --help without hitting the API", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([]);
    setConfluenceFetch(fetchImpl);
    expect(await searchCommand(["search", "--help"])).toBe(SEARCH_HELP);
    expect(calls).toHaveLength(0);
  });
});
