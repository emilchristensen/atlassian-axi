import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth data sources so the dashboard's auth line is deterministic and
// does no real disk read / network call.
const config = vi.hoisted(() => ({ resolveAuthMode: vi.fn() }));
const confluence = vi.hoisted(() => ({
  confluenceJson: vi.fn(),
  setConfluenceFetch: vi.fn(),
}));
vi.mock("../../src/config.js", () => config);
vi.mock("../../src/confluence.js", () => confluence);

const { homeCommand } = await import("../../src/commands/home.js");

beforeEach(() => {
  config.resolveAuthMode
    .mockReset()
    .mockResolvedValue({ mode: "none", missing: ["site", "email", "apiToken"] });
  confluence.confluenceJson.mockReset().mockResolvedValue({ results: [] });
});

const FULL_CREDENTIAL = {
  mode: "api-token",
  credential: {
    site: "acme.atlassian.net",
    email: "me@acme.com",
    apiToken: "tok",
  },
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

  it("falls back to the stored credential's site when no flag/env context exists", async () => {
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    const out = await homeCommand([]);
    // Regression: the dashboard said "site: not configured" while auth was ok.
    expect(out).toContain("site: acme.atlassian.net");
    expect(out).not.toContain("site: not configured");
  });

  it("an explicit context site wins over the stored credential's site", async () => {
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    const out = await homeCommand([], { site: "other.atlassian.net", source: "flag" });
    expect(out).toContain("site: other.atlassian.net");
  });

  it("reports auth ok when a full credential resolves", async () => {
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    const out = await homeCommand([]);
    expect(out).toContain("auth: ok");
    expect(out).toContain("api-token");
  });

  it("caps the spaces fetch at its budget so a hung backend cannot stall the hook", async () => {
    vi.useFakeTimers();
    try {
      config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
      confluence.confluenceJson.mockReturnValue(new Promise(() => {})); // never settles
      const pending = homeCommand([]);
      await vi.advanceTimersByTimeAsync(2_100);
      const out = await pending;
      expect(out).toContain("auth: ok");
      expect(out).not.toContain("spaces:");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the spaces count when authenticated", async () => {
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({
      results: [{ id: "111" }, { id: "222" }],
      _links: {},
    });
    const out = await homeCommand([]);
    expect(out).toContain("spaces: 2");
  });

  it("marks the spaces count as truncated when a next cursor exists", async () => {
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({
      results: [{ id: "111" }, { id: "222" }],
      _links: { next: "/wiki/api/v2/spaces?cursor=abc" },
    });
    const out = await homeCommand([]);
    expect(out).toContain("spaces: 2+");
  });

  it("renders live space ROWS, not just the count (content first)", async () => {
    // The keys are already fetched and are exactly what `page create --space
    // <KEY>` / `search "space = KEY"` need — a bare count forces a second call.
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({
      results: [
        { id: "111", key: "ENG", name: "Engineering", type: "global" },
        { id: "222", key: "DOCS", name: "Documentation", type: "global" },
      ],
      _links: {},
    });
    const out = await homeCommand([]);
    expect(out).toContain("spaces: 2");
    expect(out).toContain("spaces[2]{key,name,type,id}:");
    expect(out).toContain("ENG,Engineering,global");
    expect(out).toContain("DOCS,Documentation,global");
  });

  it("caps the rendered rows at five while the count still reports the probe", async () => {
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({
      results: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        key: `S${i}`,
        name: `Space ${i}`,
        type: "global",
      })),
      _links: { next: "/wiki/api/v2/spaces?cursor=abc" },
    });
    const out = await homeCommand([]);
    expect(out).toContain("spaces: 8+");
    expect(out).toContain("spaces[5]{key,name,type,id}:");
    expect(out).not.toContain("S5,");
  });

  it("omits the spaces rows when the probe returns nothing", async () => {
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockResolvedValue({ results: [], _links: {} });
    const out = await homeCommand([]);
    expect(out).toContain("spaces: 0");
    expect(out).not.toContain("spaces[");
  });

  it("omits the spaces line when unauthenticated or when the REST call fails", async () => {
    // Unauthenticated: no REST call attempted at all.
    const out = await homeCommand([]);
    expect(out).not.toContain("spaces:");
    expect(confluence.confluenceJson).not.toHaveBeenCalled();

    // Authenticated but the REST call blows up: line degrades away silently.
    config.resolveAuthMode.mockResolvedValue(FULL_CREDENTIAL);
    confluence.confluenceJson.mockRejectedValue(new Error("network down"));
    const degraded = await homeCommand([]);
    expect(degraded).toContain("auth: ok");
    expect(degraded).not.toContain("spaces:");
  });

  it("advertises the flattened confluence-axi commands", async () => {
    const out = await homeCommand([]);
    expect(out).toContain("commands: auth, page, space, search, setup");
  });

  it("never throws even when a data source rejects (session-hook safety)", async () => {
    config.resolveAuthMode.mockRejectedValue(new Error("boom"));
    const out = await homeCommand([]);
    expect(out).toContain("auth: not configured");
    await expect(homeCommand([])).resolves.toBeTypeOf("string");
  });

  it("falls back to the OAuth session's site in oauth mode", async () => {
    config.resolveAuthMode.mockResolvedValue({
      mode: "oauth",
      oauth: {
        clientId: "cid",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() + 3_600_000,
        cloudId: "cloud-1",
        site: "acme.atlassian.net",
        scopes: "",
      },
    });
    const out = await homeCommand([]);
    expect(out).toContain("site: acme.atlassian.net");
    expect(out).toContain("auth: ok (oauth");
  });

  it("keeps the never-throw contract when resolveAuthMode itself rejects", async () => {
    config.resolveAuthMode.mockRejectedValue(new Error("config unreadable"));
    const out = await homeCommand([]);
    expect(out).toContain("site: not configured");
    expect(out).toContain("auth: not configured");
  });
});
