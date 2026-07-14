import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth data sources so the dashboard's auth line is deterministic and
// does no real shell-out / disk read.
const acli = vi.hoisted(() => ({
  acliInstalled: vi.fn(),
  acliJson: vi.fn(),
}));
const config = vi.hoisted(() => ({ resolveCredential: vi.fn() }));
vi.mock("../../src/acli.js", () => acli);
vi.mock("../../src/config.js", () => config);

const { homeCommand } = await import("../../src/commands/home.js");

beforeEach(() => {
  acli.acliInstalled.mockReset().mockResolvedValue(true);
  acli.acliJson.mockReset().mockResolvedValue([]);
  config.resolveCredential.mockReset().mockResolvedValue({ sources: {} });
});

const FULL_CREDENTIAL = {
  site: "acme.atlassian.net",
  email: "me@acme.com",
  apiToken: "tok",
  sources: {},
};

describe("homeCommand", () => {
  it("reports an unconfigured site and auth state", async () => {
    const out = await homeCommand([]);
    expect(out).toContain("site: not configured");
    expect(out).toContain("auth: not configured");
    expect(out).toContain("help[1]:");
  });

  it("reports the resolved site when a context is provided", async () => {
    const out = await homeCommand([], { site: "acme.atlassian.net", source: "env" });
    expect(out).toContain("site: acme.atlassian.net");
  });

  it("reports auth ok when a full credential resolves", async () => {
    config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
    const out = await homeCommand([]);
    expect(out).toContain("auth: ok");
  });

  it("renders my open work items when authenticated (best-effort)", async () => {
    config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
    acli.acliJson.mockResolvedValue([
      {
        key: "TEAM-1",
        fields: { summary: "Fix login", status: { name: "In Progress" } },
      },
    ]);
    const out = await homeCommand([]);
    expect(out).toContain("my_open_workitems[1]{key,summary,status}:");
    expect(out).toContain("TEAM-1,Fix login,wip");
  });

  it("omits the workitems block when unauthenticated or when acli fails", async () => {
    // Unauthenticated: no search attempted at all.
    const out = await homeCommand([]);
    expect(out).not.toContain("my_open_workitems");
    expect(acli.acliJson).not.toHaveBeenCalled();

    // Authenticated but the search blows up: block degrades away silently.
    config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
    acli.acliJson.mockRejectedValue(new Error("network down"));
    const degraded = await homeCommand([]);
    expect(degraded).toContain("auth: ok");
    expect(degraded).not.toContain("my_open_workitems");
  });

  it("caps the workitems fetch at its budget so a hung acli cannot stall the hook", async () => {
    vi.useFakeTimers();
    try {
      config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
      acli.acliJson.mockReturnValue(new Promise(() => {})); // never settles
      const pending = homeCommand([]);
      await vi.advanceTimersByTimeAsync(2_100);
      const out = await pending;
      expect(out).toContain("auth: ok");
      expect(out).not.toContain("my_open_workitems");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not advertise the unrouted confluence command", async () => {
    const out = await homeCommand([]);
    expect(out).not.toContain("confluence");
  });

  it("reports acli not installed", async () => {
    acli.acliInstalled.mockResolvedValue(false);
    const out = await homeCommand([]);
    expect(out).toContain("auth: acli not installed");
  });

  it("never throws even when a data source rejects (session-hook safety)", async () => {
    acli.acliInstalled.mockRejectedValue(new Error("boom"));
    const out = await homeCommand([]);
    expect(out).toContain("auth: not configured");
    await expect(homeCommand([])).resolves.toBeTypeOf("string");
  });
});
