import { acliJson } from "../../acli.js";
import type { SiteContext } from "@atlassian-axi/core";
import { AxiError } from "@atlassian-axi/core";
import { unknownSubcommandError } from "@atlassian-axi/core";
import { formatCountLine } from "@atlassian-axi/core";
import { getSuggestions } from "../../suggestions.js";
import {
  custom,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "@atlassian-axi/core";
import {
  itemsOf,
  nameOf,
  parseFlags,
  parseLimit,
  rejectExtraPositional,
  truncatedTextField,
  type JsonRecord,
} from "./shared.js";

export const PROJECT_HELP = `usage: jira-axi project <subcommand> [flags]
subcommands[2]:
  list, view <KEY>
flags{list}:
  --limit <n> (default 30)
flags{view}:
  --full (complete description without truncation)
examples:
  jira-axi project list
  jira-axi project view TEAM`;

/**
 * Project schema: key, name, type. acli project payloads mirror the Jira REST
 * project shape (projectTypeKey, lead as a named object) - accessors stay
 * tolerant per risk R3.
 */
const projectListSchema: FieldDef[] = [
  custom("key", (item: JsonRecord) => item.key ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom(
    "type",
    (item: JsonRecord) => item.projectTypeKey ?? item.style ?? "unknown",
  ),
];

/** Detail schema for `view`; description truncated unless --full. */
function projectViewSchema(full: boolean): FieldDef[] {
  return [
    ...projectListSchema,
    custom("id", (item: JsonRecord) => item.id ?? null),
    custom("lead", (item: JsonRecord) => nameOf(item.lead) ?? "none"),
    truncatedTextField(
      "description",
      (item: JsonRecord) =>
        typeof item.description === "string" ? item.description : "",
      full,
      {
        emptyValue: "none",
        fullHint: "use `project view <KEY> --full` for the complete text",
      },
    ),
  ];
}

export async function projectCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return PROJECT_HELP;
  }

  switch (sub) {
    case "list":
      return listProjects(args, ctx);
    case "view":
      return viewProject(args, ctx);
    default:
      throw unknownSubcommandError(
        "project subcommand",
        sub,
        ["list", "view"],
        "jira-axi project --help",
      );
  }
}

async function listProjects(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--limit"] });
  if (parsed.help) return PROJECT_HELP;
  const limit = parseLimit(parsed.values["--limit"]);

  const payload = await acliJson<unknown>([
    "jira",
    "project",
    "list",
    "--limit",
    String(limit),
    "--json",
  ]);
  const items = itemsOf(payload, "values", "projects");

  const blocks: string[] = [formatCountLine({ count: items.length, limit })];
  if (items.length > 0) {
    blocks.push(renderList("projects", items, projectListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "list",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

async function viewProject(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { bools: ["--full"] });
  if (parsed.help) return PROJECT_HELP;
  const full = parsed.bools["--full"];
  const key = parsed.positional?.toUpperCase();
  if (!key) {
    throw new AxiError("Missing project key", "VALIDATION_ERROR", [
      "Run `jira-axi project view <KEY>`",
    ]);
  }
  rejectExtraPositional(args, "This command takes a single project <KEY>: jira-axi project view <KEY>");

  const payload = await acliJson<unknown>([
    "jira",
    "project",
    "view",
    "--key",
    key,
    "--json",
  ]);
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item || typeof item !== "object") {
    throw new AxiError(`Project not found: ${key}`, "NOT_FOUND");
  }

  return renderOutput([
    renderDetail("project", item as JsonRecord, projectViewSchema(full)),
    renderHelp(
      getSuggestions({ domain: "project", action: "view", id: key, site: ctx }),
    ),
  ]);
}
