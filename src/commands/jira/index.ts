import { takeFlag } from "../../args.js";
import type { SiteContext } from "../../context.js";
import { renderError } from "../../toon.js";
import { hasFlag } from "../../args.js";
import { workitemCommand, WORKITEM_HELP } from "./workitem.js";
import { projectCommand, PROJECT_HELP } from "./project.js";

export const JIRA_HELP = `usage: atlassian-axi jira <resource> <subcommand> [flags]
resources[2]:
  workitem, project
workitem:
  list, view <KEY>, create, edit <KEY>, transition <KEY> --to <status>, assign <KEY> --assignee <user>, comment <KEY> --body <text>, search "<JQL>"
project:
  list, view <KEY>
examples:
  atlassian-axi jira workitem list --project TEAM
  atlassian-axi jira workitem view TEAM-1
  atlassian-axi jira project list
Run \`atlassian-axi jira workitem --help\` or \`atlassian-axi jira project --help\` for per-resource flags.`;

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

  const resource = rest[0];
  if (!resource || (rest.length === 1 && hasFlag(rest, "--help"))) {
    return JIRA_HELP;
  }

  switch (resource) {
    case "workitem":
      return workitemCommand(rest.slice(1), ctx);
    case "project":
      return projectCommand(rest.slice(1), ctx);
    default:
      return renderError(
        `Unknown jira resource: ${resource}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi jira --help` for usage"],
      );
  }
}

export { WORKITEM_HELP, PROJECT_HELP };
