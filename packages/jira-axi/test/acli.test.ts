import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AcliRunner,
  type ExecResult,
  acliExec,
  acliInstalled,
  acliJson,
  acliRaw,
  acliVersion,
  setAcliRunner,
} from "../src/acli.js";
import { AxiError } from "../src/errors.js";

function ok(stdout: string): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}
function fail(stderr: string, exitCode = 1): ExecResult {
  return { stdout: "", stderr, exitCode };
}
const ENOENT: ExecResult = { stdout: "", stderr: "ENOENT", exitCode: 127 };

afterEach(() => setAcliRunner(null));

describe("acli shell-out (injected runner)", () => {
  it("acliJson parses stdout JSON and forwards argv/stdin", async () => {
    const runner = vi.fn<AcliRunner>(async () => ok('{"ok":true}'));
    setAcliRunner(runner);

    const result = await acliJson<{ ok: boolean }>(["jira", "workitem", "list"]);
    expect(result).toEqual({ ok: true });
    expect(runner).toHaveBeenCalledWith(["jira", "workitem", "list"], undefined);
  });

  it("acliExec passes stdin through to the runner", async () => {
    const runner = vi.fn<AcliRunner>(async () => ok("done"));
    setAcliRunner(runner);

    await acliExec(["jira", "auth", "login", "--token"], "secret");
    expect(runner).toHaveBeenCalledWith(
      ["jira", "auth", "login", "--token"],
      "secret",
    );
  });

  it("acliExec maps a non-zero exit to a mapped AxiError", async () => {
    setAcliRunner(async () => fail("✗ Error: unauthorized", 1));
    await expect(acliExec(["jira", "auth", "status"])).rejects.toBeInstanceOf(
      AxiError,
    );
  });

  it("prefers stdout for error mapping when stderr is acli's generic failure line", async () => {
    // acli often prints the real reason on stdout and only "✗ Error: command
    // execution failed" on stderr (verified live against v1.3.22).
    setAcliRunner(async () => ({
      stdout:
        "✗ The requested board cannot be viewed because it either does not exist or you do not have permission to view it.\n",
      stderr: "✗ Error: command execution failed\n",
      exitCode: 1,
    }));
    await expect(acliExec(["jira", "board", "view"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("acliRaw returns the raw result without throwing on non-zero exit", async () => {
    setAcliRunner(async () => fail("boom", 3));
    const result = await acliRaw(["jira", "auth", "status"]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("boom");
  });

  it("maps ENOENT to a friendly ACLI_NOT_INSTALLED error", async () => {
    setAcliRunner(async () => ENOENT);
    await expect(acliExec(["--version"])).rejects.toMatchObject({
      code: "ACLI_NOT_INSTALLED",
    });
    await expect(acliRaw(["jira"])).rejects.toMatchObject({
      code: "ACLI_NOT_INSTALLED",
    });
  });

  it("acliJson throws on non-JSON stdout", async () => {
    setAcliRunner(async () => ok("not json"));
    await expect(acliJson(["x"])).rejects.toBeInstanceOf(AxiError);
  });
});

describe("acli version detection", () => {
  it("parses the version from `acli --version`", async () => {
    setAcliRunner(async (args) => {
      expect(args).toEqual(["--version"]);
      return ok("acli version 1.3.22-stable\n");
    });
    expect(await acliVersion()).toBe("1.3.22-stable");
    expect(await acliInstalled()).toBe(true);
  });

  it("reports not-installed on ENOENT", async () => {
    setAcliRunner(async () => ENOENT);
    expect(await acliVersion()).toBeNull();
    expect(await acliInstalled()).toBe(false);
  });

  it("reports not-installed on a non-zero version probe", async () => {
    setAcliRunner(async () => fail("nope", 1));
    expect(await acliVersion()).toBeNull();
  });
});
