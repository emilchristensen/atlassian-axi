import { acliJson } from "../../acli.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { formatCountLine } from "../../format.js";
import { getSuggestions } from "../../suggestions.js";
import {
  custom,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../../toon.js";
import {
  itemsOf,
  parseFlags,
  parseLimit,
  requireNumericId,
  totalOf,
  type JsonRecord,
} from "./shared.js";
import { sprintListSchema } from "./sprint.js";

export const BOARD_HELP = `usage: atlassian-axi jira board <subcommand> [flags]
subcommands[4]:
  list, view <ID>, list-sprints <ID>, list-projects <ID>
flags{list}:
  --name <substring>, --project <KEY>, --type <scrum|kanban|simple>, --limit <n> (default 30)
flags{list-sprints}:
  --state <future,active,closed> (comma-separated), --limit <n> (default 30)
flags{list-projects}:
  --limit <n> (default 30)
examples:
  atlassian-axi jira board list --project TEAM
  atlassian-axi jira board view 1013
  atlassian-axi jira board list-sprints 1013 --state active`;

const BOARD_TYPES = ["scrum", "kanban", "simple"];
const SPRINT_STATES = ["future", "active", "closed"];

/**
 * Board schema: acli board payloads are flat {id, name, type, location}
 * (verified live against v1.3.22); location is the human-readable container
 * like "Team Project (TEAM)". Accessors stay tolerant per risk R3.
 */
const boardSchema: FieldDef[] = [
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom("type", (item: JsonRecord) => item.type ?? "unknown"),
  custom("location", (item: JsonRecord) => item.location ?? null),
];

const boardProjectSchema: FieldDef[] = [
  custom("key", (item: JsonRecord) => item.key ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom(
    "type",
    (item: JsonRecord) => item.type ?? item.projectTypeKey ?? "unknown",
  ),
];

export async function boardCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return BOARD_HELP;
  }

  switch (sub) {
    case "list":
      return listBoards(args, ctx);
    case "view":
      return viewBoard(args, ctx);
    case "list-sprints":
      return listSprints(args, ctx);
    case "list-projects":
      return listProjects(args, ctx);
    default:
      return renderError(
        `Unknown board subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi jira board --help` for usage"],
      );
  }
}

async function listBoards(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--name", "--project", "--type", "--limit"],
  });
  if (parsed.help) return BOARD_HELP;

  const name = parsed.values["--name"];
  const project = parsed.values["--project"];
  const type = parsed.values["--type"];
  const limit = parseLimit(parsed.values["--limit"]);

  if (type && !BOARD_TYPES.includes(type)) {
    throw new AxiError(
      `Invalid --type: ${type} (expected one of ${BOARD_TYPES.join(", ")})`,
      "VALIDATION_ERROR",
    );
  }

  // acli has no `board list`; `board search` with no filters is the listing.
  const acliArgs = [
    "jira",
    "board",
    "search",
    "--limit",
    String(limit),
    "--json",
  ];
  if (name) acliArgs.push("--name", name);
  if (project) acliArgs.push("--project", project);
  if (type) acliArgs.push("--type", type);

  const payload = await acliJson<unknown>(acliArgs);
  const items = itemsOf(payload, "values", "boards");
  const totalCount = totalOf(payload);

  const blocks: string[] = [
    formatCountLine({ count: items.length, limit, totalCount }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("boards", items, boardSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "board",
        action: "list",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

async function viewBoard(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {});
  if (parsed.help) return BOARD_HELP;
  const id = requireNumericId(
    parsed.positional,
    "Run `atlassian-axi jira board view <ID>` (find IDs via `jira board list`)",
    "board ID",
  );

  const payload = await acliJson<unknown>([
    "jira",
    "board",
    "view",
    "--id",
    id,
    "--json",
  ]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AxiError(`Board not found: ${id}`, "NOT_FOUND");
  }

  return renderOutput([
    renderDetail("board", payload as JsonRecord, boardSchema),
    renderHelp(
      getSuggestions({ domain: "board", action: "view", id, site: ctx }),
    ),
  ]);
}

async function listSprints(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--state", "--limit"] });
  if (parsed.help) return BOARD_HELP;
  const id = requireNumericId(
    parsed.positional,
    "Run `atlassian-axi jira board list-sprints <ID>` (find IDs via `jira board list`)",
    "board ID",
  );
  const state = parsed.values["--state"];
  const limit = parseLimit(parsed.values["--limit"]);

  if (state) {
    const invalid = state
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !SPRINT_STATES.includes(s));
    if (invalid.length > 0) {
      throw new AxiError(
        `Invalid --state: ${invalid.join(", ")} (expected ${SPRINT_STATES.join(", ")})`,
        "VALIDATION_ERROR",
      );
    }
  }

  const acliArgs = [
    "jira",
    "board",
    "list-sprints",
    "--id",
    id,
    "--limit",
    String(limit),
    "--json",
  ];
  if (state) acliArgs.push("--state", state);

  const payload = await acliJson<unknown>(acliArgs);
  const items = itemsOf(payload, "sprints", "values");
  const totalCount = totalOf(payload);

  const blocks: string[] = [
    formatCountLine({ count: items.length, limit, totalCount }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("sprints", items, sprintListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "board",
        action: "list-sprints",
        id,
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

async function listProjects(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--limit"] });
  if (parsed.help) return BOARD_HELP;
  const id = requireNumericId(
    parsed.positional,
    "Run `atlassian-axi jira board list-projects <ID>` (find IDs via `jira board list`)",
    "board ID",
  );
  const limit = parseLimit(parsed.values["--limit"]);

  const payload = await acliJson<unknown>([
    "jira",
    "board",
    "list-projects",
    "--id",
    id,
    "--limit",
    String(limit),
    "--json",
  ]);
  const items = itemsOf(payload, "projects", "values");
  const totalCount = totalOf(payload);

  const blocks: string[] = [
    formatCountLine({ count: items.length, limit, totalCount }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("projects", items, boardProjectSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "board",
        action: "list-projects",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}
