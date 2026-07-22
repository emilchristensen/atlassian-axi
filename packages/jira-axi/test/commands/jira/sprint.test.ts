import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAcliRunner } from "../../../src/acli.js";
import { sprintCommand } from "../../../src/commands/jira/sprint.js";
import { dateOnly } from "../../../src/commands/jira/shared.js";
import { makeAcliFake, type AcliCall } from "../../helpers/acliFake.js";
import {
  FROZEN_NOW,
  sprintCreatePayload,
  sprintViewClosedPayload,
  sprintViewCreatedPayload,
  sprintViewPayload,
  sprintWorkitemsPayload,
} from "../../fixtures/acli.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  setAcliRunner(null);
  vi.useRealTimers();
});

function updateCalls(calls: AcliCall[]): AcliCall[] {
  return calls.filter((c) => c.args[2] === "update");
}

describe("sprint view", () => {
  it("renders the detail with date-only dates (contract snapshot)", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "view", result: sprintViewPayload },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand(["view", "5205"]);
    expect(calls[0].args).toEqual([
      "jira",
      "sprint",
      "view",
      "--id",
      "5205",
      "--json",
    ]);
    expect(out).toMatchInlineSnapshot(`
      "sprint:
        id: 5205
        name: Sprint 12
        state: active
        start: 2026-07-07
        end: 2026-07-18
        goal: Ship checkout
        board: 1013
        completed: none
      help[2]:
        Run \`jira-axi sprint list-workitems 5205 --board <BOARD_ID>\` to list its work items
        Run \`jira-axi sprint update 5205 --state <future|active|closed>\` to change its state"
    `);
  });

  it("requires a numeric sprint ID", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(sprintCommand(["view", "abc"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("sprint list-workitems", () => {
  it("renders work items via the shared workitem schema", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "list-workitems",
        result: sprintWorkitemsPayload,
      },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand(["list-workitems", "5205", "--board", "1013"]);
    expect(calls[0].args).toEqual([
      "jira",
      "sprint",
      "list-workitems",
      "--sprint",
      "5205",
      "--board",
      "1013",
      "--limit",
      "30",
      "--json",
    ]);
    expect(out).toContain("count: 2 of 12 total");
    expect(out).toContain("TEAM-1,Fix login redirect loop,wip,Jane Doe");
    expect(out).toContain("TEAM-2,Add audit log export,todo,unassigned");
  });

  it("surfaces --fields values that acli silently dropped", async () => {
    const { runner } = makeAcliFake([
      {
        match: (args) => args[2] === "list-workitems",
        result: sprintWorkitemsPayload,
      },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand([
      "list-workitems",
      "5205",
      "--board",
      "1013",
      "--fields",
      "summary,updated",
    ]);
    expect(out).toContain(
      "note: acli did not return field(s) updated (unsupported by sprint list-workitems)",
    );
    expect(out).not.toContain("field(s) summary");
  });

  it("requires --board (agile API constraint) with a helpful message", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      sprintCommand(["list-workitems", "5205"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("passes --jql and --fields through and renders the custom schema", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "list-workitems",
        result: sprintWorkitemsPayload,
      },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand([
      "list-workitems",
      "5205",
      "--board",
      "1013",
      "--jql",
      "status = Done",
      "--fields",
      "summary,priority",
    ]);
    expect(calls[0].args).toContain("--jql");
    expect(calls[0].args).toContain("status = Done");
    expect(calls[0].args).toContain("--fields");
    expect(calls[0].args).toContain("summary,priority");
    expect(out).toContain("workitems[2]{key,summary,priority}");
  });

  it("points at board list-sprints when the sprint has no work items", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "list-workitems", result: { issues: [] } },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand([
      "list-workitems",
      "5205",
      "--board",
      "1013",
    ]);
    expect(out).toContain("count: 0");
    expect(out).toContain("board list-sprints");
  });
});

describe("sprint create", () => {
  it("creates, then re-fetches and renders the authoritative sprint", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "create", result: sprintCreatePayload },
      { match: (args) => args[2] === "view", result: sprintViewCreatedPayload },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand([
      "create",
      "--board",
      "1013",
      "--name",
      "Sprint 13",
      "--goal",
      "Prepare release",
    ]);
    expect(calls[0].args).toEqual([
      "jira",
      "sprint",
      "create",
      "--board",
      "1013",
      "--name",
      "Sprint 13",
      "--json",
      "--goal",
      "Prepare release",
    ]);
    expect(calls[1].args).toContain("view");
    expect(out).toContain("id: 5300");
    expect(out).toContain("state: future");
    expect(out).toContain("sprint view 5300");
  });

  it("requires --board and --name", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      sprintCommand(["create", "--board", "1013"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      sprintCommand(["create", "--name", "Sprint 13"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("degrades to a success message when acli's create shape drifts", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "create", result: { ok: true } },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand([
      "create",
      "--board",
      "1013",
      "--name",
      "Sprint 13",
    ]);
    expect(out).toContain("Created (id not detected in acli output)");
    expect(out).toContain("Sprint 13");
    // Suggestions block present even on the fallback path (review finding).
    expect(out).toContain("board list-sprints <BOARD_ID>");
  });
});

describe("sprint update", () => {
  it("is a no-op success when the sprint is already in the target state", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "view", result: sprintViewClosedPayload },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand(["update", "5205", "--state", "closed"]);
    expect(updateCalls(calls)).toHaveLength(0);
    expect(out).toContain("message: Already closed");
    expect(out).toContain("state: closed");
  });

  it("updates then re-fetches the authoritative post-state", async () => {
    let views = 0;
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "view" && ++views === 1,
        result: sprintViewPayload,
      },
      { match: (args) => args[2] === "view", result: sprintViewClosedPayload },
      { match: (args) => args[2] === "update", result: {} },
    ]);
    setAcliRunner(runner);

    const out = await sprintCommand(["update", "5205", "--state", "closed"]);
    const update = updateCalls(calls)[0];
    expect(update.args).toEqual([
      "jira",
      "sprint",
      "update",
      "--id",
      "5205",
      "--json",
      "--state",
      "closed",
    ]);
    expect(out).toContain("state: closed");
    expect(out).toContain("completed: 2026-07-14");
  });

  it("drops a --state that already matches so other changes still apply", async () => {
    let views = 0;
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "view" && ++views === 1,
        result: sprintViewClosedPayload,
      },
      { match: (args) => args[2] === "view", result: sprintViewClosedPayload },
      { match: (args) => args[2] === "update", result: {} },
    ]);
    setAcliRunner(runner);

    await sprintCommand([
      "update",
      "5205",
      "--name",
      "Sprint 12 - Final",
      "--state",
      "closed",
    ]);
    const update = updateCalls(calls)[0];
    expect(update.args).toContain("--name");
    // The agile API rejects same-state transitions; the matching --state must
    // not reach acli while the rename still goes through.
    expect(update.args).not.toContain("--state");
  });

  it("rejects an invalid --state and an empty update", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      sprintCommand(["update", "5205", "--state", "done"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(sprintCommand(["update", "5205"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("returns help for --help and throws on unknown subcommands", async () => {
    expect(await sprintCommand(["--help"])).toContain("list-workitems");
    await expect(sprintCommand(["close"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown sprint subcommand: close"),
    });
  });
});

describe("dateOnly", () => {
  it("takes the date from the timestamp's own offset, never the machine TZ", () => {
    // 23:30+0200 is 21:30Z — UTC conversion would keep 07-13, but a
    // negative-offset machine TZ could render 07-12/07-13 inconsistently.
    expect(dateOnly("2026-07-13T23:30:00.000+0200")).toBe("2026-07-13");
    expect(dateOnly("2026-07-13T01:30:00.000-0700")).toBe("2026-07-13");
    expect(dateOnly("2026-07-07T16:34:59.388Z")).toBe("2026-07-07");
    expect(dateOnly("2026-07-07")).toBe("2026-07-07");
    expect(dateOnly("")).toBeNull();
    expect(dateOnly("not a date")).toBeNull();
    expect(dateOnly(null)).toBeNull();
  });
});

describe("sprint extra-positional guard", () => {
  it("rejects a board passed as a positional (list-workitems 5205 1013) instead of dropping it", async () => {
    // Forgetting --board and writing `list-workitems 5205 1013` would otherwise
    // silently ignore 1013 and fail obscurely; the guard names the fix.
    const { runner, calls } = makeAcliFake([]);
    setAcliRunner(runner);
    await expect(
      sprintCommand(["list-workitems", "5205", "1013"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls.filter((c) => c.args[0] !== "--version")).toHaveLength(0);
  });
});
