import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type KeychainBackend,
  clearCredential,
  configPath,
  readTokenFromStdin,
  requireCredential,
  resolveCredential,
  saveCredential,
  setKeychainBackend,
} from "../src/config.js";
import { AxiError } from "../src/errors.js";

/** In-memory keychain for exercising the keychain path deterministically. */
function fakeKeychain(): KeychainBackend & { value: string | null } {
  const store = { value: null as string | null };
  return {
    get value() {
      return store.value;
    },
    async get() {
      return store.value;
    },
    async set(secret) {
      store.value = secret;
    },
    async remove() {
      store.value = null;
    },
  };
}

const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "ATLASSIAN_SITE",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_API_TOKEN",
  "ATLASSIAN_AXI_NO_KEYCHAIN",
] as const;

describe("config credential resolution", () => {
  let tmp: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    tmp = mkdtempSync(join(tmpdir(), "axi-config-"));
    process.env["XDG_CONFIG_HOME"] = tmp;
    setKeychainBackend(null); // default to file-fallback unless a test opts in
  });

  afterEach(() => {
    setKeychainBackend(undefined);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves from the config file when no env is set", async () => {
    await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "filetoken",
    });
    const resolved = await resolveCredential();
    expect(resolved.site).toBe("acme.atlassian.net");
    expect(resolved.email).toBe("me@acme.com");
    expect(resolved.apiToken).toBe("filetoken");
    expect(resolved.sources).toEqual({
      site: "config",
      email: "config",
      apiToken: "config",
    });
  });

  it("lets env override every persisted field", async () => {
    await saveCredential({
      site: "stored.atlassian.net",
      email: "stored@acme.com",
      apiToken: "storedtoken",
    });
    process.env["ATLASSIAN_SITE"] = "env.atlassian.net";
    process.env["ATLASSIAN_EMAIL"] = "env@acme.com";
    process.env["ATLASSIAN_API_TOKEN"] = "envtoken";

    const resolved = await resolveCredential();
    expect(resolved.site).toBe("env.atlassian.net");
    expect(resolved.email).toBe("env@acme.com");
    expect(resolved.apiToken).toBe("envtoken");
    expect(resolved.sources).toEqual({
      site: "env",
      email: "env",
      apiToken: "env",
    });
  });

  it("persists {site,email} to a 0600 file and keeps token out of it when keychained", async () => {
    const keychain = fakeKeychain();
    setKeychainBackend(keychain);

    const { tokenStore } = await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "secret-token",
    });

    expect(tokenStore).toBe("keychain");
    expect(keychain.value).toBe("secret-token");

    const path = configPath();
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk).toEqual({ site: "acme.atlassian.net", email: "me@acme.com" });
    expect(onDisk.token).toBeUndefined();

    const resolved = await resolveCredential();
    expect(resolved.apiToken).toBe("secret-token");
    expect(resolved.sources.apiToken).toBe("keychain");
  });

  it("writes the token into the 0600 file when no keychain is available", async () => {
    setKeychainBackend(null);
    const { tokenStore } = await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "filetoken",
    });
    expect(tokenStore).toBe("file");

    const path = configPath();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.token).toBe("filetoken");
  });

  it("prefers the keychain token over a stale file token", async () => {
    // Seed a file token first.
    setKeychainBackend(null);
    await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "old-file-token",
    });
    // Now a keychain becomes available with a newer token.
    const keychain = fakeKeychain();
    keychain.set("new-keychain-token");
    setKeychainBackend(keychain);

    const resolved = await resolveCredential();
    expect(resolved.apiToken).toBe("new-keychain-token");
    expect(resolved.sources.apiToken).toBe("keychain");
  });

  it("requireCredential throws AUTH_REQUIRED listing missing fields", async () => {
    process.env["ATLASSIAN_SITE"] = "acme.atlassian.net";
    // email + token absent
    await expect(requireCredential()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    try {
      await requireCredential();
    } catch (error) {
      expect((error as AxiError).message).toContain("email");
      expect((error as AxiError).message).toContain("apiToken");
    }
  });

  it("clearCredential removes the file and the keychain token", async () => {
    const keychain = fakeKeychain();
    setKeychainBackend(keychain);
    await saveCredential({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "secret-token",
    });
    expect(existsSync(configPath())).toBe(true);

    await clearCredential();
    expect(existsSync(configPath())).toBe(false);
    expect(keychain.value).toBeNull();
  });
});

describe("readTokenFromStdin", () => {
  it("throws (never blocks) on an interactive TTY", async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      await expect(readTokenFromStdin()).rejects.toBeInstanceOf(AxiError);
      await expect(readTokenFromStdin()).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: original,
        configurable: true,
      });
    }
  });
});
