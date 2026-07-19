import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAcliRunner } from "../../../src/acli.js";
import { filterCommand } from "../../../src/commands/jira/filter.js";
import { makeAcliFake, type AcliCall } from "../../helpers/acliFake.js";
import {
  FROZEN_NOW,
  filterListPayload,
  filterSearchPayload,
  filterViewPayload,
  filterViewUpdatedPayload,
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

describe("filter list", () => {
  it("defaults to my filters and renders the list", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "list", result: filterListPayload },
    ]);
    setAcliRunner(runner);

    const out = await filterCommand(["list"]);
    expect(calls[0].args).toEqual(["jira", "filter", "list", "--my", "--json"]);
    expect(out).toContain("count: 1");
    expect(out).toContain('"33312",My Open Bugs,Jane Doe');
  });

  it("switches to --favourite when asked", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "list", result: filterListPayload },
    ]);
    setAcliRunner(runner);

    await filterCommand(["list", "--favourite"]);
    expect(calls[0].args).toContain("--favourite");
    expect(calls[0].args).not.toContain("--my");
  });

  it("applies --limit client-side (acli filter list has no --limit)", async () => {
    const many = {
      values: Array.from({ length: 3 }, (_, i) => ({
        id: String(1000 + i),
        name: `Filter ${i}`,
        owner: { displayName: "Jane Doe" },
      })),
    };
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "list", result: many },
    ]);
    setAcliRunner(runner);

    const out = await filterCommand(["list", "--limit", "2"]);
    // No --limit forwarded to acli — the fetch is unbounded by design.
    expect(calls[0].args).toEqual(["jira", "filter", "list", "--my", "--json"]);
    expect(out).toContain("count: 3 (showing first 2)");
    expect(out).toContain("Filter 1");
    expect(out).not.toContain("Filter 2");

    await expect(
      filterCommand(["list", "--limit", "0"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("suggests search when no owned filters exist", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "list", result: { values: [] } },
    ]);
    setAcliRunner(runner);

    const out = await filterCommand(["list"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("filter search");
  });
});

describe("filter search", () => {
  it("renders the bare-array payload and passes filters through", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "search", result: filterSearchPayload },
    ]);
    setAcliRunner(runner);

    const out = await filterCommand([
      "search",
      "--name",
      "bugs",
      "--owner",
      "jane@acme.com",
    ]);
    expect(calls[0].args).toEqual([
      "jira",
      "filter",
      "search",
      "--limit",
      "30",
      "--json",
      "--name",
      "bugs",
      "--owner",
      "jane@acme.com",
    ]);
    expect(out).toContain("count: 2");
    expect(out).toContain('"33312",My Open Bugs,Jane Doe');
    expect(out).toContain('"29941",Team Backlog,John Smith');
  });

  it("treats a bare positional as --name shorthand instead of discarding it", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "search", result: filterSearchPayload },
    ]);
    setAcliRunner(runner);

    await filterCommand(["search", "bolia"]);
    expect(calls[0].args).toContain("--name");
    expect(calls[0].args).toContain("bolia");
  });

  it("rejects a positional combined with --name (ambiguous query)", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      filterCommand(["search", "bolia", "--name", "other"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("filter view", () => {
  it("renders the detail including the JQL (contract snapshot)", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "view", result: filterViewPayload },
    ]);
    setAcliRunner(runner);

    const out = await filterCommand(["view", "33312"]);
    expect(out).toMatchInlineSnapshot(`
      "filter:
        id: "33312"
        name: My Open Bugs
        owner: Jane Doe
        jql: project = TEAM AND status = Open ORDER BY Rank ASC
        favourite: no
        description: none
      help[2]:
        Run \`atlassian-axi jira workitem search "<the filter's JQL>"\` to run it
        Run \`atlassian-axi jira filter update 33312 --jql "..."\` to change it"
    `);
  });

  it("requires a numeric filter ID", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(filterCommand(["view", "my-filter"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("filter update", () => {
  it("is a no-op success when every requested value already matches", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "view", result: filterViewPayload },
    ]);
    setAcliRunner(runner);

    const out = await filterCommand([
      "update",
      "33312",
      "--jql",
      "project = TEAM AND status = Open ORDER BY Rank ASC",
    ]);
    expect(updateCalls(calls)).toHaveLength(0);
    expect(out).toContain("message: Already up to date");
  });

  it("updates then re-fetches the authoritative post-state", async () => {
    let views = 0;
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "view" && ++views === 1,
        result: filterViewPayload,
      },
      { match: (args) => args[2] === "view", result: filterViewUpdatedPayload },
      { match: (args) => args[2] === "update", result: {} },
    ]);
    setAcliRunner(runner);

    const out = await filterCommand([
      "update",
      "33312",
      "--jql",
      "project = TEAM AND resolution = EMPTY ORDER BY Rank ASC",
    ]);
    const update = updateCalls(calls)[0];
    expect(update.args).toEqual([
      "jira",
      "filter",
      "update",
      "--id",
      "33312",
      "--json",
      "--jql",
      "project = TEAM AND resolution = EMPTY ORDER BY Rank ASC",
    ]);
    expect(out).toContain("jql: project = TEAM AND resolution = EMPTY");
    expect(out).toContain("filter view 33312");
  });

  it("rejects an empty update", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(filterCommand(["update", "33312"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("returns help for --help and throws on unknown subcommands", async () => {
    expect(await filterCommand(["--help"])).toContain("view <ID>");
    await expect(filterCommand(["delete"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown filter subcommand: delete"),
    });
  });
});
