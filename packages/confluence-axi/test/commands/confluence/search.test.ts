import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfluenceFetch } from "../../../src/confluence.js";
import {
  searchCommand,
  SEARCH_HELP,
} from "../../../src/commands/confluence/search.js";
import { main } from "../../../src/cli.js";
import { setSiteOverride } from "../../../src/config.js";
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
        Run \`confluence-axi page get <id>\` to read a result"
    `);
  });

  it("renders space-entity hits with the space key as id and entityType as type", async () => {
    // Space hits carry no `content` block (live shape 2026-07-19); the row
    // must not leak literal null/unknown.
    const spaceHit = {
      results: [
        {
          space: { key: "FTA", name: "FE Tech Authority", type: "global" },
          title: "FE Tech Authority",
          excerpt: "",
          entityType: "space",
          resultGlobalContainer: { title: "FE Tech Authority" },
          lastModified: "2026-07-01T00:00:00.000Z",
        },
      ],
      totalSize: 1,
    };
    const { fetchImpl } = makeConfluenceFake([
      { match: searchRoute, result: spaceHit },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await searchCommand(["search", "type = space"]);
    expect(out).toContain("FTA,space,FE Tech Authority");
    expect(out).not.toContain("null,unknown");
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

  it("does not hint `page get` on a truncated non-page excerpt", async () => {
    const longExcerpt = "y".repeat(300);
    const payload = {
      results: [
        {
          content: { id: "555", type: "blogpost", title: "A long blog post" },
          title: "A long blog post",
          excerpt: longExcerpt,
          resultGlobalContainer: { title: "Engineering" },
          lastModified: "2026-07-13T12:00:00.000Z",
        },
      ],
      totalSize: 1,
    };
    const { fetchImpl } = makeConfluenceFake([
      { match: searchRoute, result: payload },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await searchCommand(["search", "type = blogpost"]);
    expect(out).toContain("truncated");
    expect(out).not.toContain("page get <id> --full");
    expect(out).toContain("open the result in Confluence");
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

  it("routes through the CLI with --site stripped from the CQL", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: searchRoute, result: searchPayload },
    ]);
    setConfluenceFetch(fetchImpl);
    try {
      await main({
        argv: ["search", "space = ENG", "--site", "other.atlassian.net"],
        stdout: { write: () => true },
      });
      expect(calls[0].url.searchParams.get("cql")).toBe("space = ENG");
    } finally {
      setSiteOverride(undefined);
    }
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

describe("stripHighlights excerpt cleaning", () => {
  it("decodes HTML entities without double-decoding &amp;lt;", async () => {
    const { stripHighlights } = await import(
      "../../../src/commands/confluence/shared.js"
    );
    expect(stripHighlights("Q&amp;A &quot;quoted&quot; a&nbsp;b")).toBe(
      'Q&A "quoted" a b',
    );
    expect(stripHighlights("&amp;lt;")).toBe("&lt;");
  });

  it("drops lone surrogate halves from mid-codepoint truncation", async () => {
    const { stripHighlights } = await import(
      "../../../src/commands/confluence/shared.js"
    );
    expect(stripHighlights("emoji tail \uD83D")).toBe("emoji tail ");
    expect(stripHighlights("\uDE00 head")).toBe(" head");
    expect(stripHighlights("intact 😀")).toBe("intact 😀");
  });

  it("still strips the @@@hl@@@ markers", async () => {
    const { stripHighlights } = await import(
      "../../../src/commands/confluence/shared.js"
    );
    expect(stripHighlights("a\u009bb\u007fc")).toBe("abc");
  });
});

describe("search unquoted-CQL guard", () => {
  it("rejects a leftover positional instead of running a truncated query", async () => {
    // `search type=page AND space=ENG` (quotes forgotten) must not silently run
    // just "type=page" and return every space's pages with exit 0.
    const { fetchImpl, calls } = makeConfluenceFake([]);
    setConfluenceFetch(fetchImpl);
    await expect(
      searchCommand(["search", "type=page", "AND", "space=ENG"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unexpected extra argument"),
    });
    expect(calls).toHaveLength(0);
  });

  it("still accepts a properly quoted single-argument CQL with --limit", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: searchRoute, result: { results: [], totalSize: 0 } },
    ]);
    setConfluenceFetch(fetchImpl);
    await searchCommand([
      "search",
      "type=page AND space=ENG",
      "--limit",
      "5",
    ]);
    expect(calls[0].url.searchParams.get("cql")).toBe(
      "type=page AND space=ENG",
    );
    expect(calls[0].url.searchParams.get("limit")).toBe("5");
  });
});
