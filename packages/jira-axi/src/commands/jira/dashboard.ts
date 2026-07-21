import { acliJson } from "../../acli.js";
import type { SiteContext } from "../../context.js";
import { unknownSubcommandError } from "../shared.js";
import { formatCountLine } from "../../format.js";
import { getSuggestions } from "../../suggestions.js";
import {
  custom,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../../toon.js";
import {
  itemsOf,
  nameOf,
  parseFlags,
  parseLimit,
  type JsonRecord,
} from "./shared.js";

export const DASHBOARD_HELP = `usage: atlassian-axi jira dashboard <subcommand> [flags]
subcommands[1]:
  list
flags{list}:
  --name <substring>, --owner <email>, --limit <n> (default 30)
examples:
  atlassian-axi jira dashboard list
  atlassian-axi jira dashboard list --name release --owner jane@acme.com`;

/**
 * Dashboard schema: acli dashboard search returns a bare array of {id, name,
 * description, owner} (verified live against v1.3.22). acli exposes ONLY
 * search for dashboards - no view/create - so listing is the whole surface.
 */
const dashboardSchema: FieldDef[] = [
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom("owner", (item: JsonRecord) => nameOf(item.owner) ?? "unknown"),
];

export async function dashboardCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return DASHBOARD_HELP;
  }

  switch (sub) {
    case "list":
      return listDashboards(args, ctx);
    default:
      throw unknownSubcommandError(
        "dashboard subcommand",
        sub,
        ["list"],
        "atlassian-axi jira dashboard --help",
      );
  }
}

async function listDashboards(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--name", "--owner", "--limit"] });
  if (parsed.help) return DASHBOARD_HELP;
  const name = parsed.values["--name"];
  const owner = parsed.values["--owner"];
  const limit = parseLimit(parsed.values["--limit"]);

  // acli has no `dashboard list`; `dashboard search` with no filters is the listing.
  const acliArgs = [
    "jira",
    "dashboard",
    "search",
    "--limit",
    String(limit),
    "--json",
  ];
  if (name) acliArgs.push("--name", name);
  if (owner) acliArgs.push("--owner", owner);

  const payload = await acliJson<unknown>(acliArgs);
  const items = itemsOf(payload, "values", "dashboards");

  const blocks: string[] = [formatCountLine({ count: items.length, limit })];
  if (items.length > 0) {
    blocks.push(renderList("dashboards", items, dashboardSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "dashboard",
        action: "list",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}
