import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock acli so the dashboard's state is deterministic and does no real
// shell-out. jira-axi delegates auth to acli, so there is no config/credential
// source to mock — the acli probe is the only data source.
const acli = vi.hoisted(() => ({
  acliInstalled: vi.fn(),
  acliJson: vi.fn(),
}));
vi.mock("../../src/acli.js", () => acli);

const { homeCommand } = await import("../../src/commands/home.js");

beforeEach(() => {
  acli.acliInstalled.mockReset().mockResolvedValue(true);
  acli.acliJson.mockReset().mockResolvedValue([]);
});

describe("homeCommand", () => {
  it("reports acli not installed and does not probe for work items", async () => {
    acli.acliInstalled.mockResolvedValue(false);
    const out = await homeCommand();
    expect(out).toContain("acli: not installed");
    expect(out).toContain("acli jira auth login");
    expect(out).toContain("help[1]:");
    expect(acli.acliJson).not.toHaveBeenCalled();
  });

  it("reports acli installed when the probe succeeds", async () => {
    const out = await homeCommand();
    expect(out).toContain("acli: installed");
    expect(out).not.toContain("run `acli jira auth login`");
  });

  it("renders my open work items when the probe returns some (best-effort)", async () => {
    acli.acliJson.mockResolvedValue([
      {
        key: "TEAM-1",
        fields: { summary: "Fix login", status: { name: "In Progress" } },
      },
    ]);
    const out = await homeCommand();
    expect(out).toContain("my_open_workitems[1]{key,summary,status}:");
    expect(out).toContain("TEAM-1,Fix login,wip");
  });

  it("omits the workitems block when logged in but nothing is open", async () => {
    acli.acliJson.mockResolvedValue([]);
    const out = await homeCommand();
    expect(out).toContain("acli: installed");
    expect(out).not.toContain("my_open_workitems");
  });

  it("reports a login hint when the probe fails (not logged in / unreachable)", async () => {
    acli.acliJson.mockRejectedValue(new Error("unauthorized"));
    const out = await homeCommand();
    expect(out).toContain("acli: installed (run `acli jira auth login`");
    expect(out).not.toContain("my_open_workitems");
  });

  it("caps the workitems fetch at its budget so a hung acli cannot stall the hook", async () => {
    vi.useFakeTimers();
    try {
      acli.acliJson.mockReturnValue(new Promise(() => {})); // never settles
      const pending = homeCommand();
      await vi.advanceTimersByTimeAsync(2_100);
      const out = await pending;
      expect(out).toContain("acli: installed (run `acli jira auth login`");
      expect(out).not.toContain("my_open_workitems");
    } finally {
      vi.useRealTimers();
    }
  });

  it("advertises the flattened jira-axi commands", async () => {
    const out = await homeCommand();
    expect(out).toContain(
      "commands: workitem, project, board, sprint, filter, dashboard, field, setup",
    );
  });

  it("never throws even when acliInstalled rejects (session-hook safety)", async () => {
    acli.acliInstalled.mockRejectedValue(new Error("boom"));
    const out = await homeCommand();
    expect(out).toContain("acli: not installed");
    await expect(homeCommand()).resolves.toBeTypeOf("string");
  });
});
