import { takeFlag } from "../../args.js";
import { normalizeSite, storedSite } from "../../config.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { unknownSubcommandError } from "../shared.js";
import { workitemCommand, WORKITEM_HELP } from "./workitem.js";
import { projectCommand, PROJECT_HELP } from "./project.js";
import { boardCommand, BOARD_HELP } from "./board.js";
import { sprintCommand, SPRINT_HELP } from "./sprint.js";
import { filterCommand, FILTER_HELP } from "./filter.js";
import { dashboardCommand, DASHBOARD_HELP } from "./dashboard.js";
import { fieldCommand, FIELD_HELP } from "./field.js";

export const JIRA_HELP = `usage: atlassian-axi jira <resource> <subcommand> [flags]
resources[7]:
  workitem, project, board, sprint, filter, dashboard, field
workitem:
  list, view <KEY>, create, edit <KEY>, transition <KEY> --to <status>, assign <KEY> --assignee <user>, comment <KEY> --body <text>, search "<JQL>"
project:
  list, view <KEY>
board:
  list, view <ID>, list-sprints <ID>, list-projects <ID>
sprint:
  view <ID>, list-workitems <ID> --board <ID>, create --board <ID> --name <text>, update <ID>
filter:
  list, search, view <ID>, update <ID>
dashboard:
  list
field:
  create --name <text> --type <key>, update <ID>, delete <ID>, restore <ID>
examples:
  atlassian-axi jira workitem list --project TEAM
  atlassian-axi jira board list-sprints 1013 --state active
  atlassian-axi jira sprint list-workitems 5205 --board 1013
Run \`atlassian-axi jira <resource> --help\` for per-resource flags.`;

/**
 * Router for the acli-backed Jira domain. Strips the shared --site flag first
 * (the SDK context already consumed it) so its value is never mistaken for a
 * positional by resource subcommands.
 */
export async function jiraCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const rest = [...args];
  takeFlag(rest, "--site");

  // The Jira half rides acli's own login, which our stored credential
  // bootstrapped — a --site/env override naming a different site cannot be
  // honoured, so refuse loudly instead of silently querying the wrong
  // instance (found live 2026-07-19; the Confluence half re-targets fine).
  const bound = storedSite();
  const requested = ctx?.site ? normalizeSite(ctx.site) : undefined;
  if (requested && bound && requested !== bound) {
    throw new AxiError(
      `Jira commands run through acli, which is logged in to ${bound} — cannot target ${requested}`,
      "VALIDATION_ERROR",
      [
        `Run \`echo -n "<token>" | atlassian-axi auth login --token --site ${requested} --email <email>\` to switch sites`,
        "Confluence commands support --site directly",
      ],
    );
  }

  // A leading --help is help regardless of what follows (same trap as the
  // confluence router: `jira --help workitem` must not be an unknown resource).
  const resource = rest[0];
  if (!resource || resource === "--help") {
    return JIRA_HELP;
  }

  // --help anywhere after a known resource means that resource's help
  // (`jira workitem --help`, `jira workitem list --help`). The SDK only
  // intercepts --help for commands registered in COMMAND_HELP, so jira is
  // deliberately NOT registered there — this router owns all its help.
  if (rest.slice(1).includes("--help")) {
    const helpForResource: Record<string, string> = {
      workitem: WORKITEM_HELP,
      project: PROJECT_HELP,
      board: BOARD_HELP,
      sprint: SPRINT_HELP,
      filter: FILTER_HELP,
      dashboard: DASHBOARD_HELP,
      field: FIELD_HELP,
    };
    const help = helpForResource[resource];
    if (help) {
      return help;
    }
  }

  switch (resource) {
    case "workitem":
      return workitemCommand(rest.slice(1), ctx);
    case "project":
      return projectCommand(rest.slice(1), ctx);
    case "board":
      return boardCommand(rest.slice(1), ctx);
    case "sprint":
      return sprintCommand(rest.slice(1), ctx);
    case "filter":
      return filterCommand(rest.slice(1), ctx);
    case "dashboard":
      return dashboardCommand(rest.slice(1), ctx);
    case "field":
      return fieldCommand(rest.slice(1), ctx);
    default:
      throw unknownSubcommandError(
        "jira resource",
        resource,
        ["workitem", "project", "board", "sprint", "filter", "dashboard", "field"],
        "atlassian-axi jira --help",
      );
  }
}

export {
  WORKITEM_HELP,
  PROJECT_HELP,
  BOARD_HELP,
  SPRINT_HELP,
  FILTER_HELP,
  DASHBOARD_HELP,
  FIELD_HELP,
};
