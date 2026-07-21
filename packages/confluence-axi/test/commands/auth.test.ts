import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcliRunner, ExecResult } from "../../src/acli.js";
import {
  accessibleResourcesMulti,
  accessibleResourcesSingle,
} from "../fixtures/oauth.js";

// Mock the config layer so auth tests exercise command logic (bootstrap
// gating, both-halves status, logout, mode dispatch) without touching
// disk/keychain/stdin.
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

const { setAcliRunner } = await import("../../src/acli.js");
const { authCommand } = await import("../../src/commands/auth.js");

function ok(stdout = ""): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}
function fail(stderr: string, exitCode = 1): ExecResult {
  return { stdout: "", stderr, exitCode };
}

const VERSION = "acli version 1.3.22-stable\n";

/**
 * Build an acli runner from a status handler. `--version` and `logout` always
 * succeed; `jira auth status` defers to `statusResult`; the login argv is
 * recorded so tests can assert whether bootstrap ran.
 */
function makeRunner(statusResult: ExecResult) {
  const calls: { args: string[]; stdin?: string }[] = [];
  const runner: AcliRunner = async (args, stdin) => {
    calls.push({ args, stdin });
    if (args[0] === "--version") return ok(VERSION);
    if (args.join(" ") === "jira auth status") return statusResult;
    if (args.join(" ") === "jira auth logout") return ok("logged out");
    if (args[0] === "jira" && args[1] === "auth" && args[2] === "login") {
      return ok("authenticated");
    }
    return ok();
  };
  const loginCall = () =>
    calls.find(
      (c) => c.args[0] === "jira" && c.args[2] === "login" && c.args[1] === "auth",
    );
  return { runner, calls, loginCall };
}

const TOKENS = {
  accessToken: "access-token-initial",
  refreshToken: "refresh-token-initial",
  expiresAt: Date.now() + 3_600_000,
  scopes: "read:jira-work offline_access",
};

const OAUTH_SESSION = {
  clientId: "client-123",
  accessToken: "access-token-initial",
  refreshToken: "refresh-token-initial",
  expiresAt: Date.now() + 3_600_000,
  cloudId: "11111111-2222-3333-4444-555555555555",
  site: "acme.atlassian.net",
  scopes: "read:jira-work offline_access",
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
  setAcliRunner(null);
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
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);

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
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);

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
    setAcliRunner(makeRunner(ok()).runner);

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
    setAcliRunner(makeRunner(ok()).runner);

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

  it("reports honestly that the OAuth flow does not bootstrap acli", async () => {
    config.resolveOAuthClientSecret.mockReturnValue({
      secret: "env-secret",
      source: "env",
    });
    const { runner, loginCall } = makeRunner(fail("unauthorized", 1));
    setAcliRunner(runner);

    const out = await authCommand(["login"]);
    expect(loginCall()).toBeUndefined();
    expect(out).toContain("acli: not logged in");
    expect(out).toContain("--token");
  });
});

// ---------------------------------------------------------------------------
// API-token login (agents/CI; the pre-OAuth flow, now behind --token)
// ---------------------------------------------------------------------------

describe("auth login --token bootstrap (status-gated / idempotent)", () => {
  it("logs acli in when it is not already authenticated to the site", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPing(200);
    const { runner, loginCall } = makeRunner(fail("unauthorized", 1));
    setAcliRunner(runner);

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
    const login = loginCall();
    expect(login).toBeDefined();
    // Token goes via stdin, never argv.
    expect(login?.stdin).toBe("tok-123");
    expect(login?.args).not.toContain("tok-123");
    expect(out).toContain("logged in to acme.atlassian.net");
    expect(out).toContain("mode: api-token");
  });

  it("skips acli login when already authenticated to the site (idempotent)", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPing(200);
    const { runner, loginCall } = makeRunner(
      ok("Logged in as me@acme.com to acme.atlassian.net"),
    );
    setAcliRunner(runner);

    const out = await authCommand([
      "login",
      "--token",
      "--site",
      "acme.atlassian.net",
      "--email",
      "me@acme.com",
    ]);

    expect(loginCall()).toBeUndefined();
    expect(out).toContain("already logged in");
    expect(out).toContain("confluence: 200 ok");
  });

  it("fails loudly when BOTH Confluence and Jira reject the token, saving and touching nothing", async () => {
    // The confl404 regression: a bad token used to slip through because acli
    // was already logged in and nothing else exercised the new credential.
    // Confluence answers a rejected credential with 404, Jira with 401.
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("bad-token");
    stubPings(404, 401);
    const { runner, loginCall } = makeRunner(
      ok("Logged in as me@acme.com to acme.atlassian.net"),
    );
    setAcliRunner(runner);

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
    // previously good stored credential, and acli must stay untouched.
    expect(config.saveCredential).not.toHaveBeenCalled();
    expect(loginCall()).toBeUndefined();
  });

  it("succeeds with a note on a Jira-only site (Confluence 404 but Jira accepts the token)", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPings(404, 200);
    const { runner } = makeRunner(fail("unauthorized", 1));
    setAcliRunner(runner);

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
    expect(out).toContain("logged in to acme.atlassian.net");
  });

  it("succeeds with a warning when the ping fails at the network level (token may be fine)", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    stubPingNetworkError();
    const { runner, loginCall } = makeRunner(fail("unauthorized", 1));
    setAcliRunner(runner);

    const out = await authCommand([
      "login",
      "--token",
      "--site",
      "acme.atlassian.net",
      "--email",
      "me@acme.com",
    ]);

    // Offline login degrades gracefully like the acli-not-installed path:
    // credential saved, acli bootstrapped, warning rendered.
    expect(config.saveCredential).toHaveBeenCalled();
    expect(loginCall()).toBeDefined();
    expect(out).toContain("confluence: unreachable");
    expect(out).toContain("auth status");
  });

  it("throws before reading the token when site/email are missing", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    setAcliRunner(makeRunner(ok()).runner);

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
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);

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
// status
// ---------------------------------------------------------------------------

describe("auth status (both halves)", () => {
  const TOKEN_MODE = {
    mode: "api-token",
    credential: {
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "tok",
    },
    sources: { site: "config", email: "config", apiToken: "keychain" },
  };

  it("returns ok in api-token mode when acli is logged in and REST returns 200", async () => {
    config.resolveAuthMode.mockResolvedValue(TOKEN_MODE);
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);

    const out = await authCommand(["status"]);
    expect(out).toContain("status: ok");
    expect(out).toContain("mode: api-token");
    expect(out).toContain("acli: logged in");
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
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);
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

  it("oauth mode stays ok without acli login but reports the Jira half honestly", async () => {
    config.resolveAuthMode.mockResolvedValue({
      mode: "oauth",
      oauth: OAUTH_SESSION,
    });
    setAcliRunner(makeRunner(fail("unauthorized", 1)).runner);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, statusText: "OK" }),
    );

    const out = await authCommand(["status"]);
    expect(out).toContain("status: ok");
    expect(out).toContain("acli: not logged in");
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
    setAcliRunner(makeRunner(ok()).runner);
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
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);
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
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);
    stubPingNetworkError();

    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      suggestions: [expect.stringContaining("check the network")],
    });
  });

  it("points at a likely-invalid token when acli is fine but Confluence says 404", async () => {
    // Live-verified: Confluence v2 answers a rejected Basic credential with
    // 404, indistinguishable from an anonymous request.
    config.resolveAuthMode.mockResolvedValue(TOKEN_MODE);
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);
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
  it("clears our credential + OAuth session and logs acli out", async () => {
    config.readOAuthSession.mockReturnValue(OAUTH_SESSION);
    config.clearCredential.mockResolvedValue(undefined);
    const { runner, calls } = makeRunner(ok());
    setAcliRunner(runner);

    const out = await authCommand(["logout"]);
    expect(config.clearCredential).toHaveBeenCalledOnce();
    expect(calls.some((c) => c.args.join(" ") === "jira auth logout")).toBe(true);
    expect(out).toContain("credential: cleared");
    expect(out).toContain("oauth: cleared");
    expect(out).toContain("acli: logged out");
  });

  it("reports when no OAuth session was stored", async () => {
    config.clearCredential.mockResolvedValue(undefined);
    setAcliRunner(makeRunner(ok()).runner);

    const out = await authCommand(["logout"]);
    expect(out).toContain("oauth: none stored");
  });
});

describe("auth dispatch", () => {
  it("rejects an unknown action", async () => {
    await expect(authCommand(["bogus"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
