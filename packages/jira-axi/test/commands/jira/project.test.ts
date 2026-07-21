import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAcliRunner } from "../../../src/acli.js";
import { projectCommand } from "../../../src/commands/jira/project.js";
import { makeAcliFake } from "../../helpers/acliFake.js";
import {
  FROZEN_NOW,
  projectListPayload,
  projectViewPayload,
} from "../../fixtures/acli.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  setAcliRunner(null);
  vi.useRealTimers();
});

describe("project list", () => {
  it("renders the TOON list from the recorded fixture (contract snapshot)", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "list", result: projectListPayload },
    ]);
    setAcliRunner(runner);

    const out = await projectCommand(["list"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2
      projects[2]{key,name,type}:
        TEAM,Team Project,software
        OPS,Operations,service_desk
      help[2]:
        Run \`jira-axi project view <KEY>\` to view a project
        Run \`jira-axi workitem list --project <KEY>\` to list its work items"
    `);
  });

  it("passes --limit through and rejects invalid values", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "list", result: projectListPayload },
    ]);
    setAcliRunner(runner);

    await projectCommand(["list", "--limit", "5"]);
    expect(calls[0].args).toContain("5");

    await expect(
      projectCommand(["list", "--limit", "-1"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("suggests an auth check when no projects are visible", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "list", result: { values: [] } },
    ]);
    setAcliRunner(runner);

    const out = await projectCommand(["list"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("auth status");
  });
});

describe("project view", () => {
  it("renders the detail with lead and id", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "view", result: projectViewPayload },
    ]);
    setAcliRunner(runner);

    const out = await projectCommand(["view", "team"]);
    expect(calls[0].args).toEqual([
      "jira",
      "project",
      "view",
      "--key",
      "TEAM",
      "--json",
    ]);
    expect(out).toContain("key: TEAM");
    expect(out).toContain("name: Team Project");
    expect(out).toContain("type: software");
    expect(out).toContain("lead: Jane Doe");
    expect(out).toContain("workitem list --project TEAM");
  });

  it("requires a project key", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(projectCommand(["view"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("throws VALIDATION_ERROR on an unknown subcommand", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(projectCommand(["archive"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown project subcommand: archive"),
    });
  });
});
