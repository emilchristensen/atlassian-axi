import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAcliRunner } from "../../../src/acli.js";
import { boardCommand } from "../../../src/commands/jira/board.js";
import { jiraCommand } from "../../../src/commands/jira/index.js";
import { makeAcliFake } from "../../helpers/acliFake.js";
import {
  FROZEN_NOW,
  boardProjectsPayload,
  boardSearchPayload,
  boardSprintsPayload,
  boardViewPayload,
} from "../../fixtures/acli.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  setAcliRunner(null);
  vi.useRealTimers();
});

describe("board list", () => {
  it("renders the TOON list from the recorded fixture (contract snapshot)", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "search", result: boardSearchPayload },
    ]);
    setAcliRunner(runner);

    const out = await boardCommand(["list"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2 of 35 total (use --limit 35 for all)
      boards[2]{id,name,type,location}:
        1013,Team Scrum,scrum,Team Project (TEAM)
        1333,Ops Kanban,kanban,Operations (OPS)
      help[2]:
        Run \`atlassian-axi jira board list-sprints <ID>\` to list a board's sprints
        Run \`atlassian-axi jira board view <ID>\` to view a board"
    `);
  });

  it("maps list onto acli board search and passes filters through", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "search", result: boardSearchPayload },
    ]);
    setAcliRunner(runner);

    await boardCommand([
      "list",
      "--name",
      "scrum",
      "--project",
      "TEAM",
      "--type",
      "scrum",
      "--limit",
      "5",
    ]);
    expect(calls[0].args).toEqual([
      "jira",
      "board",
      "search",
      "--limit",
      "5",
      "--json",
      "--name",
      "scrum",
      "--project",
      "TEAM",
      "--type",
      "scrum",
    ]);
  });

  it("rejects an invalid --type before shelling out", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      boardCommand(["list", "--type", "agile"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("suggests broadening when no boards match", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "search", result: { values: [] } },
    ]);
    setAcliRunner(runner);

    const out = await boardCommand(["list", "--name", "nope"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("drop filters to broaden");
  });
});

describe("board view", () => {
  it("renders the detail and passes the ID as --id", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "view", result: boardViewPayload },
    ]);
    setAcliRunner(runner);

    const out = await boardCommand(["view", "1013"]);
    expect(calls[0].args).toEqual([
      "jira",
      "board",
      "view",
      "--id",
      "1013",
      "--json",
    ]);
    expect(out).toContain("id: 1013");
    expect(out).toContain("name: Team Scrum");
    expect(out).toContain("location: Team Project (TEAM)");
    expect(out).toContain("board list-sprints 1013");
  });

  it("requires a numeric board ID", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(boardCommand(["view"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(boardCommand(["view", "TEAM"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("board list-sprints", () => {
  it("renders sprints with date-only start/end (contract snapshot)", async () => {
    const { runner } = makeAcliFake([
      {
        match: (args) => args[2] === "list-sprints",
        result: boardSprintsPayload,
      },
    ]);
    setAcliRunner(runner);

    const out = await boardCommand(["list-sprints", "1013"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2 of 10 total (use --limit 10 for all)
      sprints[2]{id,name,state,start,end}:
        5205,Sprint 12,active,2026-07-07,2026-07-18
        5206,Sprint 11,closed,2026-06-22,2026-07-04
      help[2]:
        Run \`atlassian-axi jira sprint list-workitems <SPRINT_ID> --board 1013\` to list a sprint's work items
        Run \`atlassian-axi jira sprint view <SPRINT_ID>\` to view a sprint"
    `);
  });

  it("validates --state values and passes them through", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "list-sprints",
        result: boardSprintsPayload,
      },
    ]);
    setAcliRunner(runner);

    await boardCommand(["list-sprints", "1013", "--state", "active,closed"]);
    expect(calls[0].args).toContain("--state");
    expect(calls[0].args).toContain("active,closed");

    await expect(
      boardCommand(["list-sprints", "1013", "--state", "open"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("hints at --state when a board has no sprints in the default view", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "list-sprints", result: { sprints: [] } },
    ]);
    setAcliRunner(runner);

    const out = await boardCommand(["list-sprints", "1013"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("--state future,active,closed");
  });
});

describe("board list-projects", () => {
  it("renders the board's projects (string ids, `type` key)", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "list-projects",
        result: boardProjectsPayload,
      },
    ]);
    setAcliRunner(runner);

    const out = await boardCommand(["list-projects", "1013"]);
    expect(calls[0].args).toEqual([
      "jira",
      "board",
      "list-projects",
      "--id",
      "1013",
      "--limit",
      "30",
      "--json",
    ]);
    expect(out).toContain("count: 1 of 1 total");
    expect(out).toContain("TEAM,Team Project,software");
  });
});

describe("board routing and help", () => {
  it("routes through the jira router", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "search", result: boardSearchPayload },
    ]);
    setAcliRunner(runner);

    const out = await jiraCommand(["board", "list"]);
    expect(out).toContain("boards[2]");
  });

  it("returns help for --help and throws on unknown subcommands", async () => {
    expect(await boardCommand(["--help"])).toContain("list-sprints <ID>");
    expect(await boardCommand([])).toContain("usage: atlassian-axi jira board");
    await expect(boardCommand(["destroy"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown board subcommand: destroy"),
    });
  });
});
