import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcliRunner, ExecResult } from "../../src/acli.js";

// Mock the config layer so auth tests exercise command logic (bootstrap
// gating, both-halves status, logout) without touching disk/keychain/stdin.
const config = vi.hoisted(() => ({
  resolveCredential: vi.fn(),
  saveCredential: vi.fn(),
  clearCredential: vi.fn(),
  readTokenFromStdin: vi.fn(),
}));

vi.mock("../../src/config.js", () => config);

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

beforeEach(() => {
  config.resolveCredential.mockReset();
  config.saveCredential.mockReset();
  config.clearCredential.mockReset();
  config.readTokenFromStdin.mockReset();
  config.saveCredential.mockResolvedValue({ tokenStore: "keychain" });
});

afterEach(() => {
  setAcliRunner(null);
  vi.unstubAllGlobals();
});

describe("auth login bootstrap (status-gated / idempotent)", () => {
  it("logs acli in when it is not already authenticated to the site", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    const { runner, loginCall } = makeRunner(fail("unauthorized", 1));
    setAcliRunner(runner);

    const out = await authCommand([
      "login",
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
  });

  it("skips acli login when already authenticated to the site (idempotent)", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    config.readTokenFromStdin.mockResolvedValue("tok-123");
    const { runner, loginCall } = makeRunner(
      ok("Logged in as me@acme.com to acme.atlassian.net"),
    );
    setAcliRunner(runner);

    const out = await authCommand([
      "login",
      "--site",
      "acme.atlassian.net",
      "--email",
      "me@acme.com",
    ]);

    expect(loginCall()).toBeUndefined();
    expect(out).toContain("already logged in");
  });

  it("throws before reading the token when site/email are missing", async () => {
    config.resolveCredential.mockResolvedValue({ sources: {} });
    setAcliRunner(makeRunner(ok()).runner);

    await expect(authCommand(["login", "--site", "acme.atlassian.net"])).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
    expect(config.readTokenFromStdin).not.toHaveBeenCalled();
  });
});

describe("auth status (both halves)", () => {
  const fullCred = {
    site: "acme.atlassian.net",
    email: "me@acme.com",
    apiToken: "tok",
    sources: { site: "config", email: "config", apiToken: "keychain" },
  };

  it("returns ok when acli is logged in and Confluence REST returns 200", async () => {
    config.resolveCredential.mockResolvedValue(fullCred);
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);

    const out = await authCommand(["status"]);
    expect(out).toContain("status: ok");
    expect(out).toContain("acli: logged in");
    expect(out).toContain("confluence: 200 ok");
    // Hit the documented spaces endpoint with a Basic auth header.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/wiki/api/v2/spaces?limit=1");
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it("throws AUTH_REQUIRED when the REST call is not 200", async () => {
    config.resolveCredential.mockResolvedValue(fullCred);
    setAcliRunner(makeRunner(ok("logged in to acme.atlassian.net")).runner);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 401, statusText: "Unauthorized" }),
    );

    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("throws AUTH_REQUIRED when the credential is incomplete", async () => {
    config.resolveCredential.mockResolvedValue({
      site: "acme.atlassian.net",
      sources: { site: "config" },
    });
    await expect(authCommand(["status"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

describe("auth logout", () => {
  it("clears our credential and logs acli out", async () => {
    config.clearCredential.mockResolvedValue(undefined);
    const { runner, calls } = makeRunner(ok());
    setAcliRunner(runner);

    const out = await authCommand(["logout"]);
    expect(config.clearCredential).toHaveBeenCalledOnce();
    expect(calls.some((c) => c.args.join(" ") === "jira auth logout")).toBe(true);
    expect(out).toContain("credential: cleared");
    expect(out).toContain("acli: logged out");
  });
});

describe("auth dispatch", () => {
  it("rejects an unknown action", async () => {
    await expect(authCommand(["bogus"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
