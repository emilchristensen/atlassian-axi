import { describe, expect, it, vi } from "vitest";

// Mock the SDK hook installer so the test never touches the real
// ~/.claude / ~/.codex / ~/.config/opencode files on disk.
const { installSessionStartHooks } = vi.hoisted(() => ({
  installSessionStartHooks: vi.fn(),
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

  it("rejects a missing setup action", async () => {
    await expect(setupCommand([])).rejects.toBeInstanceOf(AxiError);
  });
});
