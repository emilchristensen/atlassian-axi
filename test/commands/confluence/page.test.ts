import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfluenceFetch } from "../../../src/confluence.js";
import { pageCommand, PAGE_HELP } from "../../../src/commands/confluence/page.js";
import {
  confluenceCommand,
  CONFLUENCE_HELP,
} from "../../../src/commands/confluence/index.js";
import {
  makeConfluenceFake,
  onPath,
  type FetchCall,
} from "../../helpers/confluenceFake.js";
import {
  FROZEN_NOW,
  pageCreatedPayload,
  pagePayload,
  pagePayloadUpdated,
  pagesLookupEmptyPayload,
  pagesLookupHitPayload,
  spacesPayload,
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  tmp = mkdtempSync(join(tmpdir(), "axi-page-"));
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

const getPage = onPath("GET", "/wiki/api/v2/pages/12345");
const spacesLookup = onPath("GET", "/wiki/api/v2/spaces");
const pagesLookup = onPath("GET", "/wiki/api/v2/pages");

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

describe("confluence router", () => {
  it("returns CONFLUENCE_HELP for no resource and for --help", async () => {
    expect(await confluenceCommand([])).toBe(CONFLUENCE_HELP);
    expect(await confluenceCommand(["--help"])).toBe(CONFLUENCE_HELP);
  });

  it("rejects an unknown resource with a help pointer", async () => {
    const out = await confluenceCommand(["bogus"]);
    expect(out).toContain("Unknown confluence resource: bogus");
    expect(out).toContain("VALIDATION_ERROR");
  });

  it("strips --site before routing so its value is never a positional", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await confluenceCommand(["--site", "other.atlassian.net", "page", "get", "12345"]);
    expect(calls[0].url.pathname).toBe("/wiki/api/v2/pages/12345");
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("page get", () => {
  it("renders the TOON detail from the recorded fixture (contract snapshot)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["get", "12345"]);
    expect(out).toMatchInlineSnapshot(`
      "page:
        id: "12345"
        title: Release notes
        status: current
        spaceId: "111"
        parentId: "10001"
        version: 4
        updated: 1d ago
        body: <p>Release notes for the July drop.</p>
      help[2]:
        Run \`atlassian-axi confluence page update 12345 --body-file <path>\` to edit it
        Run \`atlassian-axi confluence search "<CQL>"\` to find related pages"
    `);
  });

  it("requests the storage body by default and adf via --format adf", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);

    await pageCommand(["get", "12345"]);
    expect(calls[0].url.searchParams.get("body-format")).toBe("storage");

    await pageCommand(["get", "12345", "--format", "adf"]);
    expect(calls[1].url.searchParams.get("body-format")).toBe(
      "atlas_doc_format",
    );
  });

  it("rejects an invalid --format", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(
      pageCommand(["get", "12345", "--format", "wiki"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("truncates a long body with a --full hint, and --full disables it", async () => {
    const longBody = `<p>${"x".repeat(900)}</p>`;
    const payload = {
      ...pagePayload,
      body: { storage: { representation: "storage", value: longBody } },
    };
    const { fetchImpl } = makeConfluenceFake([
      { match: getPage, result: payload },
    ]);
    setConfluenceFetch(fetchImpl);

    const truncated = await pageCommand(["get", "12345"]);
    expect(truncated).toContain("truncated");
    expect(truncated).toContain("--full");

    const full = await pageCommand(["get", "12345", "--full"]);
    expect(full).toContain("x".repeat(900));
    expect(full).not.toContain("truncated");
  });

  it("accepts flags before the positional id", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await pageCommand(["get", "--format", "storage", "12345"]);
    expect(calls[0].url.pathname).toBe("/wiki/api/v2/pages/12345");
  });

  it("requires the page id", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(pageCommand(["get"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("returns help for get --help without hitting the API", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([]);
    setConfluenceFetch(fetchImpl);
    expect(await pageCommand(["get", "--help"])).toBe(PAGE_HELP);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("page create", () => {
  function createRoutes(lookup: unknown) {
    return [
      { match: spacesLookup, result: spacesPayload },
      { match: pagesLookup, result: lookup },
      {
        match: onPath("POST", "/wiki/api/v2/pages"),
        result: pageCreatedPayload,
      },
      {
        match: onPath("GET", "/wiki/api/v2/pages/67890"),
        result: pageCreatedPayload,
      },
    ];
  }

  it("resolves the space key to spaceId and POSTs the storage body", async () => {
    const { fetchImpl, calls } = makeConfluenceFake(
      createRoutes(pagesLookupEmptyPayload),
    );
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand([
      "create",
      "--space",
      "ENG",
      "--title",
      "New page",
      "--body",
      "<p>Fresh page from the CLI.</p>",
    ]);

    const post = calls.find((c: FetchCall) => c.method === "POST");
    expect(post?.body).toEqual({
      spaceId: "111",
      status: "current",
      title: "New page",
      body: {
        representation: "storage",
        value: "<p>Fresh page from the CLI.</p>",
      },
    });
    expect(out).toContain('id: "67890"');
    expect(out).toContain("title: New page");
    expect(out).toContain("confluence page get 67890");
  });

  it("passes --parent through as parentId", async () => {
    const { fetchImpl, calls } = makeConfluenceFake(
      createRoutes(pagesLookupEmptyPayload),
    );
    setConfluenceFetch(fetchImpl);
    await pageCommand([
      "create",
      "--space",
      "ENG",
      "--title",
      "New page",
      "--parent",
      "10001",
      "--body",
      "<p>x</p>",
    ]);
    const post = calls.find((c: FetchCall) => c.method === "POST");
    expect((post?.body as { parentId?: string }).parentId).toBe("10001");
  });

  it("reads the body from --body-file", async () => {
    const file = join(tmp, "body.html");
    writeFileSync(file, "<p>from file</p>");
    const { fetchImpl, calls } = makeConfluenceFake(
      createRoutes(pagesLookupEmptyPayload),
    );
    setConfluenceFetch(fetchImpl);
    await pageCommand([
      "create",
      "--space",
      "ENG",
      "--title",
      "New page",
      "--body-file",
      file,
    ]);
    const post = calls.find((c: FetchCall) => c.method === "POST");
    expect(
      (post?.body as { body: { value: string } }).body.value,
    ).toBe("<p>from file</p>");
  });

  it("is idempotent: an existing same-title page is reported, not duplicated", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: spacesLookup, result: spacesPayload },
      { match: pagesLookup, result: pagesLookupHitPayload },
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand([
      "create",
      "--space",
      "ENG",
      "--title",
      "Release notes",
      "--body",
      "<p>dupe</p>",
    ]);

    expect(out).toContain("message: Already exists in ENG");
    expect(calls.every((c: FetchCall) => c.method === "GET")).toBe(true);
  });

  it("fails with NOT_FOUND and a space-list hint for an unknown space key", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: spacesLookup, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(
      pageCommand([
        "create",
        "--space",
        "NOPE",
        "--title",
        "T",
        "--body",
        "<p>x</p>",
      ]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists every missing required flag", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(pageCommand(["create"])).rejects.toThrow(
      /--space, --title, --body\/--body-file/,
    );
  });

  it("does not let a --body value of --help hijack into help output", async () => {
    const { fetchImpl, calls } = makeConfluenceFake(
      createRoutes(pagesLookupEmptyPayload),
    );
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand([
      "create",
      "--space",
      "ENG",
      "--title",
      "New page",
      "--body",
      "--help",
    ]);
    expect(out).not.toBe(PAGE_HELP);
    expect(calls.some((c: FetchCall) => c.method === "POST")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("page update", () => {
  it("bumps the version and PUTs merged title/body, then re-fetches", async () => {
    let putSeen = false;
    const { fetchImpl, calls } = makeConfluenceFake([
      {
        match: (c: FetchCall) =>
          c.method === "PUT" && c.url.pathname === "/wiki/api/v2/pages/12345",
        result: pagePayloadUpdated,
      },
      {
        match: getPage,
        // First GET returns v4; the post-mutation re-fetch returns v5.
        get result() {
          if (!putSeen) return pagePayload;
          return pagePayloadUpdated;
        },
      },
    ]);
    setConfluenceFetch((url, init) => {
      if (init?.method === "PUT") putSeen = true;
      return fetchImpl(url, init);
    });

    const out = await pageCommand([
      "update",
      "12345",
      "--body",
      "<p>Release notes for the July drop, amended.</p>",
    ]);

    const put = calls.find((c: FetchCall) => c.method === "PUT");
    expect(put?.body).toEqual({
      id: "12345",
      status: "current",
      title: "Release notes",
      body: {
        representation: "storage",
        value: "<p>Release notes for the July drop, amended.</p>",
      },
      version: { number: 5 },
    });
    expect(out).toContain("version: 5");
    expect(out).toContain("amended");
  });

  it("is idempotent: identical title and body is a no-op success", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand([
      "update",
      "12345",
      "--title",
      "Release notes",
      "--body",
      "<p>Release notes for the July drop.</p>",
    ]);

    expect(out).toContain("message: Already up to date");
    expect(calls.every((c: FetchCall) => c.method === "GET")).toBe(true);
  });

  it("rejects an update with no changes specified", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(pageCommand(["update", "12345"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("accepts flags before the positional id (title-only update)", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      {
        match: (c: FetchCall) => c.method === "PUT",
        result: pagePayloadUpdated,
      },
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await pageCommand(["update", "--title", "Renamed", "12345"]);
    const put = calls.find((c: FetchCall) => c.method === "PUT");
    expect(put?.url.pathname).toBe("/wiki/api/v2/pages/12345");
    expect((put?.body as { title: string }).title).toBe("Renamed");
    // Unchanged body is carried over so the PUT never blanks it.
    expect((put?.body as { body: { value: string } }).body.value).toBe(
      "<p>Release notes for the July drop.</p>",
    );
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("page delete", () => {
  it("deletes after a read and reports what was deleted", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
      {
        match: (c: FetchCall) =>
          c.method === "DELETE" &&
          c.url.pathname === "/wiki/api/v2/pages/12345",
        result: { status: 204 },
      },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["delete", "12345"]);
    expect(out).toContain("message: Deleted");
    expect(out).toContain("title: Release notes");
    expect(calls.some((c: FetchCall) => c.method === "DELETE")).toBe(true);
  });

  it("is idempotent: deleting an already-gone page is a no-op success", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: { status: 404, body: {} } },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["delete", "12345"]);
    expect(out).toContain("message: Already deleted");
    expect(calls.some((c: FetchCall) => c.method === "DELETE")).toBe(false);
  });
});
