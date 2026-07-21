import { readFileSync } from "node:fs";
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

// The dashboard shells out to acli. Fake it so the rendered state is
// deterministic regardless of the host (CI has no acli): `--version` reports a
// version (installed), and the my-open-workitems probe returns an empty list.
function fakeAcli() {
  setAcliRunner(async (args) => {
    if (args.includes("--version")) {
      return { stdout: "acli version 1.3.22-stable\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "[]", stderr: "", exitCode: 0 };
  });
}

describe("cli help/version contract", () => {
  const savedExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    fakeAcli();
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
    setAcliRunner(null);
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
    // bumps don't break this test.
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
    expect(out).toContain("acli: installed");
    expect(out).toContain("jira-axi <command> <subcommand>");
  });

  it("prints per-command help for setup --help", async () => {
    const cap = capture();
    await main({ argv: ["setup", "--help"], stdout: cap.stdout });
    expect(cap.output()).toContain("usage: jira-axi setup hooks");
  });

  it("rejects an unknown command with exit code 2", async () => {
    const cap = capture();
    await main({ argv: ["bogus"], stdout: cap.stdout });
    expect(cap.output().toLowerCase()).toContain("unknown command");
    expect(process.exitCode).toBe(2);
  });

  it("suggests the closest command for a top-level typo", async () => {
    const cap = capture();
    await main({ argv: ["workitm"], stdout: cap.stdout });
    const out = cap.output();
    expect(out).toContain("Unknown command: workitm");
    expect(out).toContain("Did you mean `jira-axi workitem`?");
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

  it("exits 2 on an unknown workitem subcommand", async () => {
    const cap = capture();
    await main({ argv: ["workitem", "vieww"], stdout: cap.stdout });
    expect(cap.output()).toContain("Unknown workitem subcommand: vieww");
    expect(process.exitCode).toBe(2);
  });

  it("rejects a leading flag before the command", async () => {
    const cap = capture();
    await main({ argv: ["--nope", "foo"], stdout: cap.stdout });
    // A leading flag is rejected before command routing.
    expect(cap.output().toLowerCase()).toContain("flag");
    expect(process.exitCode).toBe(2);
  });
});

describe("per-resource help routing", () => {
  beforeEach(fakeAcli);
  afterEach(() => setAcliRunner(null));

  it("serves workitem help (with flags) for `workitem --help`", async () => {
    const cap = capture();
    await main({ argv: ["workitem", "--help"], stdout: cap.stdout });
    const out = cap.output();
    expect(out).toContain("usage: jira-axi workitem");
    expect(out).toContain("--fields");
  });

  it("serves workitem help for a deep `workitem list --help`", async () => {
    const cap = capture();
    await main({ argv: ["workitem", "list", "--help"], stdout: cap.stdout });
    expect(cap.output()).toContain("usage: jira-axi workitem");
  });

  it("serves workitem help for bare `workitem`", async () => {
    const cap = capture();
    await main({ argv: ["workitem"], stdout: cap.stdout });
    expect(cap.output()).toContain("usage: jira-axi workitem");
    expect(process.exitCode ?? 0).toBe(0);
  });
});

describe("resource/subcommand did-you-mean", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    fakeAcli();
  });
  afterEach(() => setAcliRunner(null));

  it("suggests view for `workitem vieww`", async () => {
    const cap = capture();
    await main({ argv: ["workitem", "vieww"], stdout: cap.stdout });
    expect(cap.output()).toContain("Did you mean `view`?");
    expect(process.exitCode).toBe(2);
  });
});

describe("help table covers every resource", () => {
  beforeEach(fakeAcli);
  afterEach(() => setAcliRunner(null));

  const resources = [
    "workitem",
    "project",
    "board",
    "sprint",
    "filter",
    "dashboard",
    "field",
  ] as const;

  it.each(resources)("%s --help serves that resource's help", async (resource) => {
    const cap = capture();
    await main({ argv: [resource, "--help"], stdout: cap.stdout });
    expect(cap.output()).toContain(`usage: jira-axi ${resource}`);
  });
});
