import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, TOP_HELP } from "../src/cli.js";
import { setAcliRunner } from "../src/acli.js";

/** Capture everything main() writes to its injected stdout. */
function capture() {
  const chunks: string[] = [];
  return {
    stdout: { write: (chunk: string) => (chunks.push(chunk), true) },
    output: () => chunks.join(""),
  };
}

// Env keys the dashboard's auth line reads. Cleared + pinned per test so the
// rendered auth state is deterministic regardless of the host environment
// (e.g. CI has no acli / no credential, the dev box has acli installed).
const AUTH_ENV_KEYS = [
  "ATLASSIAN_SITE",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_API_TOKEN",
  "XDG_CONFIG_HOME",
  "ATLASSIAN_AXI_NO_KEYCHAIN",
] as const;

describe("cli help/version contract", () => {
  const savedExitCode = process.exitCode;
  let savedEnv: Record<string, string | undefined>;
  let tmp: string;

  beforeEach(() => {
    process.exitCode = undefined;
    savedEnv = Object.fromEntries(
      AUTH_ENV_KEYS.map((k) => [k, process.env[k]]),
    );
    for (const k of AUTH_ENV_KEYS) delete process.env[k];
    // Isolate config resolution: empty config dir + no keychain => no credential.
    tmp = mkdtempSync(join(tmpdir(), "axi-cli-"));
    process.env["XDG_CONFIG_HOME"] = tmp;
    process.env["ATLASSIAN_AXI_NO_KEYCHAIN"] = "1";
    // Pretend acli is installed so the dashboard renders the credential state,
    // not "acli not installed" — independent of the host having acli on PATH.
    setAcliRunner(async () => ({
      stdout: "acli version 1.3.22-stable\n",
      stderr: "",
      exitCode: 0,
    }));
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
    setAcliRunner(null);
    for (const k of AUTH_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("prints top-level help for --help", async () => {
    const cap = capture();
    await main({ argv: ["--help"], stdout: cap.stdout });
    const out = cap.output();
    expect(out).toContain(TOP_HELP);
    // SDK appends the inherited built-in update command to top-level help.
    expect(out).toContain("update");
    expect(process.exitCode).toBeFalsy();
  });

  it("prints the version for --version and -v", async () => {
    for (const flag of ["--version", "-v", "-V"]) {
      const cap = capture();
      await main({ argv: [flag], stdout: cap.stdout });
      expect(cap.output().trim()).toBe("0.0.0");
    }
  });

  it("renders the dashboard header for no args", async () => {
    const cap = capture();
    await main({ argv: [], stdout: cap.stdout });
    const out = cap.output();
    expect(out).toContain("bin:");
    expect(out).toContain("description:");
    expect(out).toContain("site: not configured");
    expect(out).toContain("auth: not configured");
    expect(out).toContain("atlassian-axi <command> <subcommand>");
  });

  it("shows the configured site from ATLASSIAN_SITE in the dashboard", async () => {
    process.env["ATLASSIAN_SITE"] = "acme.atlassian.net";
    const cap = capture();
    await main({ argv: [], stdout: cap.stdout });
    expect(cap.output()).toContain("site: acme.atlassian.net");
  });

  it("prints per-command help for setup --help", async () => {
    const cap = capture();
    await main({ argv: ["setup", "--help"], stdout: cap.stdout });
    expect(cap.output()).toContain("usage: atlassian-axi setup hooks");
  });

  it("rejects an unknown command with exit code 2", async () => {
    const cap = capture();
    await main({ argv: ["bogus"], stdout: cap.stdout });
    expect(cap.output().toLowerCase()).toContain("unknown command");
    expect(process.exitCode).toBe(2);
  });

  it("rejects a leading flag before the command", async () => {
    const cap = capture();
    await main({ argv: ["--site=acme.atlassian.net", "foo"], stdout: cap.stdout });
    // A leading flag is rejected before command routing.
    expect(cap.output().toLowerCase()).toContain("flag");
    expect(process.exitCode).toBe(2);
  });
});
