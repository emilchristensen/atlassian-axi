import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accessibleResourcesMulti,
  accessibleResourcesSingle,
} from "../fixtures/oauth.js";

// Mock the config layer so auth tests exercise command logic (mode dispatch,
// the Confluence REST status half, logout) without touching disk/keychain/stdin.
const config = vi.hoisted(() => ({
  resolveCredential: vi.fn(),
  resolveAuthMode: vi.fn(),
  saveCredential: vi.fn(),
  clearCredential: vi.fn(),
  readTokenFromStdin: vi.fn(),
  readOAuthSession: vi.fn(),
  saveOAuthSession: vi.fn(),
  resolveOAuthClientSecret: vi.fn(),
  isInteractiveTTY: vi.fn(),
  // Real implementations are pure string cleanup; mirror them so authLogin's
  // site normalization and secret sanitization keep working under the mock.
  sanitizeToken: (raw: string) => {
    const trimmed = raw.trim();
    const wrapped = trimmed.match(/^(["'])(.*)\1$/s);
    return wrapped ? (wrapped[2] as string).trim() : trimmed;
  },
  normalizeSite: (site: string | undefined) =>
    site
      ? site
          .trim()
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "") || undefined
      : undefined,
}));

// Mock the OAuth mechanics (listener/browser/token endpoints) — their real
// implementations are covered by test/oauth.test.ts.
const oauth = vi.hoisted(() => ({
  OAUTH_CALLBACK_PORT: 8765,
  OAUTH_REDIRECT_URI: "http://localhost:8765/callback",
  oauthClientId: vi.fn(() => "client-123"),
  generateState: vi.fn(() => "state-abc"),
  buildAuthorizeUrl: vi.fn(() => "https://auth.atlassian.com/authorize?..."),
  startCallbackServer: vi.fn(),
  openBrowser: vi.fn(async () => true),
  exchangeAuthorizationCode: vi.fn(),
  fetchAccessibleResources: vi.fn(),
  ensureFreshSession: vi.fn(),
}));

const prompt = vi.hoisted(() => ({
  promptHidden: vi.fn(),
  promptSelect: vi.fn(),
}));

vi.mock("../../src/config.js", () => config);
vi.mock("../../src/oauth.js", () => oauth);
vi.mock("../../src/prompt.js", () => prompt);

const { authCommand } = await import("../../src/commands/auth.js");

const TOKENS = {
  accessToken: "access-token-initial",
  refreshToken: "refresh-token-initial",
  expiresAt: Date.now() + 3_600_000,
  scopes: "read:confluence-content.all offline_access",
};

const OAUTH_SESSION = {
  clientId: "client-123",
  accessToken: "access-token-initial",
  refreshToken: "refresh-token-initial",
  expiresAt: Date.now() + 3_600_000,
  cloudId: "11111111-2222-3333-4444-555555555555",
  site: "acme.atlassian.net",
  scopes: "read:confluence-content.all offline_access",
  clientSecret: "stored-secret",
};

beforeEach(() => {
  config.resolveCredential.mockReset();
  config.resolveAuthMode.mockReset();
  config.saveCredential.mockReset();
  config.clearCredential.mockReset();
  config.readTokenFromStdin.mockReset();
  config.readOAuthSession.mockReset().mockReturnValue(null);
  config.saveOAuthSession.mockReset();
  config.resolveOAuthClientSecret.mockReset().mockReturnValue(null);
  config.isInteractiveTTY.mockReset().mockReturnValue(true);
  config.saveCredential.mockResolvedValue({ tokenStore: "keychain" });

  oauth.oauthClientId.mockClear();
  oauth.generateState.mockClear();
  oauth.buildAuthorizeUrl.mockClear();
  oauth.openBrowser.mockClear();
  oauth.startCallbackServer.mockReset().mockResolvedValue({
    port: 8765,
    result: Promise.resolve({ code: "code-123" }),
    close: vi.fn(),
  });
  oauth.exchangeAuthorizationCode.mockReset().mockResolvedValue(TOKENS);
  oauth.fetchAccessibleResources
    .mockReset()
    .mockResolvedValue(accessibleResourcesSingle);
  oauth.ensureFreshSession
    .mockReset()
    .mockImplementation(async (session) => session);

  prompt.promptHidden.mockReset();
  prompt.promptSelect.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stub the global fetch used by the login/status Confluence REST ping. */
function stubPing(status: number, statusText = status === 200 ? "OK" : "Not Found") {
  const fetchMock = vi.fn().mockResolvedValue({ status, statusText });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Per-path fetch stub: Confluence spaces ping vs Jira myself ping. */
function stubPings(confluenceStatus: number, jiraStatus: number) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    const status = url.includes("/rest/api/3/myself") ? jiraStatus : confluenceStatus;
    return { status, statusText: status === 200 ? "OK" : "Not Found" };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Fetch stub that fails at the network level (no HTTP response at all). */
function stubPingNetworkError(message = "getaddrinfo ENOTFOUND acme.atlassian.net") {
  const fetchMock = vi.fn().mockRejectedValue(new Error(message));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// ---------------------------------------------------------------------------
// OAuth login (the default)
// ---------------------------------------------------------------------------

describe("auth login (OAuth default)", () => {
  it("fails fast without a TTY, pointing at --token, before any listener/browser work", async () => {
    config.isInteractiveTTY.mockReturnValue(false);

    try {
      await authCommand(["login"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      const err = error as { code: string; suggestions: string[] };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.suggestions.join(" ")).toContain("--token");
    }
    expect(oauth.startCallbackServer).not.toHaveBeenCalled();
    expect(oauth.openBrowser).not.toHaveBeenCalled();
    expect(prompt.promptHidden).not.toHaveBeenCalled();
  });

  it("runs the full browser flow and persists the session (env secret)", async () => {
    config.resolveOAuthClientSecret.mockReturnValue({
      secret: "env-secret",
      source: "env",
    });

    const out = await authCommand(["login"]);

    expect(oauth.startCallbackServer).toHaveBeenCalledWith({
      port: 8765,
      expectedState: "state-abc",
    });
    expect(oauth.exchangeAuthorizationCode).toHaveBeenCalledWith({
      clientId: "client-123",
      clientSecret: "env-secret",
      code: "code-123",
    });
    // Env-supplied secret must NOT be persisted.
    expect(config.saveOAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-123",
        accessToken: "access-token-initial",
        refreshToken: "refresh-token-initial",
        cloudId: "11111111-2222-3333-4444-555555555555",
        site: "acme.atlassian.net",
      }),
    );
    expect(config.saveOAuthSession.mock.calls[0]?.[0]?.clientSecret).toBeUndefined();
    expect(out).toContain("mode: oauth");
    expect(out).toContain("site: acme.atlassian.net");
    expect(prompt.promptHidden).not.toHaveBeenCalled();
  });

  it("prompts for the client secret once and stores it (first login)", async () => {
    prompt.promptHidden.mockResolvedValue("prompted-secret");

    await authCommand(["login"]);

    expect(prompt.promptHidden).toHaveBeenCalledOnce();
    expect(oauth.exchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: "prompted-secret" }),
    );
    expect(config.saveOAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: "prompted-secret" }),
    );
  });

  it("prompts to pick a site when multiple are accessible", async () => {
    config.resolveOAuthClientSecret.mockReturnValue({
      secret: "env-secret",
      source: "env",
    });
    oauth.fetchAccessibleResources.mockResolvedValue(accessibleResourcesMulti);
    prompt.promptSelect.mockResolvedValue(1);

    const out = await authCommand(["login"]);

    expect(prompt.promptSelect).toHaveBeenCalledOnce();
    expect(out).toContain("site: other.atlassian.net");
    expect(config.saveOAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudId: "66666666-7777-8888-9999-000000000000",
      }),
    );
  });

  it("--site pre-selects among multiple sites without prompting, and rejects unknown sites", async () => {
    config.resolveOAuthClientSecret.mockReturnValue({
      secret: "env-secret",
      source: "env",
    });
    oauth.fetchAccessibleResources.mockResolvedValue(accessibleResourcesMulti);

    const out = await authCommand(["login", "--site", "other.atlassian.net"]);
    expect(prompt.promptSelect).not.toHaveBeenCalled();
    expect(out).toContain("site: other.atlassian.net");

    await expect(
      authCommand(["login", "--site", "nope.atlassian.net"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("acme.atlassian.net"),
    });
  });
});

// ---------------------------------------------------------------------------
// API-token login (agents/CI; the pre-OAuth flow, now behind --token)
// ---------------------------------------------------------------------------

describe("auth login --token (validate-then-persist)", () => {
  it("saves the credential after the Confluence ping returns 200", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPing(200);

    const out = await authCommand([
      "login",
      "--token",
      "--site",
      "acme.atlassian.net",
      "--email",
      "me@acme.com",
    ]);

    expect(config.saveCredential).toHaveBeenCalledWith({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "tok-123",
    });
    expect(out).toContain("mode: api-token");
    expect(out).toContain("confluence: 200 ok");
  });

  it("fails loudly when BOTH Confluence and Jira reject the token, saving nothing", async () => {
    // Confluence answers a rejected credential with 404, Jira with 401.
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("bad-token");
    stubPings(404, 401);

    const rejection = expect(
      authCommand([
        "login",
        "--token",
        "--site",
        "acme.atlassian.net",
        "--email",
        "me@acme.com",
      ]),
    ).rejects;
    await rejection.toMatchObject({ code: "AUTH_REQUIRED" });
    await rejection.toThrow(/Confluence 404, Jira 401/);
    await rejection.toThrow(/token was rejected/);
    // The ping runs BEFORE persistence: a bad paste must never overwrite a
    // previously good stored credential.
    expect(config.saveCredential).not.toHaveBeenCalled();
  });

  it("succeeds with a note on a Jira-only site (Confluence 404 but Jira accepts the token)", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPings(404, 200);

    const out = await authCommand([
      "login",
      "--token",
      "--site",
      "acme.atlassian.net",
      "--email",
      "me@acme.com",
    ]);

    expect(config.saveCredential).toHaveBeenCalled();
    expect(out).toContain("token verified against Jira");
    expect(out).toContain("may not have Confluence");
  });

  it("succeeds with a warning when the ping fails at the network level (token may be fine)", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPingNetworkError();

    const out = await authCommand([
      "login",
      "--token",
      "--site",
      "acme.atlassian.net",
      "--email",
      "me@acme.com",
    ]);

    // Offline login degrades gracefully: credential saved, warning rendered.
    expect(config.saveCredential).toHaveBeenCalled();
    expect(out).toContain("confluence: unreachable");
    expect(out).toContain("auth status");
  });

  it("throws before reading the token when site/email are missing", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });

    await expect(
      authCommand(["login", "--token", "--site", "acme.atlassian.net"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(config.readTokenFromStdin).not.toHaveBeenCalled();
  });

  it("works without a TTY (the agent/CI path is never browser-gated)", async () => {
    config.isInteractiveTTY.mockReturnValue(false);
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPing(200);

    const out = await authCommand([
      "login",
      "--token",
      "--site",
      "acme.atlassian.net",
      "--email",
      "me@acme.com",
    ]);
    expect(out).toContain("mode: api-token");
  });
});

// ---------------------------------------------------------------------------
// status (Confluence REST half only)
// ---------------------------------------------------------------------------

describe("auth status", () => {
  const TOKEN_MODE = {
    mode: "api-token",
    credential: {
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "tok",
    },
    sources: { site: "config", email: "config", apiToken: "keychain" },
  };

  it("returns ok in api-token mode when the Confluence REST ping returns 200", async () => {
    config.resolveAuthMode.mockResolvedValue(TOKEN_MODE);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);

    const out = await authCommand(["status"]);
    expect(out).toContain("status: ok");
    expect(out).toContain("mode: api-token");
    expect(out).toContain("confluence: 200 ok");
    // Hit the documented spaces endpoint with a Basic auth header.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/wiki/api/v2/spaces?limit=1");
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it("returns ok in oauth mode, pinging the gateway with a Bearer token", async () => {
    config.resolveAuthMode.mockResolvedValue({
      mode: "oauth",
      oauth: OAUTH_SESSION,
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);

    const out = await authCommand(["status"]);
    expect(out).toContain("status: ok");
    expect(out).toContain("mode: oauth");
    expect(out).toContain("site: acme.atlassian.net");
    expect(out).toContain("token: valid");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.atlassian.com/ex/confluence/${OAUTH_SESSION.cloudId}/wiki/api/v2/spaces?limit=1`,
    );
    expect(init.headers.Authorization).toBe("Bearer access-token-initial");
  });

  it("throws AUTH_REQUIRED in oauth mode when the refresh fails", async () => {
    config.resolveAuthMode.mockResolvedValue({
      mode: "oauth",
      oauth: OAUTH_SESSION,
    });
    oauth.ensureFreshSession.mockRejectedValue(
      Object.assign(new Error("refresh token revoked"), {
        code: "AUTH_REQUIRED",
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("refresh token revoked"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws AUTH_REQUIRED when the REST call is not 200 (api-token mode)", async () => {
    config.resolveAuthMode.mockResolvedValue(TOKEN_MODE);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 401, statusText: "Unauthorized" }),
    );

    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("does NOT blame the token when the status ping fails at the network level", async () => {
    config.resolveAuthMode.mockResolvedValue(TOKEN_MODE);
    stubPingNetworkError();

    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      suggestions: [expect.stringContaining("check the network")],
    });
  });

  it("points at a likely-invalid token when Confluence says 404", async () => {
    // Live-verified: Confluence v2 answers a rejected Basic credential with
    // 404, indistinguishable from an anonymous request.
    config.resolveAuthMode.mockResolvedValue(TOKEN_MODE);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 404, statusText: "Not Found" }),
    );

    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      suggestions: [expect.stringContaining("token is likely invalid")],
    });
  });

  it("throws AUTH_REQUIRED when nothing is configured", async () => {
    config.resolveAuthMode.mockResolvedValue({
      mode: "none",
      missing: ["email", "apiToken"],
    });
    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe("auth logout", () => {
  it("clears our credential and the OAuth session", async () => {
    config.readOAuthSession.mockReturnValue(OAUTH_SESSION);
    config.clearCredential.mockResolvedValue(undefined);

    const out = await authCommand(["logout"]);
    expect(config.clearCredential).toHaveBeenCalledOnce();
    expect(out).toContain("credential: cleared");
    expect(out).toContain("oauth: cleared");
  });

  it("reports when no OAuth session was stored", async () => {
    config.clearCredential.mockResolvedValue(undefined);

    const out = await authCommand(["logout"]);
    expect(out).toContain("oauth: none stored");
  });
});

describe("auth login (unknown flags/args)", () => {
  it("rejects a typo'd --token instead of falling through to the OAuth path", async () => {
    // `--tokn` used to be dropped silently and surface the misleading
    // "needs an interactive terminal" OAuth error in an agent/CI shell.
    config.isInteractiveTTY.mockReturnValue(false);

    await expect(
      authCommand(["login", "--tokn", "--site", "acme.atlassian.net"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unexpected arguments after 'auth login'"),
    });
    expect(oauth.startCallbackServer).not.toHaveBeenCalled();
  });

  it("rejects a typo'd --email before reading the token from stdin", async () => {
    // A dropped --emial used to log in under the stale resolved email.
    config.resolveCredential.mockResolvedValue({
      site: "old.atlassian.net",
      email: "old@acme.com",
      sources: {},
    });

    try {
      await authCommand(["login", "--token", "--emial", "me@acme.com"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      const err = error as { code: string; suggestions: string[] };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.suggestions.join(" ")).toContain("--email");
    }
    expect(config.readTokenFromStdin).not.toHaveBeenCalled();
    expect(config.saveCredential).not.toHaveBeenCalled();
  });

  it("rejects a stray positional after `login --token`", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });

    await expect(
      authCommand([
        "login",
        "--token",
        "foo",
        "--site",
        "acme.atlassian.net",
        "--email",
        "me@acme.com",
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(config.saveCredential).not.toHaveBeenCalled();
  });

  it("names the flag that swallowed a sibling flag as its value", async () => {
    // `--site --email me@acme.com` used to set site="--email" and then blame
    // the leftover email address for the failure.
    config.resolveCredential.mockResolvedValue({ sources: {} });

    await expect(
      authCommand(["login", "--token", "--site", "--email", "me@acme.com"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "--site requires a value (got the flag --email instead)",
    });
    expect(config.readTokenFromStdin).not.toHaveBeenCalled();
    expect(config.saveCredential).not.toHaveBeenCalled();
  });

  it("serves help for `login --help` instead of starting a browser flow", async () => {
    const out = await authCommand(["login", "--help"]);

    expect(out).toContain("usage: confluence-axi auth");
    expect(oauth.startCallbackServer).not.toHaveBeenCalled();
  });
});

describe("auth dispatch", () => {
  it("rejects an unknown action", async () => {
    await expect(authCommand(["bogus"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a stray flag/arg after `logout` without clearing anything", async () => {
    // logout is destructive; a typo'd flag (e.g. --dry-run) must be a loud
    // error, never silently accepted while it wipes every credential.
    await expect(authCommand(["logout", "--dry-run"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unexpected arguments after 'auth logout'"),
    });
    expect(config.clearCredential).not.toHaveBeenCalled();
  });

  it("rejects a stray arg after `status`", async () => {
    await expect(authCommand(["status", "extra"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
