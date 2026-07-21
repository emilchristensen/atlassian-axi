import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, TOP_HELP } from "../src/cli.js";

/** Capture everything main() writes to its injected stdout. */
function capture() {
  const chunks: string[] = [];
  return {
    stdout: { write: (chunk: string) => (chunks.push(chunk), true) },
    output: () => chunks.join(""),
  };
}

// Env keys the dashboard's auth line reads. Cleared + pinned per test so the
// rendered auth state is deterministic regardless of the host environment.
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
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
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
    // Read the expected version from package.json so release-please version
    // bumps don't break this test (was hardcoded to 0.1.0).
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    for (const flag of ["--version", "-v", "-V"]) {
      const cap = capture();
      await main({ argv: [flag], stdout: cap.stdout });
      expect(cap.output().trim()).toBe(pkg.version);
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
    expect(out).toContain("confluence-axi <command> <subcommand>");
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
    expect(cap.output()).toContain("usage: confluence-axi setup hooks");
  });

  it("rejects an unknown command with exit code 2", async () => {
    const cap = capture();
    await main({ argv: ["bogus"], stdout: cap.stdout });
    expect(cap.output().toLowerCase()).toContain("unknown command");
    expect(process.exitCode).toBe(2);
  });

  it("suggests the closest command for a top-level typo", async () => {
    const cap = capture();
    await main({ argv: ["pge"], stdout: cap.stdout });
    const out = cap.output();
    expect(out).toContain("Unknown command: pge");
    expect(out).toContain("Did you mean `confluence-axi page`?");
    expect(process.exitCode).toBe(2);
  });

  it("skips the did-you-mean when nothing is close", async () => {
    const cap = capture();
    await main({ argv: ["zzzzzzzz"], stdout: cap.stdout });
    const out = cap.output();
    expect(out).not.toContain("Did you mean");
    expect(out).toContain("--help");
    expect(process.exitCode).toBe(2);
  });

  it("exits 2 on an unknown page subcommand", async () => {
    const cap = capture();
    await main({ argv: ["page", "gett"], stdout: cap.stdout });
    expect(cap.output()).toContain("Unknown page subcommand: gett");
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

describe("per-resource help routing (2026-07-19)", () => {
  it("serves page help (with flags) for `page --help`", async () => {
    const cap = capture();
    await main({ argv: ["page", "--help"], stdout: cap.stdout });
    const out = cap.output();
    expect(out).toContain("usage: confluence-axi page");
    expect(out).toContain("--body-file");
  });

  it("serves page help for a bare `page`", async () => {
    const cap = capture();
    await main({ argv: ["page"], stdout: cap.stdout });
    expect(cap.output()).toContain("usage: confluence-axi page");
  });

  it("serves auth help for bare `auth`", async () => {
    const cap = capture();
    await main({ argv: ["auth"], stdout: cap.stdout });
    expect(cap.output()).toContain("usage: confluence-axi auth");
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe("resource/subcommand did-you-mean (2026-07-19)", () => {
  it("suggests get for `page gett`", async () => {
    const cap = capture();
    await main({ argv: ["page", "gett"], stdout: cap.stdout });
    expect(cap.output()).toContain("Did you mean `get`?");
    expect(process.exitCode).toBe(2);
  });
});

describe("router help table covers every resource (2026-07-19)", () => {
  const confluenceResources = ["page", "space"] as const;

  it.each(confluenceResources)(
    "%s --help serves that resource's help",
    async (resource) => {
      const cap = capture();
      await main({ argv: [resource, "--help"], stdout: cap.stdout });
      expect(cap.output()).toContain(`usage: confluence-axi ${resource}`);
    },
  );

  it("search --help serves the search help", async () => {
    const cap = capture();
    await main({ argv: ["search", "--help"], stdout: cap.stdout });
    expect(cap.output()).toContain(`usage: confluence-axi search`);
  });
});

describe("--site flag reaches the Confluence transport (2026-07-19)", () => {
  const savedExitCode = process.exitCode;
  let savedEnv: Record<string, string | undefined>;
  let tmp: string;

  beforeEach(() => {
    process.exitCode = undefined;
    savedEnv = Object.fromEntries(AUTH_ENV_KEYS.map((k) => [k, process.env[k]]));
    tmp = mkdtempSync(join(tmpdir(), "axi-site-"));
    process.env["XDG_CONFIG_HOME"] = tmp;
    process.env["ATLASSIAN_AXI_NO_KEYCHAIN"] = "1";
    process.env["ATLASSIAN_SITE"] = "stored.atlassian.net";
    process.env["ATLASSIAN_EMAIL"] = "me@acme.com";
    process.env["ATLASSIAN_API_TOKEN"] = "tok";
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
    for (const k of AUTH_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("routes the request to the --site host, not the env/stored site", async () => {
    const { setConfluenceFetch } = await import("../src/confluence.js");
    const hosts: string[] = [];
    setConfluenceFetch(async (url) => {
      hosts.push(new URL(String(url)).host);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    try {
      const cap = capture();
      await main({
        argv: ["space", "list", "--site", "other.atlassian.net"],
        stdout: cap.stdout,
      });
      expect(hosts[0]).toBe("other.atlassian.net");
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      setConfluenceFetch(null);
      const { setSiteOverride } = await import("../src/config.js");
      setSiteOverride(undefined);
    }
  });
});
