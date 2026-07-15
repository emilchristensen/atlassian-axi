import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readOAuthSession,
  saveOAuthSession,
  type OAuthSession,
} from "../src/config.js";
import { confluenceJson, setConfluenceFetch } from "../src/confluence.js";
import { OAUTH_TOKEN_URL, setOAuthFetch } from "../src/oauth.js";
import { makeConfluenceFake, onPath } from "./helpers/confluenceFake.js";
import { tokenErrorPayload, tokenRefreshPayload } from "./fixtures/oauth.js";

// OAuth transport tests: the ONLY auth state is a persisted OAuth session in a
// temp config dir (no env token vars), so confluenceJson must pick the
// api.atlassian.com gateway + Bearer path.
const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "ATLASSIAN_SITE",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_API_TOKEN",
  "ATLASSIAN_AXI_NO_KEYCHAIN",
  "ATLASSIAN_AXI_OAUTH_CLIENT_SECRET",
] as const;
let savedEnv: Record<string, string | undefined>;
let tmp: string;

const CLOUD_ID = "11111111-2222-3333-4444-555555555555";
const GATEWAY_SPACES = `/ex/confluence/${CLOUD_ID}/wiki/api/v2/spaces`;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  tmp = mkdtempSync(join(tmpdir(), "axi-confluence-oauth-"));
  process.env["XDG_CONFIG_HOME"] = tmp;
  process.env["ATLASSIAN_AXI_NO_KEYCHAIN"] = "1";
});

afterEach(() => {
  setConfluenceFetch(null);
  setOAuthFetch(null);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

function seedSession(overrides: Partial<OAuthSession> = {}): OAuthSession {
  const session: OAuthSession = {
    clientId: "client-123",
    accessToken: "access-token-old",
    refreshToken: "refresh-token-initial",
    expiresAt: Date.now() + 3_600_000,
    cloudId: CLOUD_ID,
    site: "acme.atlassian.net",
    scopes: "read:confluence-content.all offline_access",
    clientSecret: "stored-secret",
    ...overrides,
  };
  saveOAuthSession(session);
  return session;
}

/** OAuth-endpoint fake that only answers the token URL. */
function stubRefresh(status = 200, payload: unknown = tokenRefreshPayload) {
  const calls: { body: unknown }[] = [];
  setOAuthFetch(async (url, init) => {
    if (url !== OAUTH_TOKEN_URL) {
      throw new Error(`Unexpected OAuth request: ${url}`);
    }
    calls.push({ body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(payload), { status });
  });
  return calls;
}

describe("confluenceJson over OAuth", () => {
  it("hits the api.atlassian.com gateway with a Bearer token", async () => {
    seedSession();
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: onPath("GET", GATEWAY_SPACES), result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);

    await confluenceJson("/wiki/api/v2/spaces");
    expect(calls[0]?.url.origin).toBe("https://api.atlassian.com");
    expect(calls[0]?.url.pathname).toBe(GATEWAY_SPACES);
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer access-token-old");
  });

  it("refreshes an expired token before the call and persists the rotation", async () => {
    seedSession({ expiresAt: Date.now() - 1_000 });
    const refreshCalls = stubRefresh();
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: onPath("GET", GATEWAY_SPACES), result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);

    await confluenceJson("/wiki/api/v2/spaces");
    expect(refreshCalls).toHaveLength(1);
    expect(calls[0]?.headers["Authorization"]).toBe(
      "Bearer access-token-refreshed",
    );
    // Atlassian rotates refresh tokens — the newest one must be on disk.
    expect(readOAuthSession()?.refreshToken).toBe("refresh-token-rotated");
  });

  it("retries exactly once with a fresh token on a 401", async () => {
    seedSession();
    stubRefresh();
    let attempts = 0;
    setConfluenceFetch(async (url, init) => {
      attempts += 1;
      const auth = (init?.headers as Record<string, string>)["Authorization"];
      if (auth === "Bearer access-token-old") {
        return new Response(JSON.stringify({ message: "expired" }), {
          status: 401,
        });
      }
      expect(auth).toBe("Bearer access-token-refreshed");
      expect(url).toContain(GATEWAY_SPACES);
      return new Response(JSON.stringify({ results: [{ id: "1" }] }), {
        status: 200,
      });
    });

    const payload = await confluenceJson<{ results: unknown[] }>(
      "/wiki/api/v2/spaces",
    );
    expect(attempts).toBe(2);
    expect(payload.results).toHaveLength(1);
  });

  it("surfaces AUTH_REQUIRED when the refresh itself is rejected", async () => {
    seedSession({ expiresAt: Date.now() - 1_000 });
    stubRefresh(403, tokenErrorPayload);
    setConfluenceFetch(async () => {
      throw new Error("must not reach Confluence with a dead token");
    });

    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("does not retry a second 401 endlessly", async () => {
    seedSession();
    stubRefresh();
    let attempts = 0;
    setConfluenceFetch(async () => {
      attempts += 1;
      return new Response(JSON.stringify({ message: "still unauthorized" }), {
        status: 401,
      });
    });

    await expect(confluenceJson("/wiki/api/v2/spaces")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(attempts).toBe(2);
  });
});
