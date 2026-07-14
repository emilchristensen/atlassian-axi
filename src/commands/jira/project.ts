import { acliJson } from "../../acli.js";
import { getFlag, getPositional, hasFlag } from "../../args.js";
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
import { itemsOf, nameOf, type JsonRecord } from "./shared.js";

export const PROJECT_HELP = `usage: atlassian-axi jira project <subcommand> [flags]
subcommands[2]:
  list, view <KEY>
flags{list}:
  --limit <n> (default 30)
examples:
  atlassian-axi jira project list
  atlassian-axi jira project view TEAM`;

const DEFAULT_LIMIT = 30;

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

const projectViewSchema: FieldDef[] = [
  ...projectListSchema,
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("lead", (item: JsonRecord) => nameOf(item.lead) ?? "none"),
];

export async function projectCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || hasFlag(args, "--help")) {
    return PROJECT_HELP;
  }

  switch (sub) {
    case "list":
      return listProjects(args, ctx);
    case "view":
      return viewProject(args, ctx);
    default:
      return renderError(
        `Unknown project subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi jira project --help` for usage"],
      );
  }
}

async function listProjects(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const rawLimit = getFlag(args, "--limit");
  const limit = rawLimit === undefined ? DEFAULT_LIMIT : parseInt(rawLimit, 10);
  if (isNaN(limit) || limit <= 0) {
    throw new AxiError(`Invalid --limit: ${rawLimit}`, "VALIDATION_ERROR");
  }

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
  const key = getPositional(args, 1)?.toUpperCase();
  if (!key) {
    throw new AxiError("Missing project key", "VALIDATION_ERROR", [
      "Run `atlassian-axi jira project view <KEY>`",
    ]);
  }

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
    renderDetail("project", item as JsonRecord, projectViewSchema),
    renderHelp(
      getSuggestions({ domain: "project", action: "view", id: key, site: ctx }),
    ),
  ]);
}
