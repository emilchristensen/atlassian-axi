import { describe, expect, it } from "vitest";
import { homeCommand } from "../../src/commands/home.js";

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

  it("never throws (session-hook safety contract)", async () => {
    await expect(homeCommand([])).resolves.toBeTypeOf("string");
  });
});
