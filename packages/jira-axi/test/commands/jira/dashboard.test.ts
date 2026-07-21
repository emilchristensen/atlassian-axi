import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAcliRunner } from "../../../src/acli.js";
import { dashboardCommand } from "../../../src/commands/jira/dashboard.js";
import { makeAcliFake } from "../../helpers/acliFake.js";
import { FROZEN_NOW, dashboardSearchPayload } from "../../fixtures/acli.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  setAcliRunner(null);
  vi.useRealTimers();
});

describe("dashboard list", () => {
  it("maps list onto acli dashboard search (contract snapshot)", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "search",
        result: dashboardSearchPayload,
      },
    ]);
    setAcliRunner(runner);

    const out = await dashboardCommand(["list"]);
    expect(calls[0].args).toEqual([
      "jira",
      "dashboard",
      "search",
      "--limit",
      "30",
      "--json",
    ]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2
      dashboards[2]{id,name,owner}:
        "12805",Team Dashboard,Jane Doe
        "12745",Release Overview,John Smith
      help[1]:
        Narrow with \`jira-axi dashboard list --name <substring> --owner <email>\`"
    `);
  });

  it("passes --name/--owner/--limit through", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "search", result: [] },
    ]);
    setAcliRunner(runner);

    const out = await dashboardCommand([
      "list",
      "--name",
      "release",
      "--owner",
      "jane@acme.com",
      "--limit",
      "5",
    ]);
    expect(calls[0].args).toEqual([
      "jira",
      "dashboard",
      "search",
      "--limit",
      "5",
      "--json",
      "--name",
      "release",
      "--owner",
      "jane@acme.com",
    ]);
    expect(out).toContain("count: 0");
    expect(out).toContain("Broaden the search");
  });

  it("returns help for --help and throws on unknown subcommands", async () => {
    expect(await dashboardCommand(["--help"])).toContain("dashboard list");
    expect(await dashboardCommand([])).toContain(
      "usage: jira-axi dashboard",
    );
    await expect(dashboardCommand(["view"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown dashboard subcommand: view"),
    });
  });
});
