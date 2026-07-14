import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth data sources so the dashboard's auth line is deterministic and
// does no real shell-out / disk read.
const acli = vi.hoisted(() => ({ acliInstalled: vi.fn() }));
const config = vi.hoisted(() => ({ resolveCredential: vi.fn() }));
vi.mock("../../src/acli.js", () => acli);
vi.mock("../../src/config.js", () => config);

const { homeCommand } = await import("../../src/commands/home.js");

beforeEach(() => {
  acli.acliInstalled.mockReset().mockResolvedValue(true);
  config.resolveCredential.mockReset().mockResolvedValue({ sources: {} });
});

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
    config.resolveCredential.mockResolvedValue({
      site: "acme.atlassian.net",
      email: "me@acme.com",
      apiToken: "tok",
      sources: {},
    });
    const out = await homeCommand([]);
    expect(out).toContain("auth: ok");
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
