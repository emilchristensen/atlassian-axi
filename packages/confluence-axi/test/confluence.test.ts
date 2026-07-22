import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confluenceJson, setConfluenceFetch } from "../src/confluence.js";
import { makeConfluenceFake, onPath } from "./helpers/confluenceFake.js";
import {
  errorBodyV1,
  errorBodyV2,
  errorBodyV2Anonymous404,
} from "./fixtures/confluence.js";

// The client resolves the unified credential itself; pin it via env so tests
// never touch the real keychain or config file (env wins over both, and the
// XDG override points config-file fallback at an empty temp dir).
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
  tmp = mkdtempSync(join(tmpdir(), "axi-confluence-"));
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

describe("confluenceJson", () => {
  it("builds the URL from the configured site with query params and basic auth", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: onPath("GET", "/wiki/api/v2/spaces"), result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);

    await confluenceJson("/wiki/api/v2/spaces", {
      query: { limit: 5, keys: "ENG", skipped: undefined },
    });

    const call = calls[0];
    expect(call.url.origin).toBe("https://example.atlassian.net");
    expect(call.url.searchParams.get("limit")).toBe("5");
    expect(call.url.searchParams.get("keys")).toBe("ENG");
    expect(call.url.searchParams.has("skipped")).toBe(false);
    const expectedBasic = Buffer.from("me@acme.com:test-token").toString(
      "base64",
    );
    expect(call.headers["Authorization"]).toBe(`Basic ${expectedBasic}`);
    expect(call.headers["Accept"]).toBe("application/json");
  });

  it("JSON-encodes the body and sets Content-Type on writes", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: onPath("POST", "/wiki/api/v2/pages"), result: { id: "1" } },
    ]);
    setConfluenceFetch(fetchImpl);

    await confluenceJson("/wiki/api/v2/pages", {
      method: "POST",
      body: { title: "T" },
    });

    expect(calls[0].body).toEqual({ title: "T" });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  it("throws AUTH_REQUIRED before any network call when the credential is missing", async () => {
    delete process.env["ATLASSIAN_API_TOKEN"];
    const { fetchImpl, calls } = makeConfluenceFake([]);
    setConfluenceFetch(fetchImpl);
    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(calls).toHaveLength(0);
  });

  it("returns undefined for a bodyless 204 (DELETE)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      {
        match: onPath("DELETE", "/wiki/api/v2/pages/12345"),
        result: { status: 204 },
      },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(
      confluenceJson("/wiki/api/v2/pages/12345", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "VALIDATION_ERROR"],
    [429, "RATE_LIMITED"],
    [500, "UNKNOWN"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const { fetchImpl } = makeConfluenceFake([
      { match: () => true, result: { status, body: {} } },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code,
    });
  });

  it("extracts the v2 error title into the message", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: () => true, result: { status: 404, body: errorBodyV2 } },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(confluenceJson("/wiki/api/v2/pages/999")).rejects.toThrow(
      /Page not found or viewer does not have permission/,
    );
  });

  it("suggests checking auth on a 404 (live-captured rejected-credential body)", async () => {
    // Confluence v2 answers a rejected Basic credential with this exact 404
    // body (live capture 2026-07-15) — the hint must not only steer users
    // toward "wrong page id".
    const { fetchImpl } = makeConfluenceFake([
      { match: () => true, result: { status: 404, body: errorBodyV2Anonymous404 } },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code: "NOT_FOUND",
      suggestions: expect.arrayContaining([
        expect.stringContaining("auth status"),
      ]),
    });
  });

  it("extracts the v1 error message into the message", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: () => true, result: { status: 400, body: errorBodyV1 } },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(confluenceJson("/wiki/rest/api/search")).rejects.toThrow(
      /Could not parse cql/,
    );
  });

  it("normalizes a scheme/trailing-slash ATLASSIAN_SITE before building the URL", async () => {
    process.env["ATLASSIAN_SITE"] = "https://example.atlassian.net/";
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: () => true, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    await confluenceJson("/wiki/api/v2/spaces");
    expect(calls[0].url.origin).toBe("https://example.atlassian.net");
    expect(calls[0].url.pathname).toBe("/wiki/api/v2/spaces");
  });

  it("falls back to a generic wait hint when Retry-After is an HTTP-date", async () => {
    const { fetchImpl } = makeConfluenceFake([
      {
        match: () => true,
        result: {
          status: 429,
          headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
        },
      },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      suggestions: ["Wait a moment and re-run the command"],
    });
  });

  it("surfaces Retry-After in the 429 suggestion", async () => {
    const { fetchImpl } = makeConfluenceFake([
      {
        match: () => true,
        result: { status: 429, headers: { "Retry-After": "30" } },
      },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      suggestions: [expect.stringContaining("30")],
    });
  });

  it("wraps a network-level failure without leaking the credential", async () => {
    setConfluenceFetch(async () => {
      throw new Error("getaddrinfo ENOTFOUND example.atlassian.net");
    });
    const rejection = expect(confluenceJson("/wiki/api/v2/spaces")).rejects;
    await rejection.toMatchObject({ code: "UNKNOWN" });
    await rejection.toThrow(/ENOTFOUND/);
    await rejection.not.toThrow(/test-token/);
  });

  it("throws UNKNOWN on a 200 with a non-JSON body", async () => {
    setConfluenceFetch(async () => new Response("<html>proxy</html>", { status: 200 }));
    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});

describe("site host validation (Basic-auth credential-exfil guard)", () => {
  it.each([
    "victim.atlassian.net@evil.com",
    "evil.com/wiki",
    "evil.com?x=1",
    "evil.com#frag",
  ])(
    "refuses to send the API token when the site %j is not a bare host",
    async (site) => {
      // A crafted site parses to a different origin host; the account-scoped
      // API token must never leave for it. No request must be made.
      process.env["ATLASSIAN_SITE"] = site;
      const { fetchImpl, calls } = makeConfluenceFake([
        { match: () => true, result: {} },
      ]);
      setConfluenceFetch(fetchImpl);
      await expect(
        confluenceJson("/wiki/api/v2/spaces"),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(calls).toHaveLength(0);
    },
  );

  it("still allows a legitimate bare host with an explicit port", async () => {
    process.env["ATLASSIAN_SITE"] = "example.atlassian.net:8443";
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: () => true, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    await confluenceJson("/wiki/api/v2/spaces");
    expect(calls[0].url.host).toBe("example.atlassian.net:8443");
  });
});
