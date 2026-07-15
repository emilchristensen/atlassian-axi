import { acliJson } from "../../acli.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { formatCountLine } from "../../format.js";
import { getSuggestions } from "../../suggestions.js";
import {
  custom,
  field,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../../toon.js";
import {
  dateOnly,
  fieldsSchema,
  itemsOf,
  parseFlags,
  parseLimit,
  requireNumericId,
  splitFields,
  totalOf,
  workitemListSchema,
  type JsonRecord,
} from "./shared.js";

export const SPRINT_HELP = `usage: atlassian-axi jira sprint <subcommand> [flags]
subcommands[4]:
  view <ID>, list-workitems <ID> --board <ID>, create, update <ID>
flags{list-workitems}:
  --board <ID> (required by the Jira agile API), --jql <query>, --fields <a,b,c>, --limit <n> (default 30)
flags{create}:
  --board <ID> (required), --name <text> (required), --start <ISO date>, --end <ISO date>, --goal <text>
flags{update}:
  --name <text>, --goal <text>, --state <future|active|closed> (no-op success when already there), --start <ISO date>, --end <ISO date>
examples:
  atlassian-axi jira sprint view 5205
  atlassian-axi jira sprint list-workitems 5205 --board 1013
  atlassian-axi jira sprint create --board 1013 --name "Sprint 13" --goal "Ship checkout"
  atlassian-axi jira sprint update 5205 --state closed`;

const SPRINT_STATES = ["future", "active", "closed"];

/**
 * Sprint schema: acli sprint payloads are flat agile-REST sprints
 * ({id, name, state, startDate, endDate, goal, originBoardId}; verified live
 * against v1.3.22). Dates render as YYYY-MM-DD, not relative times: sprint
 * dates are often in the future, where "just now" phrasing misleads.
 */
export const sprintListSchema: FieldDef[] = [
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom("state", (item: JsonRecord) => item.state ?? "unknown"),
  custom("start", (item: JsonRecord) => dateOnly(item.startDate) ?? "none"),
  custom("end", (item: JsonRecord) => dateOnly(item.endDate) ?? "none"),
];

const sprintViewSchema: FieldDef[] = [
  ...sprintListSchema,
  custom("goal", (item: JsonRecord) => item.goal || "none"),
  custom("board", (item: JsonRecord) => item.originBoardId ?? null),
  custom(
    "completed",
    (item: JsonRecord) => dateOnly(item.completeDate) ?? "none",
  ),
];

export async function sprintCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return SPRINT_HELP;
  }

  switch (sub) {
    case "view":
      return viewSprint(args, ctx);
    case "list-workitems":
      return listWorkitems(args, ctx);
    case "create":
      return createSprint(args, ctx);
    case "update":
      return updateSprint(args, ctx);
    default:
      return renderError(
        `Unknown sprint subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi jira sprint --help` for usage"],
      );
  }
}

/** Fetch one sprint by ID (acli sprint view --json returns one flat object). */
async function fetchSprint(id: string): Promise<JsonRecord> {
  const payload = await acliJson<unknown>([
    "jira",
    "sprint",
    "view",
    "--id",
    id,
    "--json",
  ]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AxiError(`Sprint not found: ${id}`, "NOT_FOUND");
  }
  return payload as JsonRecord;
}

async function viewSprint(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {});
  if (parsed.help) return SPRINT_HELP;
  const id = requireNumericId(
    parsed.positional,
    "Run `atlassian-axi jira sprint view <ID>` (find IDs via `jira board list-sprints <BOARD_ID>`)",
    "sprint ID",
  );

  const item = await fetchSprint(id);
  return renderOutput([
    renderDetail("sprint", item, sprintViewSchema),
    renderHelp(
      getSuggestions({ domain: "sprint", action: "view", id, site: ctx }),
    ),
  ]);
}

async function listWorkitems(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--board", "--jql", "--fields", "--limit"],
  });
  if (parsed.help) return SPRINT_HELP;
  const sprintId = requireNumericId(
    parsed.positional,
    "Run `atlassian-axi jira sprint list-workitems <ID> --board <BOARD_ID>`",
    "sprint ID",
  );
  const boardId = requireNumericId(
    parsed.values["--board"],
    "Pass --board <ID> (the Jira agile API scopes sprint work items by board; find IDs via `jira board list`)",
    "--board",
  );
  const jql = parsed.values["--jql"];
  const limit = parseLimit(parsed.values["--limit"]);
  const fields = splitFields(parsed.values["--fields"]);

  const acliArgs = [
    "jira",
    "sprint",
    "list-workitems",
    "--sprint",
    sprintId,
    "--board",
    boardId,
    "--limit",
    String(limit),
    "--json",
  ];
  if (jql) acliArgs.push("--jql", jql);
  if (fields && fields.length > 0) acliArgs.push("--fields", fields.join(","));

  const payload = await acliJson<unknown>(acliArgs);
  const items = itemsOf(payload, "issues", "workItems", "values");
  const totalCount = totalOf(payload);
  const schema =
    fields && fields.length > 0 ? fieldsSchema(fields) : workitemListSchema;

  const blocks: string[] = [
    formatCountLine({ count: items.length, limit, totalCount }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("workitems", items, schema));
    // acli silently DROPS unsupported --fields values here (verified live:
    // `--fields key,updated` returns `"fields": {}`), unlike workitem search
    // which errors loudly. Surface the drop so nulls aren't mistaken for data.
    const dropped = (fields ?? []).filter(
      (name) =>
        name !== "key" &&
        items.every((item) => {
          const nested = item.fields;
          const inNested =
            nested && typeof nested === "object" && name in nested;
          return !inNested && !(name in item);
        }),
    );
    if (dropped.length > 0) {
      blocks.push(
        `note: acli did not return field(s) ${dropped.join(", ")} (unsupported by sprint list-workitems)`,
      );
    }
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "sprint",
        action: "list-workitems",
        id: sprintId,
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

async function createSprint(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--board", "--name", "--start", "--end", "--goal"],
  });
  if (parsed.help) return SPRINT_HELP;

  const name = parsed.values["--name"];
  if (!name) {
    throw new AxiError("Missing required flag: --name", "VALIDATION_ERROR", [
      'Run `atlassian-axi jira sprint create --board <ID> --name "..."`',
    ]);
  }
  const board = requireNumericId(
    parsed.values["--board"],
    'Run `atlassian-axi jira sprint create --board <ID> --name "..."` (find IDs via `jira board list`)',
    "--board",
  );

  const acliArgs = [
    "jira",
    "sprint",
    "create",
    "--board",
    board,
    "--name",
    name,
    "--json",
  ];
  const start = parsed.values["--start"];
  const end = parsed.values["--end"];
  const goal = parsed.values["--goal"];
  if (start) acliArgs.push("--start", start);
  if (end) acliArgs.push("--end", end);
  if (goal) acliArgs.push("--goal", goal);

  const created = await acliJson<unknown>(acliArgs);
  const id = sprintIdOf(created);

  if (!id) {
    // Shape drifted; still report success with what we asked for.
    return renderOutput([
      renderDetail(
        "sprint",
        { _message: "Created (id not detected in acli output)", name },
        [field("_message", "message"), field("name")],
      ),
      renderHelp(
        getSuggestions({ domain: "sprint", action: "create", site: ctx }),
      ),
    ]);
  }

  const item = await fetchSprint(id);
  return renderOutput([
    renderDetail("sprint", item, sprintViewSchema),
    renderHelp(
      getSuggestions({ domain: "sprint", action: "create", id, site: ctx }),
    ),
  ]);
}

/** Find the created sprint id in a tolerant way (shape is undocumented). */
function sprintIdOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as JsonRecord;
  const id = record.id ?? (record.sprint as JsonRecord | undefined)?.id;
  if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) {
    return String(id);
  }
  return undefined;
}

async function updateSprint(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--name", "--goal", "--state", "--start", "--end"],
  });
  if (parsed.help) return SPRINT_HELP;
  const id = requireNumericId(
    parsed.positional,
    "Run `atlassian-axi jira sprint update <ID> --state closed` (find IDs via `jira board list-sprints <BOARD_ID>`)",
    "sprint ID",
  );

  const name = parsed.values["--name"];
  const goal = parsed.values["--goal"];
  const state = parsed.values["--state"];
  const start = parsed.values["--start"];
  const end = parsed.values["--end"];

  if (state && !SPRINT_STATES.includes(state)) {
    throw new AxiError(
      `Invalid --state: ${state} (expected one of ${SPRINT_STATES.join(", ")})`,
      "VALIDATION_ERROR",
    );
  }
  if (!name && !goal && !state && !start && !end) {
    throw new AxiError("No changes specified", "VALIDATION_ERROR", [
      "Pass at least one of --name, --goal, --state, --start, --end",
    ]);
  }

  // Idempotent: --state matching the current state is DROPPED from the acli
  // call (the agile API rejects e.g. closed→closed), so `--name X --state
  // <current>` still applies the rename. When nothing else was requested,
  // that drop makes the whole update a no-op success (mirrors workitem
  // transition).
  const current = await fetchSprint(id);
  const stateChange = state && current.state !== state ? state : undefined;
  if (state && !stateChange && !name && !goal && !start && !end) {
    return renderOutput([
      renderDetail("sprint", { ...current, _message: `Already ${state}` }, [
        ...sprintViewSchema,
        field("_message", "message"),
      ]),
      renderHelp(
        getSuggestions({ domain: "sprint", action: "update", id, site: ctx }),
      ),
    ]);
  }

  const acliArgs = ["jira", "sprint", "update", "--id", id, "--json"];
  if (name) acliArgs.push("--name", name);
  if (goal) acliArgs.push("--goal", goal);
  if (stateChange) acliArgs.push("--state", stateChange);
  if (start) acliArgs.push("--start", start);
  if (end) acliArgs.push("--end", end);

  await acliJson<unknown>(acliArgs);

  const item = await fetchSprint(id);
  return renderOutput([
    renderDetail("sprint", item, sprintViewSchema),
    renderHelp(
      getSuggestions({ domain: "sprint", action: "update", id, site: ctx }),
    ),
  ]);
}
