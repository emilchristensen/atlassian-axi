import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth data sources so the dashboard's auth line is deterministic and
// does no real shell-out / disk read.
const acli = vi.hoisted(() => ({
  acliInstalled: vi.fn(),
  acliJson: vi.fn(),
}));
const config = vi.hoisted(() => ({ resolveCredential: vi.fn() }));
const confluence = vi.hoisted(() => ({
  confluenceJson: vi.fn(),
  setConfluenceFetch: vi.fn(),
}));
vi.mock("../../src/acli.js", () => acli);
vi.mock("../../src/config.js", () => config);
vi.mock("../../src/confluence.js", () => confluence);

const { homeCommand } = await import("../../src/commands/home.js");

beforeEach(() => {
  acli.acliInstalled.mockReset().mockResolvedValue(true);
  acli.acliJson.mockReset().mockResolvedValue([]);
  config.resolveCredential.mockReset().mockResolvedValue({ sources: {} });
  confluence.confluenceJson.mockReset().mockResolvedValue({ results: [] });
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

  it("caps the workitems and spaces fetches at their budgets so a hung backend cannot stall the hook", async () => {
    vi.useFakeTimers();
    try {
      config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
      acli.acliJson.mockReturnValue(new Promise(() => {})); // never settles
      confluence.confluenceJson.mockReturnValue(new Promise(() => {}));
      const pending = homeCommand([]);
      await vi.advanceTimersByTimeAsync(2_100);
      const out = await pending;
      expect(out).toContain("auth: ok");
      expect(out).not.toContain("my_open_workitems");
      expect(out).not.toContain("spaces:");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the spaces count when authenticated", async () => {
    config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({
      results: [{ id: "111" }, { id: "222" }],
      _links: {},
    });
    const out = await homeCommand([]);
    expect(out).toContain("spaces: 2");
  });

  it("marks the spaces count as truncated when a next cursor exists", async () => {
    config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({
      results: [{ id: "111" }, { id: "222" }],
      _links: { next: "/wiki/api/v2/spaces?cursor=abc" },
    });
    const out = await homeCommand([]);
    expect(out).toContain("spaces: 2+");
  });

  it("omits the spaces line when unauthenticated or when the REST call fails", async () => {
    // Unauthenticated: no REST call attempted at all.
    const out = await homeCommand([]);
    expect(out).not.toContain("spaces:");
    expect(confluence.confluenceJson).not.toHaveBeenCalled();

    // Authenticated but the REST call blows up: line degrades away silently.
    config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockRejectedValue(new Error("network down"));
    const degraded = await homeCommand([]);
    expect(degraded).toContain("auth: ok");
    expect(degraded).not.toContain("spaces:");
  });

  it("advertises the confluence command now that it is routed", async () => {
    const out = await homeCommand([]);
    expect(out).toContain("commands: auth, jira, confluence, setup");
  });

  it("reports acli not installed alongside the credential state", async () => {
    acli.acliInstalled.mockResolvedValue(false);
    const out = await homeCommand([]);
    expect(out).toContain("auth: not configured (acli not installed)");
  });

  it("serves the Confluence half without acli (credential ok, no acli)", async () => {
    acli.acliInstalled.mockResolvedValue(false);
    config.resolveCredential.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({
      results: [{ id: "111" }],
      _links: {},
    });
    const out = await homeCommand([]);
    expect(out).toContain("auth: ok (Confluence only");
    expect(out).toContain("spaces: 1");
    expect(out).not.toContain("my_open_workitems");
    expect(acli.acliJson).not.toHaveBeenCalled();
  });

  it("never throws even when a data source rejects (session-hook safety)", async () => {
    acli.acliInstalled.mockRejectedValue(new Error("boom"));
    const out = await homeCommand([]);
    expect(out).toContain("auth: not configured");
    await expect(homeCommand([])).resolves.toBeTypeOf("string");
  });
});
