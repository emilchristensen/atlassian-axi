import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configPath,
  readOAuthSession,
  saveOAuthSession,
  type OAuthSession,
} from "../src/config.js";
import { AxiError } from "../src/errors.js";
import {
  OAUTH_REDIRECT_URI,
  OAUTH_TOKEN_URL,
  buildAuthorizeUrl,
  ensureFreshSession,
  escapeForCmdStart,
  exchangeAuthorizationCode,
  fetchAccessibleResources,
  generateState,
  isSessionExpired,
  oauthClientId,
  refreshAccessToken,
  refreshSession,
  setOAuthFetch,
  startCallbackServer,
  type FetchLike,
} from "../src/oauth.js";
import {
  accessibleResourcesMulti,
  tokenErrorPayload,
  tokenExchangePayload,
  tokenRefreshPayload,
} from "./fixtures/oauth.js";

// The oauth module persists sessions through config.ts; point the config file
// at a temp dir and disable the keychain so tests never touch real state.
const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "ATLASSIAN_AXI_NO_KEYCHAIN",
  "ATLASSIAN_AXI_OAUTH_CLIENT_ID",
  "ATLASSIAN_AXI_OAUTH_CLIENT_SECRET",
] as const;
let savedEnv: Record<string, string | undefined>;
let tmp: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  tmp = mkdtempSync(join(tmpdir(), "axi-oauth-"));
  process.env["XDG_CONFIG_HOME"] = tmp;
  process.env["ATLASSIAN_AXI_NO_KEYCHAIN"] = "1";
});

afterEach(() => {
  setOAuthFetch(null);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Loud fake fetch: first matching route wins, unmatched requests throw. */
function makeOAuthFake(
  routes: {
    match: (call: RecordedCall) => boolean;
    status?: number;
    payload: unknown;
  }[],
) {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    for (const route of routes) {
      if (route.match(call)) {
        return new Response(JSON.stringify(route.payload), {
          status: route.status ?? 200,
        });
      }
    }
    throw new Error(`Unexpected OAuth request: ${call.method} ${url}`);
  };
  return { fetchImpl, calls };
}

function makeSession(overrides: Partial<OAuthSession> = {}): OAuthSession {
  return {
    clientId: "test-client-id",
    accessToken: "access-token-old",
    refreshToken: "refresh-token-initial",
    expiresAt: Date.now() + 3_600_000,
    cloudId: "11111111-2222-3333-4444-555555555555",
    site: "acme.atlassian.net",
    scopes: "read:jira-work",
    clientSecret: "stored-secret",
    ...overrides,
  };
}

describe("authorize URL", () => {
  it("carries audience, scopes incl. offline_access, the exact redirect, and state", () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: "client-123", state: "state-abc" }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.atlassian.com/authorize");
    expect(url.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8765/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("response_type")).toBe("code");
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("offline_access");
    expect(scope).toContain("read:confluence-content.all");
    // Least privilege: the OAuth session only drives the Confluence half, so
    // the app's granted Jira scopes are deliberately not requested.
    expect(scope).not.toContain("jira");
  });

  it("generateState is unpredictable and URL-safe", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("oauthClientId requires the env var and has no shipped default", () => {
    // No default: unset must throw rather than silently using a bundled id.
    expect(() => oauthClientId()).toThrow(AxiError);
    process.env["ATLASSIAN_AXI_OAUTH_CLIENT_ID"] = "fork-client";
    expect(oauthClientId()).toBe("fork-client");
  });
});

describe("token exchange", () => {
  it("posts the authorization-code grant and returns the token set", async () => {
    const { fetchImpl, calls } = makeOAuthFake([
      { match: (c) => c.url === OAUTH_TOKEN_URL, payload: tokenExchangePayload },
    ]);
    setOAuthFetch(fetchImpl);

    const before = Date.now();
    const tokens = await exchangeAuthorizationCode({
      clientId: "client-123",
      clientSecret: "secret-xyz",
      code: "code-abc",
    });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      grant_type: "authorization_code",
      client_id: "client-123",
      client_secret: "secret-xyz",
      code: "code-abc",
      redirect_uri: OAUTH_REDIRECT_URI,
    });
    expect(tokens.accessToken).toBe("access-token-initial");
    expect(tokens.refreshToken).toBe("refresh-token-initial");
    expect(tokens.scopes).toContain("offline_access");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000);
    expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 3_601_000);
  });

  it("surfaces the endpoint's error_description on failure", async () => {
    const { fetchImpl } = makeOAuthFake([
      { match: () => true, status: 403, payload: tokenErrorPayload },
    ]);
    setOAuthFetch(fetchImpl);

    await expect(
      exchangeAuthorizationCode({
        clientId: "c",
        clientSecret: "s",
        code: "dead-code",
      }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("Unknown or invalid refresh token."),
    });
  });

  it("rejects a response without a refresh token (offline_access missing)", async () => {
    const noRefresh: Partial<typeof tokenExchangePayload> = {
      ...tokenExchangePayload,
    };
    delete noRefresh.refresh_token;
    const { fetchImpl } = makeOAuthFake([
      { match: () => true, payload: noRefresh },
    ]);
    setOAuthFetch(fetchImpl);

    await expect(
      exchangeAuthorizationCode({ clientId: "c", clientSecret: "s", code: "x" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("offline_access"),
    });
  });
});

describe("token refresh (rotating)", () => {
  it("returns the ROTATED refresh token from the response", async () => {
    const { fetchImpl, calls } = makeOAuthFake([
      { match: (c) => c.url === OAUTH_TOKEN_URL, payload: tokenRefreshPayload },
    ]);
    setOAuthFetch(fetchImpl);

    const tokens = await refreshAccessToken({
      clientId: "client-123",
      clientSecret: "secret-xyz",
      refreshToken: "refresh-token-initial",
    });

    expect(calls[0]?.body).toEqual({
      grant_type: "refresh_token",
      client_id: "client-123",
      client_secret: "secret-xyz",
      refresh_token: "refresh-token-initial",
    });
    expect(tokens.accessToken).toBe("access-token-refreshed");
    expect(tokens.refreshToken).toBe("refresh-token-rotated");
  });

  it("keeps the old refresh token when the server does not rotate", async () => {
    const noRotation: Partial<typeof tokenRefreshPayload> = {
      ...tokenRefreshPayload,
    };
    delete noRotation.refresh_token;
    const { fetchImpl } = makeOAuthFake([{ match: () => true, payload: noRotation }]);
    setOAuthFetch(fetchImpl);

    const tokens = await refreshAccessToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "refresh-token-initial",
    });
    expect(tokens.refreshToken).toBe("refresh-token-initial");
  });

  it("maps invalid_grant to AUTH_REQUIRED pointing at auth login", async () => {
    const { fetchImpl } = makeOAuthFake([
      { match: () => true, status: 403, payload: tokenErrorPayload },
    ]);
    setOAuthFetch(fetchImpl);

    try {
      await refreshAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "dead",
      });
      expect.unreachable("refresh should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("AUTH_REQUIRED");
      expect((error as AxiError).suggestions.join(" ")).toContain("auth login");
    }
  });
});

describe("accessible resources", () => {
  it("lists sites with a Bearer header", async () => {
    const { fetchImpl, calls } = makeOAuthFake([
      {
        match: (c) => c.url.includes("accessible-resources"),
        payload: accessibleResourcesMulti,
      },
    ]);
    setOAuthFetch(fetchImpl);

    const resources = await fetchAccessibleResources("access-token-initial");
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer access-token-initial");
    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({
      id: "11111111-2222-3333-4444-555555555555",
      url: "https://acme.atlassian.net",
      name: "acme",
    });
  });

  it("throws AUTH_REQUIRED on a 401", async () => {
    const { fetchImpl } = makeOAuthFake([
      { match: () => true, status: 401, payload: { message: "expired" } },
    ]);
    setOAuthFetch(fetchImpl);
    await expect(fetchAccessibleResources("stale")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("rejects a non-array response loudly", async () => {
    const { fetchImpl } = makeOAuthFake([
      { match: () => true, payload: { resources: [] } },
    ]);
    setOAuthFetch(fetchImpl);
    await expect(fetchAccessibleResources("tok")).rejects.toMatchObject({
      message: expect.stringContaining("expected an array"),
    });
  });
});

describe("session freshness + persistence", () => {
  it("isSessionExpired applies the safety skew", () => {
    expect(isSessionExpired(makeSession({ expiresAt: Date.now() + 30_000 }))).toBe(
      true,
    );
    expect(
      isSessionExpired(makeSession({ expiresAt: Date.now() + 600_000 })),
    ).toBe(false);
  });

  it("ensureFreshSession is a no-op for a valid token", async () => {
    const session = makeSession();
    saveOAuthSession(session);
    const fresh = await ensureFreshSession(session);
    expect(fresh).toBe(session);
  });

  it("refreshSession persists the rotated tokens to the 0600 config", async () => {
    const session = makeSession({ expiresAt: Date.now() - 1_000 });
    saveOAuthSession(session);
    const { fetchImpl } = makeOAuthFake([
      { match: (c) => c.url === OAUTH_TOKEN_URL, payload: tokenRefreshPayload },
    ]);
    setOAuthFetch(fetchImpl);

    const fresh = await ensureFreshSession(session);
    expect(fresh.accessToken).toBe("access-token-refreshed");
    expect(fresh.refreshToken).toBe("refresh-token-rotated");

    const persisted = readOAuthSession();
    expect(persisted?.accessToken).toBe("access-token-refreshed");
    expect(persisted?.refreshToken).toBe("refresh-token-rotated");
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it("env secret wins over the stored one for refresh", async () => {
    process.env["ATLASSIAN_AXI_OAUTH_CLIENT_SECRET"] = "env-secret";
    const session = makeSession({ expiresAt: 0 });
    saveOAuthSession(session);
    const { fetchImpl, calls } = makeOAuthFake([
      { match: () => true, payload: tokenRefreshPayload },
    ]);
    setOAuthFetch(fetchImpl);

    await refreshSession(session);
    expect((calls[0]?.body as { client_secret: string }).client_secret).toBe(
      "env-secret",
    );
  });

  it("recovers when a sibling process already rotated the refresh token", async () => {
    // Our in-memory session holds the OLD refresh token; the store already has
    // the sibling's rotated, still-valid session. The endpoint rejects the old
    // token (invalid_grant) — refreshSession must fall back to the store
    // instead of surfacing a spurious AUTH_REQUIRED.
    const mine = makeSession({ expiresAt: 0, refreshToken: "refresh-token-old" });
    const sibling = makeSession({
      accessToken: "access-token-sibling",
      refreshToken: "refresh-token-sibling",
      expiresAt: Date.now() + 3_600_000,
    });
    saveOAuthSession(sibling);
    const { fetchImpl } = makeOAuthFake([
      { match: () => true, status: 403, payload: tokenErrorPayload },
    ]);
    setOAuthFetch(fetchImpl);

    const recovered = await refreshSession(mine);
    expect(recovered.accessToken).toBe("access-token-sibling");
  });

  it("refreshes the sibling's session when it is itself expired (once)", async () => {
    const mine = makeSession({ expiresAt: 0, refreshToken: "refresh-token-old" });
    const sibling = makeSession({
      refreshToken: "refresh-token-sibling",
      expiresAt: 0,
    });
    saveOAuthSession(sibling);
    const { fetchImpl } = makeOAuthFake([
      {
        match: (c) =>
          (c.body as { refresh_token: string }).refresh_token ===
          "refresh-token-old",
        status: 403,
        payload: tokenErrorPayload,
      },
      {
        match: (c) =>
          (c.body as { refresh_token: string }).refresh_token ===
          "refresh-token-sibling",
        payload: tokenRefreshPayload,
      },
    ]);
    setOAuthFetch(fetchImpl);

    const recovered = await refreshSession(mine);
    expect(recovered.accessToken).toBe("access-token-refreshed");
    expect(readOAuthSession()?.refreshToken).toBe("refresh-token-rotated");
  });

  it("still fails loudly when the stored refresh token is the same dead one", async () => {
    const mine = makeSession({ expiresAt: 0 });
    saveOAuthSession(mine);
    const { fetchImpl } = makeOAuthFake([
      { match: () => true, status: 403, payload: tokenErrorPayload },
    ]);
    setOAuthFetch(fetchImpl);

    await expect(refreshSession(mine)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("throws AUTH_REQUIRED when no client secret is available", async () => {
    const session = makeSession({ expiresAt: 0 });
    delete session.clientSecret;
    saveOAuthSession(session);

    await expect(refreshSession(session)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("client secret"),
    });
  });

  it("never writes the raw session file without the config JSON envelope", async () => {
    const session = makeSession();
    saveOAuthSession(session);
    const onDisk = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(onDisk.oauth.refreshToken).toBe("refresh-token-initial");
  });
});

describe("escapeForCmdStart (Windows browser open)", () => {
  it("^-escapes cmd metacharacters so query params cannot become commands", () => {
    expect(
      escapeForCmdStart(
        "https://auth.atlassian.com/authorize?a=1&b=2|whoami&c=<x>^y",
      ),
    ).toBe("https://auth.atlassian.com/authorize?a=1^&b=2^|whoami^&c=^<x^>^^y");
  });

  it("leaves percent-encoding intact", () => {
    expect(escapeForCmdStart("https://x/?scope=read%3Ajira")).toBe(
      "https://x/?scope=read%3Ajira",
    );
  });
});

describe("callback server", () => {
  it("resolves the code when state matches (real HTTP round-trip)", async () => {
    const server = await startCallbackServer({
      port: 0, // ephemeral in tests; the real flow pins 8765 (registered URL)
      expectedState: "state-abc",
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/callback?code=code-123&state=state-abc`,
      );
      expect(response.status).toBe(200);
      await expect(server.result).resolves.toEqual({ code: "code-123" });
    } finally {
      server.close();
    }
  });

  it("400s a state mismatch WITHOUT cancelling the pending login (CSRF/DoS guard)", async () => {
    const server = await startCallbackServer({
      port: 0,
      expectedState: "state-abc",
    });
    try {
      // Unauthenticated garbage: wrong state, missing state, drive-by error
      // param — none may settle the one-shot flow.
      for (const query of [
        "code=code-123&state=evil",
        "code=code-123",
        "error=access_denied",
      ]) {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/callback?${query}`,
        );
        expect(response.status).toBe(400);
      }
      // The real redirect still lands afterwards.
      const genuine = await fetch(
        `http://127.0.0.1:${server.port}/callback?code=code-123&state=state-abc`,
      );
      expect(genuine.status).toBe(200);
      await expect(server.result).resolves.toEqual({ code: "code-123" });
    } finally {
      server.close();
    }
  });

  it("rejects with the provider error when the state-authenticated redirect denies consent", async () => {
    const server = await startCallbackServer({
      port: 0,
      expectedState: "state-abc",
    });
    try {
      await fetch(
        `http://127.0.0.1:${server.port}/callback?error=access_denied&error_description=User%20did%20not%20authorize&state=state-abc`,
      );
      await expect(server.result).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
        message: expect.stringContaining("User did not authorize"),
      });
    } finally {
      server.close();
    }
  });

  it("404s paths other than /callback and keeps waiting", async () => {
    const server = await startCallbackServer({
      port: 0,
      expectedState: "state-abc",
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/favicon.ico`);
      expect(response.status).toBe(404);
      const followUp = await fetch(
        `http://127.0.0.1:${server.port}/callback?code=late&state=state-abc`,
      );
      expect(followUp.status).toBe(200);
      await expect(server.result).resolves.toEqual({ code: "late" });
    } finally {
      server.close();
    }
  });
});
