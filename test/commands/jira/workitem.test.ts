import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAcliRunner } from "../../../src/acli.js";
import { workitemCommand } from "../../../src/commands/jira/workitem.js";
import { jiraCommand } from "../../../src/commands/jira/index.js";
import { makeAcliFake, type AcliCall } from "../../helpers/acliFake.js";
import {
  FROZEN_NOW,
  commentListPayload,
  createPayload,
  searchPayload,
  viewCreatedPayload,
  viewPayload,
  viewPayloadDone,
} from "../../fixtures/acli.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  setAcliRunner(null);
  vi.useRealTimers();
});

function searchCall(calls: AcliCall[]): AcliCall | undefined {
  return calls.find((c) => c.args[2] === "search");
}

const isSearch = (args: string[]) => args[2] === "search";
const isView = (key: string) => (args: string[]) =>
  args[2] === "view" && args[3] === key;

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("workitem list", () => {
  it("renders the TOON list from the recorded search fixture (contract snapshot)", async () => {
    const { runner } = makeAcliFake([{ match: isSearch, result: searchPayload }]);
    setAcliRunner(runner);

    const out = await workitemCommand(["list"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2
      workitems[2]{key,summary,status,assignee}:
        TEAM-1,Fix login redirect loop,wip,Jane Doe
        TEAM-2,Add audit log export,todo,unassigned
      help[2]:
        Run \`atlassian-axi jira workitem view <KEY>\` to view details
        Run \`atlassian-axi jira workitem transition <KEY> --to <status>\` to move one"
    `);
  });

  it("defaults to a bounded 30-day window (acli rejects unbounded JQL) with limit 30", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isSearch, result: searchPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand(["list"]);
    const call = searchCall(calls);
    expect(call?.args).toEqual([
      "jira",
      "workitem",
      "search",
      "--jql",
      "updated >= -30d ORDER BY updated DESC",
      "--limit",
      "30",
      "--json",
    ]);
  });

  it("builds JQL from --project/--assignee/--status (with @me → currentUser())", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isSearch, result: searchPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand([
      "list",
      "--project",
      "TEAM",
      "--assignee",
      "@me",
      "--status",
      "In Progress",
      "--limit",
      "5",
    ]);

    const call = searchCall(calls);
    const jql = call?.args[call.args.indexOf("--jql") + 1];
    expect(jql).toBe(
      'project = "TEAM" AND assignee = currentUser() AND status = "In Progress" ORDER BY updated DESC',
    );
    expect(call?.args).toContain("5");
  });

  it("passes --fields through to acli and extracts exactly those fields", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isSearch, result: searchPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand(["list", "--fields", "summary,priority"]);
    const call = searchCall(calls);
    expect(call?.args).toContain("--fields");
    expect(call?.args).toContain("summary,priority");
    expect(out).toContain("workitems[2]{key,summary,priority}:");
    expect(out).toContain("High");
  });

  it("rejects --jql combined with filter flags", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      workitemCommand(["list", "--jql", "project = X", "--project", "TEAM"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a non-numeric --limit", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      workitemCommand(["list", "--limit", "lots"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("escapes backslashes and quotes in built JQL values", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isSearch, result: [] },
    ]);
    setAcliRunner(runner);

    await workitemCommand(["list", "--status", 'Weird "st\\atus"\\']);
    const call = searchCall(calls);
    const jql = call?.args[call.args.indexOf("--jql") + 1];
    expect(jql).toBe(
      'status = "Weird \\"st\\\\atus\\"\\\\" ORDER BY updated DESC',
    );
  });

  it("returns help for `list --help` without shelling out", async () => {
    const { runner, calls } = makeAcliFake([]);
    setAcliRunner(runner);
    const out = await workitemCommand(["list", "--help"]);
    expect(out).toContain("usage: atlassian-axi jira workitem");
    expect(calls).toHaveLength(0);
  });

  it("renders empty-state suggestions when nothing matches", async () => {
    const { runner } = makeAcliFake([{ match: isSearch, result: [] }]);
    setAcliRunner(runner);

    const out = await workitemCommand(["list"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("to create one");
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("workitem search", () => {
  it("passes the positional JQL verbatim", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isSearch, result: searchPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand(["search", "assignee = currentUser()"]);
    const call = searchCall(calls);
    expect(call?.args).toContain("assignee = currentUser()");
  });

  it("requires a JQL query", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(workitemCommand(["search"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("does not mistake flag values for the positional JQL (flags first)", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isSearch, result: searchPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand(["search", "--limit", "5", "project = TEAM"]);
    const call = searchCall(calls);
    const jql = call?.args[call.args.indexOf("--jql") + 1];
    expect(jql).toBe("project = TEAM");
    expect(call?.args).toContain("5");
  });
});

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

describe("workitem view", () => {
  it("renders the detail with a flattened ADF description (contract snapshot)", async () => {
    const { runner } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand(["view", "TEAM-1"]);
    expect(out).toMatchInlineSnapshot(`
      "workitem:
        key: TEAM-1
        summary: Fix login redirect loop
        type: Bug
        status: in progress
        assignee: Jane Doe
        priority: High
        created: 13d ago
        updated: 1d ago
        body: "Login loops back to the SSO page.\\nRepro: log in with a fresh session."
      help[4]:
        Run \`atlassian-axi jira workitem comment TEAM-1 --body "..."\` to comment
        Run \`atlassian-axi jira workitem transition TEAM-1 --to <status>\` to change status
        Run \`atlassian-axi jira workitem assign TEAM-1 --assignee <email|@me>\` to assign
        Run \`atlassian-axi jira workitem edit TEAM-1 --summary "..."\` to edit"
    `);
  });

  it("includes comments (ADF and plain-text bodies) with --comments", async () => {
    const { runner } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
      {
        match: (args) => args[2] === "comment" && args[3] === "list",
        result: commentListPayload,
      },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand(["view", "TEAM-1", "--comments"]);
    expect(out).toContain("comments[2]{author,body}:");
    expect(out).toContain("Reproduced on staging.");
    expect(out).toContain("Plain-text comments also occur.");
  });

  it("does not truncate comment bodies with --full --comments", async () => {
    const longBody = "x".repeat(400);
    const { runner } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
      {
        match: (args) => args[2] === "comment" && args[3] === "list",
        result: {
          comments: [
            {
              author: { displayName: "Jane Doe" },
              body: longBody,
              created: "2026-07-13T12:00:00.000+0000",
            },
          ],
        },
      },
    ]);
    setAcliRunner(runner);

    const truncated = await workitemCommand(["view", "TEAM-1", "--comments"]);
    expect(truncated).toContain("truncated");
    expect(truncated).not.toContain(longBody);

    const full = await workitemCommand([
      "view",
      "TEAM-1",
      "--full",
      "--comments",
    ]);
    expect(full).toContain(longBody);
    expect(full).not.toContain("truncated");
  });

  it("passes a user --fields list to acli (key always included) and renders only those", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand([
      "view",
      "TEAM-1",
      "--fields",
      "status,updated",
    ]);

    const call = calls[0];
    expect(call.args[call.args.indexOf("--fields") + 1]).toBe(
      "key,status,updated",
    );
    expect(out).toContain("key: TEAM-1");
    expect(out).toContain("status: In Progress");
    expect(out).toContain("updated: 1d ago");
    expect(out).not.toContain("summary:");
  });

  it("rejects --full combined with --fields instead of silently ignoring --full", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      workitemCommand(["view", "TEAM-1", "--fields", "status", "--full"]),
    ).rejects.toThrow(/--full cannot be combined with --fields/);
  });

  it("rejects a degenerate --fields list instead of falling back to the default set", async () => {
    // Review finding: `--fields ,` used to silently render the full default
    // field set (and slip past the --full+--fields reject).
    const { runner, calls } = makeAcliFake([]);
    setAcliRunner(runner);
    for (const raw of [",", "a,,b", ""]) {
      await expect(
        workitemCommand(["view", "TEAM-1", "--fields", raw]),
      ).rejects.toThrow(/Invalid --fields value/);
    }
    await expect(
      workitemCommand(["list", "--fields", ","]),
    ).rejects.toThrow(/Invalid --fields value/);
    await expect(
      workitemCommand(["search", "key = TEAM-1", "--fields", ","]),
    ).rejects.toThrow(/Invalid --fields value/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces --fields values acli did not return instead of rendering silent nulls", async () => {
    const { runner } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);
    const out = await workitemCommand([
      "view",
      "TEAM-1",
      "--fields",
      "status,bogusfield",
    ]);
    expect(out).toContain(
      "note: acli did not return field(s) bogusfield",
    );
    const clean = await workitemCommand(["view", "TEAM-1", "--fields", "status"]);
    expect(clean).not.toContain("note: acli did not return");
  });

  it("uppercases the key and requires one", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand(["view", "team-1"]);
    expect(calls[0].args).toContain("TEAM-1");

    await expect(workitemCommand(["view"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("workitem create", () => {
  it("requires --project, --type and --summary", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      workitemCommand(["create", "--summary", "x"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses --body swallowing a sibling flag as the description", async () => {
    // Mirror of the confluence HIGH finding: `--body --summary "x"` must not
    // write the literal string "--summary" as the description.
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      workitemCommand([
        "create",
        "--project",
        "TEAM",
        "--type",
        "Task",
        "--body",
        "--summary",
        "x",
      ]),
    ).rejects.toThrow(/--body requires text/);
  });

  it("creates, then re-fetches and renders the authoritative post-state", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "create", result: createPayload },
      { match: isView("TEAM-3"), result: viewCreatedPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand([
      "create",
      "--project",
      "TEAM",
      "--type",
      "Task",
      "--summary",
      "New task from CLI",
      "--body",
      "Created from atlassian-axi",
    ]);

    const create = calls.find((c) => c.args[2] === "create");
    // The body goes through acli's ADF path, not a flat --description string.
    expect(create?.args).toContain("--description-file");
    expect(create?.args).not.toContain("--description");
    expect(create?.bodyFile).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Created from atlassian-axi" }],
        },
      ],
    });
    expect(out).toContain("key: TEAM-3");
    expect(out).toContain("status: to do");
    expect(out).toContain("view TEAM-3");
  });

  it("converts a markdown body to structured ADF (heading/list/code/link)", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "create", result: createPayload },
      { match: isView("TEAM-3"), result: viewCreatedPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand([
      "create",
      "--project",
      "TEAM",
      "--type",
      "Task",
      "--summary",
      "Rich body",
      "--body",
      "## Background\n\n- one\n- two\n\n1. step\n\nUse `acli` and see [docs](https://x.com).",
    ]);

    const create = calls.find((c) => c.args[2] === "create");
    const doc = create?.bodyFile as { content: { type: string }[] };
    const types = doc.content.map((n) => n.type);
    expect(types).toEqual([
      "heading",
      "bulletList",
      "orderedList",
      "paragraph",
    ]);
  });

  it("passes an existing ADF body through without double-encoding", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "create", result: createPayload },
      { match: isView("TEAM-3"), result: viewCreatedPayload },
    ]);
    setAcliRunner(runner);

    const adf = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "raw adf" }] },
      ],
    };
    await workitemCommand([
      "create",
      "--project",
      "TEAM",
      "--type",
      "Task",
      "--summary",
      "Raw ADF body",
      "--body",
      JSON.stringify(adf),
    ]);

    const create = calls.find((c) => c.args[2] === "create");
    expect(create?.bodyFile).toEqual(adf);
  });
});

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

describe("workitem edit", () => {
  it("rejects an edit with no changes", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(workitemCommand(["edit", "TEAM-1"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("refuses --body swallowing a sibling flag as the description", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      workitemCommand(["edit", "TEAM-1", "--body", "--summary", "x"]),
    ).rejects.toThrow(/--body requires text/);
  });

  it("edits non-interactively (--yes) and re-fetches", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "edit", result: {} },
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand([
      "edit",
      "TEAM-1",
      "--summary",
      "Sharper summary",
    ]);

    const edit = calls.find((c) => c.args[2] === "edit");
    expect(edit?.args).toContain("--yes");
    expect(edit?.args).toContain("--summary");
    expect(out).toContain("key: TEAM-1");
    expect(out).toContain("help[");
  });

  it("converts a markdown --body to ADF via --description-file", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "edit", result: {} },
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand([
      "edit",
      "TEAM-1",
      "--body",
      "# New description\n\n- a\n- b",
    ]);

    const edit = calls.find((c) => c.args[2] === "edit");
    expect(edit?.args).toContain("--description-file");
    expect(edit?.args).not.toContain("--description");
    const doc = edit?.bodyFile as { content: { type: string }[] };
    expect(doc.content.map((n) => n.type)).toEqual(["heading", "bulletList"]);
  });
});

// ---------------------------------------------------------------------------
// transition (idempotency contract)
// ---------------------------------------------------------------------------

describe("workitem transition", () => {
  it("is a no-op success when already in the target status", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand([
      "transition",
      "TEAM-1",
      "--to",
      "in progress",
    ]);

    expect(calls.some((c) => c.args[2] === "transition")).toBe(false);
    expect(out).toContain("message: Already In Progress");
    expect(out).toContain("help[");
  });

  it("transitions and renders the authoritative post-state", async () => {
    let transitioned = false;
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "transition",
        result: {},
      },
      {
        match: (args) =>
          args[2] === "view" && args[3] === "TEAM-1" && !transitioned,
        result: viewPayload,
      },
      { match: isView("TEAM-1"), result: viewPayloadDone },
    ]);
    // Flip the view response after the transition call, mimicking the server.
    const flippingRunner: typeof runner = async (args, stdin) => {
      const result = await runner(args, stdin);
      if (args[2] === "transition") transitioned = true;
      return result;
    };
    setAcliRunner(flippingRunner);

    const out = await workitemCommand(["transition", "TEAM-1", "--to", "Done"]);

    const transition = calls.find((c) => c.args[2] === "transition");
    expect(transition?.args).toEqual([
      "jira",
      "workitem",
      "transition",
      "--key",
      "TEAM-1",
      "--status",
      "Done",
      "--yes",
      "--json",
    ]);
    expect(out).toContain("status: done");
    expect(out).not.toContain("message: Already");
  });

  it("parses the key correctly when flags precede the positional", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    // "In Progress" is the --to value, not the key; TEAM-1 must be fetched
    // (and since it already is In Progress, this stays a no-op success).
    const out = await workitemCommand([
      "transition",
      "--to",
      "In Progress",
      "TEAM-1",
    ]);
    expect(calls[0].args).toContain("TEAM-1");
    expect(out).toContain("key: TEAM-1");
    expect(out).toContain("message: Already In Progress");
  });

  it("requires --to", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      workitemCommand(["transition", "TEAM-1"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

// ---------------------------------------------------------------------------
// assign (idempotency contract)
// ---------------------------------------------------------------------------

describe("workitem assign", () => {
  it("is a no-op success when the user is already assigned (by email)", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand([
      "assign",
      "TEAM-1",
      "--assignee",
      "JANE@acme.com",
    ]);

    expect(calls.some((c) => c.args[2] === "assign")).toBe(false);
    expect(out).toContain("message: Already assigned to Jane Doe");
  });

  it("assigns via acli and re-fetches otherwise", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "assign", result: {} },
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand([
      "assign",
      "TEAM-1",
      "--assignee",
      "john@acme.com",
    ]);

    const assign = calls.find((c) => c.args[2] === "assign");
    expect(assign?.args).toContain("--assignee");
    expect(assign?.args).toContain("john@acme.com");
    expect(assign?.args).toContain("--yes");
    expect(out).toContain("key: TEAM-1");
  });

  it("always shells out for @me (cannot compare server-side identity locally)", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "assign", result: {} },
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    await workitemCommand(["assign", "TEAM-1", "--assignee", "@me"]);
    expect(calls.some((c) => c.args[2] === "assign")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// comment
// ---------------------------------------------------------------------------

describe("workitem comment", () => {
  it("requires --body or --body-file", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(workitemCommand(["comment", "TEAM-1"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("creates the comment and confirms with the post-state", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "comment" && args[3] === "create",
        result: {},
      },
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand([
      "comment",
      "TEAM-1",
      "--body",
      "Deployed a fix to staging",
    ]);

    const create = calls.find(
      (c) => c.args[2] === "comment" && c.args[3] === "create",
    );
    // Comment bodies are ADF too: routed through --body-file, not a flat --body.
    expect(create?.args).toContain("--body-file");
    expect(create?.args).not.toContain("--body");
    expect(create?.bodyFile).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Deployed a fix to staging" }],
        },
      ],
    });
    expect(out).toContain("message: Comment added");
    expect(out).toContain("--comments");
  });

  it("treats a body value of --help as text, not a help request", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "comment" && args[3] === "create",
        result: {},
      },
      { match: isView("TEAM-1"), result: viewPayload },
    ]);
    setAcliRunner(runner);

    const out = await workitemCommand(["comment", "TEAM-1", "--body", "--help"]);
    const create = calls.find(
      (c) => c.args[2] === "comment" && c.args[3] === "create",
    );
    expect(create).toBeDefined();
    expect(out).toContain("message: Comment added");
    expect(out).not.toContain("usage:");
  });

  it("returns help for `comment --help` instead of a missing-body error", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    const out = await workitemCommand(["comment", "--help"]);
    expect(out).toContain("usage: atlassian-axi jira workitem");
  });
});

// ---------------------------------------------------------------------------
// error mapping (acli stderr → AxiError)
// ---------------------------------------------------------------------------

describe("workitem error mapping", () => {
  it("maps acli unauthorized stderr to AUTH_REQUIRED", async () => {
    const { runner } = makeAcliFake([
      {
        match: isSearch,
        result: {
          stdout: "",
          stderr:
            "✗ Error: unauthorized: use 'acli jira auth login' to authenticate",
          exitCode: 1,
        },
      },
    ]);
    setAcliRunner(runner);

    await expect(workitemCommand(["list"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("maps a missing work item to NOT_FOUND", async () => {
    const { runner } = makeAcliFake([
      {
        match: isView("TEAM-999"),
        result: {
          stdout: "",
          stderr: "✗ Error: work item TEAM-999 not found",
          exitCode: 1,
        },
      },
    ]);
    setAcliRunner(runner);

    await expect(workitemCommand(["view", "TEAM-999"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// jira router
// ---------------------------------------------------------------------------

describe("jira router", () => {
  it("strips --site before dispatch so its value is not read as a positional", async () => {
    const { runner, calls } = makeAcliFake([
      { match: isSearch, result: searchPayload },
    ]);
    setAcliRunner(runner);

    await jiraCommand([
      "workitem",
      "search",
      "--site",
      "acme.atlassian.net",
      "project = TEAM",
    ]);

    const call = searchCall(calls);
    const jql = call?.args[call.args.indexOf("--jql") + 1];
    expect(jql).toBe("project = TEAM");
  });

  it("appends --site to suggestions when the site came from the flag", async () => {
    const { runner } = makeAcliFake([{ match: isSearch, result: searchPayload }]);
    setAcliRunner(runner);

    const out = await jiraCommand(["workitem", "list"], {
      site: "acme.atlassian.net",
      source: "flag",
    });
    expect(out).toContain("--site acme.atlassian.net");
  });

  it("returns help for bare `jira` and throws on unknown resources", async () => {
    expect(await jiraCommand([])).toContain("usage: atlassian-axi jira");
    expect(await jiraCommand(["--help", "workitem"])).toContain(
      "usage: atlassian-axi jira",
    );
    await expect(jiraCommand(["bogus"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown jira resource: bogus"),
    });
  });

  it("throws VALIDATION_ERROR on an unknown workitem subcommand", async () => {
    await expect(workitemCommand(["vieww"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unknown workitem subcommand: vieww"),
    });
  });
});
