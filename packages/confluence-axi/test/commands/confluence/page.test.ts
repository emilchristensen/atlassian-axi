import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfluenceFetch } from "../../../src/confluence.js";
import { pageCommand, PAGE_HELP } from "../../../src/commands/confluence/page.js";
import { main } from "../../../src/cli.js";
import { setSiteOverride } from "../../../src/config.js";
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
// page router
// ---------------------------------------------------------------------------

describe("page router", () => {
  it("returns PAGE_HELP for no subcommand and for --help", async () => {
    expect(await pageCommand([])).toBe(PAGE_HELP);
    expect(await pageCommand(["--help"])).toBe(PAGE_HELP);
  });

  it("throws VALIDATION_ERROR on an unknown page subcommand", async () => {
    await expect(pageCommand(["gett"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown page subcommand: gett"),
    });
  });

  it("strips --site before routing so its value is never a positional", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
    ]);
    setConfluenceFetch(fetchImpl);
    try {
      await main({
        argv: ["page", "get", "12345", "--site", "other.atlassian.net"],
        stdout: { write: () => true },
      });
      expect(calls[0].url.pathname).toBe("/wiki/api/v2/pages/12345");
    } finally {
      setSiteOverride(undefined);
    }
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
      help[3]:
        Run \`confluence-axi page update 12345 --body-file <path>\` to edit it
        Run \`confluence-axi page children 12345\` to list its child pages
        Run \`confluence-axi search "<CQL>"\` to find related pages"
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

  it("rejects an unknown (typo'd) flag instead of misreading its value as the id", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(
      pageCommand(["get", "--formt", "storage", "12345"]),
    ).rejects.toThrow(/Unknown flag: --formt/);
  });

  it("rejects a second positional instead of silently ignoring it", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(pageCommand(["get", "12345", "678"])).rejects.toThrow(
      /Unexpected extra argument: 678/,
    );
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

  it("maps a POST 404 to FORBIDDEN (permission-masked 404), not not-found", async () => {
    // Space resolved and duplicate pre-check answered, so a 404 on the POST
    // itself is Confluence masking a missing create permission (live 2026-07-19).
    const { fetchImpl } = makeConfluenceFake([
      { match: spacesLookup, result: spacesPayload },
      { match: pagesLookup, result: pagesLookupEmptyPayload },
      {
        match: onPath("POST", "/wiki/api/v2/pages"),
        result: { status: 404, body: {} },
      },
    ]);
    setConfluenceFetch(fetchImpl);

    await expect(
      pageCommand([
        "create",
        "--space",
        "ENG",
        "--title",
        "Release notes",
        "--body",
        "<p>x</p>",
      ]),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("create permission"),
    });
  });

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
    expect(out).toContain("confluence-axi page get 67890");
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

  it("refuses --body swallowing a sibling flag as its value", async () => {
    // Without valueBoundaryFlags, `--body --title "T"` would write the
    // literal string "--title" as the page body (HIGH review finding).
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(
      pageCommand(["create", "--space", "ENG", "--body", "--title", "T"]),
    ).rejects.toThrow(/--body requires text/);
  });

  it("scopes the duplicate probe to current pages (archived must not dead-end create)", async () => {
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
      "--body",
      "<p>x</p>",
    ]);
    const probe = calls.find(
      (c: FetchCall) =>
        c.method === "GET" && c.url.pathname === "/wiki/api/v2/pages",
    );
    expect(probe?.url.searchParams.get("status")).toBe("current");
  });

  it("retries a lowercase space key uppercased before failing", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      {
        match: (c: FetchCall) =>
          c.url.pathname === "/wiki/api/v2/spaces" &&
          c.url.searchParams.get("keys") === "eng",
        result: { results: [] },
      },
      {
        match: (c: FetchCall) =>
          c.url.pathname === "/wiki/api/v2/spaces" &&
          c.url.searchParams.get("keys") === "ENG",
        result: spacesPayload,
      },
      { match: pagesLookup, result: pagesLookupEmptyPayload },
      {
        match: onPath("POST", "/wiki/api/v2/pages"),
        result: pageCreatedPayload,
      },
      {
        match: onPath("GET", "/wiki/api/v2/pages/67890"),
        result: pageCreatedPayload,
      },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand([
      "create",
      "--space",
      "eng",
      "--title",
      "New page",
      "--body",
      "<p>x</p>",
    ]);
    expect(out).toContain('id: "67890"');
    const keysTried = calls
      .filter((c: FetchCall) => c.url.searchParams.has("keys"))
      .map((c: FetchCall) => c.url.searchParams.get("keys"));
    expect(keysTried).toEqual(["eng", "ENG"]);
  });

  it("mentions case-sensitivity when a space key is not found", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: spacesLookup, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(
      pageCommand([
        "create",
        "--space",
        "nope",
        "--title",
        "T",
        "--body",
        "<p>x</p>",
      ]),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      suggestions: [
        expect.stringContaining("case-sensitive"),
        expect.anything(),
      ],
    });
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

  it("refuses --body swallowing --title instead of writing '--title' as the body", async () => {
    // HIGH review finding: `update 123 --body --title "New"` must not write
    // the literal string "--title" as the page body.
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(
      pageCommand(["update", "12345", "--body", "--title", "New"]),
    ).rejects.toThrow(/--body requires text/);
  });

  it("refuses a title-only update when the current body cannot be read (never wipes content)", async () => {
    // HIGH review finding: body-shape drift must not turn into PUT value:"".
    const pageWithoutBody = { ...pagePayload, body: undefined };
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: pageWithoutBody },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(
      pageCommand(["update", "12345", "--title", "Renamed"]),
    ).rejects.toThrow(/refusing to overwrite/);
    expect(calls.every((c: FetchCall) => c.method === "GET")).toBe(true);
  });

  it("still updates a genuinely empty (but present) body without refusing", async () => {
    const emptyBodyPage = {
      ...pagePayload,
      body: { storage: { representation: "storage", value: "" } },
    };
    const { fetchImpl, calls } = makeConfluenceFake([
      {
        match: (c: FetchCall) => c.method === "PUT",
        result: pagePayloadUpdated,
      },
      { match: getPage, result: emptyBodyPage },
    ]);
    setConfluenceFetch(fetchImpl);
    await pageCommand(["update", "12345", "--title", "Renamed"]);
    const put = calls.find((c: FetchCall) => c.method === "PUT");
    expect((put?.body as { body: { value: string } }).body.value).toBe("");
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

  it("treats a 404 on the DELETE itself (pre-read race) as already deleted", async () => {
    // First GET (pre-read) sees the page; after the DELETE 404s, the verify
    // re-read finds it gone — a genuine race, so still a no-op success.
    let gets = 0;
    const { fetchImpl } = makeConfluenceFake([
      { match: (c: FetchCall) => getPage(c) && ++gets === 1, result: pagePayload },
      { match: getPage, result: { status: 404, body: {} } },
      {
        match: (c: FetchCall) => c.method === "DELETE",
        result: { status: 404, body: {} },
      },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["delete", "12345"]);
    expect(out).toContain("message: Already deleted");
  });

  it("rethrows a failed verify probe instead of claiming Already deleted", async () => {
    // Pre-read ok, DELETE 404s, verify probe 500s: a network blip must never
    // be mistaken for a successful delete.
    let gets = 0;
    const { fetchImpl } = makeConfluenceFake([
      { match: (c: FetchCall) => getPage(c) && ++gets === 1, result: pagePayload },
      { match: getPage, result: { status: 500, body: {} } },
      {
        match: (c: FetchCall) => c.method === "DELETE",
        result: { status: 404, body: {} },
      },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(pageCommand(["delete", "12345"])).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });

  it("refuses to claim deletion when the DELETE 404s but the page still exists (permission-masked 404)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getPage, result: pagePayload },
      {
        match: (c: FetchCall) => c.method === "DELETE",
        result: { status: 404, body: {} },
      },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(pageCommand(["delete", "12345"])).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("still exists"),
    });
  });

  it("rejects a second positional instead of deleting the wrong page", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(pageCommand(["delete", "12345", "678"])).rejects.toThrow(
      /Unexpected extra argument: 678/,
    );
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

describe("page delete trash semantics (2026-07-19)", () => {
  it("treats an already-trashed page as Already deleted, not FORBIDDEN", async () => {
    // v2 GET answers a trashed page with 200 + status "trashed" (verified live).
    const trashed = { ...pagePayload, status: "trashed" };
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getPage, result: trashed },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["delete", "12345"]);
    expect(out).toContain("message: Already deleted (in trash)");
    expect(calls.some((c: FetchCall) => c.method === "DELETE")).toBe(false);
  });

  it("verify probe counts a trashed page as gone (race → Already deleted)", async () => {
    // Pre-read sees a live page; DELETE 404s; probe re-read finds it trashed
    // (deleted by someone else mid-flight) — still a no-op success.
    let gets = 0;
    const trashed = { ...pagePayload, status: "trashed" };
    const { fetchImpl } = makeConfluenceFake([
      { match: (c: FetchCall) => getPage(c) && ++gets === 1, result: pagePayload },
      { match: getPage, result: trashed },
      {
        match: (c: FetchCall) => c.method === "DELETE",
        result: { status: 404, body: {} },
      },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["delete", "12345"]);
    expect(out).toContain("message: Already deleted");
  });
});

describe("page update macro-loss guard (2026-07-19)", () => {
  // A page whose current body embeds a whiteboard macro.
  const embedBody =
    '<p>Intro.</p><ac:structured-macro ac:name="native-embed:whiteboard" ac:macro-id="m1"><ac:parameter ac:name="url">https://x/wb/1</ac:parameter></ac:structured-macro><p>Outro.</p>';
  const embedPage = {
    ...pagePayload,
    body: { storage: { representation: "storage", value: embedBody } },
  };

  function routes(putResult: unknown = embedPage) {
    let put = false;
    const fake = makeConfluenceFake([
      { match: (c: FetchCall) => c.method === "PUT", result: putResult },
      { match: getPage, get result() { return put ? putResult : embedPage; } },
    ]);
    const wrapped = (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") put = true;
      return fake.fetchImpl(url, init);
    };
    return { fetchImpl: wrapped, calls: fake.calls };
  }

  it("refuses a new body that drops the embedded macro (no PUT)", async () => {
    const { fetchImpl, calls } = routes();
    setConfluenceFetch(fetchImpl);
    await expect(
      pageCommand(["update", "12345", "--body", "<p>Just text.</p>"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("native-embed:whiteboard"),
    });
    expect(calls.some((c: FetchCall) => c.method === "PUT")).toBe(false);
  });

  it("allows a new body that keeps the macro (text around it changed)", async () => {
    const kept =
      '<p>Intro CHANGED.</p><ac:structured-macro ac:name="native-embed:whiteboard" ac:macro-id="m1"><ac:parameter ac:name="url">https://x/wb/1</ac:parameter></ac:structured-macro><p>Outro CHANGED.</p>';
    const { fetchImpl, calls } = routes({
      ...embedPage,
      body: { storage: { representation: "storage", value: kept } },
    });
    setConfluenceFetch(fetchImpl);
    await pageCommand(["update", "12345", "--body", kept]);
    expect(calls.some((c: FetchCall) => c.method === "PUT")).toBe(true);
  });

  it("drops the macro when --allow-macro-loss is passed", async () => {
    const { fetchImpl, calls } = routes({
      ...embedPage,
      body: { storage: { representation: "storage", value: "<p>Plain.</p>" } },
    });
    setConfluenceFetch(fetchImpl);
    await pageCommand([
      "update",
      "12345",
      "--body",
      "<p>Plain.</p>",
      "--allow-macro-loss",
    ]);
    expect(calls.some((c: FetchCall) => c.method === "PUT")).toBe(true);
  });

  it("does not trigger on a title-only edit (body untouched)", async () => {
    const { fetchImpl, calls } = routes({ ...embedPage, title: "Renamed" });
    setConfluenceFetch(fetchImpl);
    await pageCommand(["update", "12345", "--title", "Renamed"]);
    expect(calls.some((c: FetchCall) => c.method === "PUT")).toBe(true);
  });

  it("catches dropping one of two identical embeds (count-based identity)", async () => {
    const two =
      '<ac:structured-macro ac:name="native-embed:whiteboard" ac:macro-id="a"></ac:structured-macro><ac:structured-macro ac:name="native-embed:whiteboard" ac:macro-id="b"></ac:structured-macro>';
    const one =
      '<ac:structured-macro ac:name="native-embed:whiteboard" ac:macro-id="a"></ac:structured-macro>';
    const fake = makeConfluenceFake([
      { match: (c: FetchCall) => c.method === "PUT", result: pagePayload },
      {
        match: getPage,
        result: {
          ...pagePayload,
          body: { storage: { representation: "storage", value: two } },
        },
      },
    ]);
    setConfluenceFetch(fake.fetchImpl);
    await expect(
      pageCommand(["update", "12345", "--body", one]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does NOT count a macro-name literal inside CDATA as a kept macro (guard bypass)", async () => {
    // A real `toc` macro is dropped, but the new body embeds a code macro whose
    // CDATA sample text mentions `<ac:structured-macro ac:name="toc"/>`. That
    // literal must not satisfy the count and let the real macro be deleted.
    const current =
      '<ac:structured-macro ac:name="toc"/><p>Table of contents above.</p>';
    const next =
      '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[<ac:structured-macro ac:name="toc"/>]]></ac:plain-text-body></ac:structured-macro><p>Just a code sample.</p>';
    const fake = makeConfluenceFake([
      { match: (c: FetchCall) => c.method === "PUT", result: pagePayload },
      {
        match: getPage,
        result: {
          ...pagePayload,
          body: { storage: { representation: "storage", value: current } },
        },
      },
    ]);
    setConfluenceFetch(fake.fetchImpl);
    await expect(
      pageCommand(["update", "12345", "--body", next]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("toc"),
    });
    expect(fake.calls.some((c: FetchCall) => c.method === "PUT")).toBe(false);
  });

  it("accepts a kept macro re-quoted with single quotes (no false macro-loss)", async () => {
    // Confluence honours `ac:name='toc'`; a double-quote-only matcher would
    // falsely report it dropped and block a valid update.
    const current = '<ac:structured-macro ac:name="toc"/><p>Before.</p>';
    const next = "<ac:structured-macro ac:name='toc'/><p>After.</p>";
    let put = false;
    const fake = makeConfluenceFake([
      { match: (c: FetchCall) => c.method === "PUT", result: pagePayload },
      {
        match: getPage,
        get result() {
          return {
            ...pagePayload,
            body: {
              storage: {
                representation: "storage",
                value: put ? next : current,
              },
            },
          };
        },
      },
    ]);
    setConfluenceFetch((url, init) => {
      if (init?.method === "PUT") put = true;
      return fake.fetchImpl(url, init);
    });
    await pageCommand(["update", "12345", "--body", next]);
    expect(fake.calls.some((c: FetchCall) => c.method === "PUT")).toBe(true);
  });
});

describe("page id validation (path-traversal guard)", () => {
  it.each(["../folders/999", "1/../../admin", "123#x", "12 34", "abc"])(
    "rejects a non-numeric page id %j without any request",
    async (id) => {
      const { fetchImpl, calls } = makeConfluenceFake([]);
      setConfluenceFetch(fetchImpl);
      await expect(pageCommand(["get", id])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("Invalid page id"),
      });
      expect(calls).toHaveLength(0);
    },
  );

  it("rejects a crafted id on the destructive delete path too", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([]);
    setConfluenceFetch(fetchImpl);
    await expect(
      pageCommand(["delete", "../folders/999"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });
});

describe("page delete non-current status (permission-masked 404)", () => {
  it.each(["archived", "draft"])(
    "surfaces FORBIDDEN (not a false Already deleted) when a %s page's DELETE 404s",
    async (status) => {
      // Pre-read sees a live (non-trashed) page; DELETE 404s (permission mask);
      // the verify probe re-reads the same non-trashed status — the page still
      // exists, so this must be FORBIDDEN, never "Already deleted".
      const nonCurrent = { ...pagePayload, status };
      const { fetchImpl } = makeConfluenceFake([
        { match: getPage, result: nonCurrent },
        {
          match: (c: FetchCall) => c.method === "DELETE",
          result: { status: 404, body: {} },
        },
      ]);
      setConfluenceFetch(fetchImpl);
      await expect(pageCommand(["delete", "12345"])).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("still exists"),
      });
    },
  );
});

describe("page create space-key validation", () => {
  it("rejects a comma-containing --space instead of creating in an arbitrary space", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([]);
    setConfluenceFetch(fetchImpl);
    await expect(
      pageCommand([
        "create",
        "--space",
        "ENG,DOCS",
        "--title",
        "T",
        "--body",
        "<p>x</p>",
      ]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("space key"),
    });
    expect(calls).toHaveLength(0);
  });
});

describe("page get remote-content control-char neutralization", () => {
  it("strips C1/DEL controls from a crafted title and body", async () => {
    // U+009B is the 8-bit CSI, U+007F is DEL; TOON leaves the C1 range +
    // DEL through, so strip them upstream. Stripping must leave the real text.
    const csi = "\u009b";
    const del = "\u007f";
    const crafted = {
      ...pagePayload,
      title: `Rele${csi}ase`,
      body: {
        storage: { representation: "storage", value: `<p>a${csi}b${del}c</p>` },
      },
    };
    const { fetchImpl } = makeConfluenceFake([
      { match: getPage, result: crafted },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["get", "12345", "--full"]);
    expect(out).not.toContain(csi);
    expect(out).not.toContain(del);
    expect(out).toContain("Release");
    expect(out).toContain("<p>abc</p>");
  });
});
