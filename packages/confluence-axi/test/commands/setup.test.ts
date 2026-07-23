import { describe, expect, it, vi } from "vitest";

// Mock the SDK hook installer so the test never touches the real
// ~/.claude / ~/.codex / ~/.config/opencode files on disk.
const { installSessionStartHooks } = vi.hoisted(() => ({
  installSessionStartHooks:
    vi.fn<
      (options?: { onError?: (message: string) => void }) => void
    >(),
}));

vi.mock("axi-sdk-js", async () => {
  const actual = await vi.importActual<typeof import("axi-sdk-js")>("axi-sdk-js");
  return { ...actual, installSessionStartHooks };
});

const { setupCommand } = await import("../../src/commands/setup.js");
const { AxiError } = await import("../../src/errors.js");

describe("setupCommand", () => {
  it("installs hooks and reports status for `hooks`", async () => {
    installSessionStartHooks.mockClear();
    const out = await setupCommand(["hooks"]);
    expect(installSessionStartHooks).toHaveBeenCalledOnce();
    expect(out).toContain("status: installed");
    expect(out).toContain("Claude Code, Codex, OpenCode");
  });

  it("rejects an unknown setup action", async () => {
    installSessionStartHooks.mockClear();
    await expect(setupCommand(["bogus"])).rejects.toBeInstanceOf(AxiError);
    expect(installSessionStartHooks).not.toHaveBeenCalled();
  });

  it("returns help for a bare setup (matching the other command routers)", async () => {
    const out = await setupCommand([]);
    expect(out).toContain("usage: confluence-axi setup hooks");
    expect(installSessionStartHooks).not.toHaveBeenCalled();
  });

  it("returns help for setup --help", async () => {
    const out = await setupCommand(["--help"]);
    expect(out).toContain("usage: confluence-axi setup hooks");
    expect(installSessionStartHooks).not.toHaveBeenCalled();
  });

  it("rejects an unknown setup action with its name in the message", async () => {
    await expect(setupCommand(["hoks"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Unknown setup action: hoks",
    });
  });

  it("reports a partial install when a target write fails", async () => {
    installSessionStartHooks.mockClear();
    installSessionStartHooks.mockImplementationOnce((options) => {
      options?.onError?.("~/.claude/settings.json: Unexpected token } in JSON");
    });
    const out = await setupCommand(["hooks"]);
    expect(out).toContain("status: partial");
    expect(out).not.toContain("status: installed");
    expect(out).toContain("failures[1]:");
    expect(out).toContain("~/.claude/settings.json: Unexpected token } in JSON");
    expect(out).toContain("was NOT written");
  });

  it("lists every failing target and flattens multi-line messages", async () => {
    installSessionStartHooks.mockClear();
    installSessionStartHooks.mockImplementationOnce((options) => {
      options?.onError?.("~/.claude/settings.json: EACCES");
      options?.onError?.("~/.codex/config.toml: parse error\n  at line 3");
    });
    const out = await setupCommand(["hooks"]);
    expect(out).toContain("failures[2]:");
    expect(out).toContain("~/.claude/settings.json: EACCES");
    expect(out).toContain("~/.codex/config.toml: parse error at line 3");
  });

  it("still reports a clean install when onError never fires", async () => {
    installSessionStartHooks.mockClear();
    const out = await setupCommand(["hooks"]);
    expect(out).toContain("status: installed");
    expect(out).not.toContain("failures[");
  });
});
