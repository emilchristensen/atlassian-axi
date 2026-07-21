import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOAuthSession,
  configPath,
  readOAuthSession,
  requireAuth,
  resolveAuthMode,
  resolveOAuthClientSecret,
  saveCredential,
  saveOAuthSession,
  setKeychainBackend,
  type OAuthSession,
} from "../src/config.js";

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

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  tmp = mkdtempSync(join(tmpdir(), "axi-config-oauth-"));
  process.env["XDG_CONFIG_HOME"] = tmp;
  setKeychainBackend(null);
});

afterEach(() => {
  setKeychainBackend(undefined);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

function makeSession(overrides: Partial<OAuthSession> = {}): OAuthSession {
  return {
    clientId: "client-123",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: 1_900_000_000_000,
    cloudId: "cloud-1",
    site: "acme.atlassian.net",
    scopes: "read:jira-work offline_access",
    clientSecret: "stored-secret",
    ...overrides,
  };
}

describe("OAuth session persistence", () => {
  it("round-trips through the 0600 config file", () => {
    saveOAuthSession(makeSession());
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(readOAuthSession()).toMatchObject({
      accessToken: "access-token",
      cloudId: "cloud-1",
      site: "acme.atlassian.net",
    });
  });

  it("sanitises corrupted optional fields instead of trusting them", () => {
    const corrupted = makeSession();
    // @ts-expect-error — simulate a hand-edited config with wrong types
    corrupted.clientSecret = { nested: "object" };
    // @ts-expect-error — same for scopes
    corrupted.scopes = 42;
    saveOAuthSession(corrupted);
    const read = readOAuthSession();
    expect(read).not.toBeNull();
    // A non-string clientSecret must never flow into a token request body.
    expect(read?.clientSecret).toBeUndefined();
    expect(read?.scopes).toBe("");
  });

  it("treats a malformed stored session as not logged in", () => {
    const broken = makeSession();
    // @ts-expect-error — simulate a hand-edited/corrupt config
    delete broken.refreshToken;
    saveOAuthSession(broken);
    expect(readOAuthSession()).toBeNull();
  });

  it("coexists with the API-token credential without clobbering either", async () => {
    saveOAuthSession(makeSession());
    await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "filetoken",
    });
    // Token login preserved the OAuth session…
    expect(readOAuthSession()).not.toBeNull();
    // …and an OAuth re-login preserves the token credential.
    saveOAuthSession(makeSession({ accessToken: "second" }));
    const onDisk = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(onDisk.token).toBe("filetoken");
    expect(onDisk.email).toBe("me@acme.com");
    expect(onDisk.oauth.accessToken).toBe("second");
  });

  it("clearOAuthSession drops only the oauth block", async () => {
    saveOAuthSession(makeSession());
    await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "filetoken",
    });
    clearOAuthSession();
    expect(readOAuthSession()).toBeNull();
    const onDisk = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(onDisk.token).toBe("filetoken");
  });
});

describe("client secret resolution", () => {
  it("env wins over the stored secret", () => {
    saveOAuthSession(makeSession());
    process.env["ATLASSIAN_AXI_OAUTH_CLIENT_SECRET"] = "env-secret";
    expect(resolveOAuthClientSecret()).toEqual({
      secret: "env-secret",
      source: "env",
    });
  });

  it("strips surrounding quotes from env and stored secrets (same paste hazard as the API token)", () => {
    saveOAuthSession(makeSession({ clientSecret: '"quoted-secret"' }));
    expect(resolveOAuthClientSecret()).toEqual({
      secret: "quoted-secret",
      source: "config",
    });
    process.env["ATLASSIAN_AXI_OAUTH_CLIENT_SECRET"] = "'env-secret'";
    expect(resolveOAuthClientSecret()).toEqual({
      secret: "env-secret",
      source: "env",
    });
  });

  it("falls back to the stored secret, then to null", () => {
    saveOAuthSession(makeSession());
    expect(resolveOAuthClientSecret()).toEqual({
      secret: "stored-secret",
      source: "config",
    });
    clearOAuthSession();
    expect(resolveOAuthClientSecret()).toBeNull();
  });
});

describe("auth mode resolution order", () => {
  it("is none when nothing is configured", async () => {
    const mode = await resolveAuthMode();
    expect(mode).toEqual({
      mode: "none",
      missing: ["site", "email", "apiToken"],
    });
    await expect(requireAuth()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("prefers the OAuth session over a stored API token", async () => {
    await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "filetoken",
    });
    saveOAuthSession(makeSession());
    const mode = await resolveAuthMode();
    expect(mode.mode).toBe("oauth");
  });

  it("lets the ATLASSIAN_API_TOKEN env override the OAuth session (agents/CI)", async () => {
    saveOAuthSession(makeSession());
    process.env["ATLASSIAN_SITE"] = "acme.atlassian.net";
    process.env["ATLASSIAN_EMAIL"] = "ci@acme.com";
    process.env["ATLASSIAN_API_TOKEN"] = "env-token";
    const mode = await resolveAuthMode();
    expect(mode).toMatchObject({
      mode: "api-token",
      credential: { email: "ci@acme.com", apiToken: "env-token" },
    });
  });

  it("treats a half-configured env token as a loud config error, not a silent OAuth fallback", async () => {
    saveOAuthSession(makeSession());
    process.env["ATLASSIAN_API_TOKEN"] = "env-token";
    // site comes from the stored config, email is genuinely missing
    const mode = await resolveAuthMode();
    expect(mode.mode).toBe("none");
    await expect(requireAuth()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("email"),
    });
  });

  it("falls back to the stored API token when no OAuth session exists", async () => {
    await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "filetoken",
    });
    const mode = await resolveAuthMode();
    expect(mode).toMatchObject({
      mode: "api-token",
      credential: { apiToken: "filetoken" },
    });
  });
});
