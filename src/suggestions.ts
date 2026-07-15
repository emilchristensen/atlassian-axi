import type { SiteContext } from "./context.js";

/**
 * Contextual next-step suggestions, keyed by {domain, action, state, isEmpty}.
 * Every command response ends with these so an agent always knows the exact
 * follow-up commands to run (the core AXI ergonomic, mirrored from gh-axi).
 */
export interface SuggestionContext {
  domain: string;
  action: string;
  state?: string;
  isEmpty?: boolean;
  /** The entity key/id for substitution (e.g. TEAM-1). */
  id?: string | number;
  site?: SiteContext;
}

type SuggestionEntry = {
  match: (ctx: SuggestionContext) => boolean;
  lines: (ctx: SuggestionContext) => string[];
};

/**
 * When the site came from an explicit --site flag, follow-up commands must
 * carry it too (flags go after the command per the SDK contract).
 */
function siteFlag(ctx: SuggestionContext): string {
  if (ctx.site && ctx.site.source === "flag") {
    return ` --site ${ctx.site.site}`;
  }
  return "";
}

function appendSiteFlag(line: string, ctx: SuggestionContext): string {
  const flag = siteFlag(ctx);
  if (!flag) return line;
  return line.replace(/`([^`]*\batlassian-axi\b[^`]*)`/g, `\`$1${flag}\``);
}

const table: SuggestionEntry[] = [
  // Home
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `atlassian-axi <command> <subcommand>` — commands: auth, jira, confluence, setup",
    ],
  },

  // Workitem list / search
  {
    match: (c) =>
      c.domain === "workitem" &&
      (c.action === "list" || c.action === "search") &&
      !c.isEmpty,
    lines: () => [
      "Run `atlassian-axi jira workitem view <KEY>` to view details",
      "Run `atlassian-axi jira workitem transition <KEY> --to <status>` to move one",
    ],
  },
  {
    match: (c) =>
      c.domain === "workitem" &&
      (c.action === "list" || c.action === "search") &&
      c.isEmpty === true,
    lines: () => [
      'Run `atlassian-axi jira workitem create --project <KEY> --type Task --summary "..."` to create one',
      'Run `atlassian-axi jira workitem search "<JQL>"` to search with a different query',
    ],
  },

  // Workitem view
  {
    match: (c) => c.domain === "workitem" && c.action === "view",
    lines: (c) => [
      `Run \`atlassian-axi jira workitem comment ${c.id} --body "..."\` to comment`,
      `Run \`atlassian-axi jira workitem transition ${c.id} --to <status>\` to change status`,
      `Run \`atlassian-axi jira workitem assign ${c.id} --assignee <email|@me>\` to assign`,
      `Run \`atlassian-axi jira workitem edit ${c.id} --summary "..."\` to edit`,
    ],
  },

  // Workitem create
  {
    match: (c) => c.domain === "workitem" && c.action === "create",
    lines: (c) => [
      `Run \`atlassian-axi jira workitem view ${c.id}\` to see the full work item`,
      `Run \`atlassian-axi jira workitem transition ${c.id} --to <status>\` to move it`,
      `Run \`atlassian-axi jira workitem assign ${c.id} --assignee <email|@me>\` to assign`,
    ],
  },

  // Workitem edit / assign
  {
    match: (c) =>
      c.domain === "workitem" && (c.action === "edit" || c.action === "assign"),
    lines: (c) => [
      `Run \`atlassian-axi jira workitem view ${c.id}\` to see the updated work item`,
    ],
  },

  // Workitem transition
  {
    match: (c) => c.domain === "workitem" && c.action === "transition",
    lines: (c) => [
      `Run \`atlassian-axi jira workitem view ${c.id}\` to see the updated work item`,
      `Run \`atlassian-axi jira workitem comment ${c.id} --body "..."\` to add context`,
    ],
  },

  // Workitem comment
  {
    match: (c) => c.domain === "workitem" && c.action === "comment",
    lines: (c) => [
      `Run \`atlassian-axi jira workitem view ${c.id} --comments\` to see all comments`,
    ],
  },

  // Project list
  {
    match: (c) => c.domain === "project" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Run `atlassian-axi jira project view <KEY>` to view a project",
      "Run `atlassian-axi jira workitem list --project <KEY>` to list its work items",
    ],
  },
  {
    match: (c) =>
      c.domain === "project" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Run `atlassian-axi auth status` to verify the credential has project access",
    ],
  },

  // Project view
  {
    match: (c) => c.domain === "project" && c.action === "view",
    lines: (c) => [
      `Run \`atlassian-axi jira workitem list --project ${c.id}\` to list its work items`,
      `Run \`atlassian-axi jira workitem create --project ${c.id} --type Task --summary "..."\` to create one`,
    ],
  },

  // Board list
  {
    match: (c) => c.domain === "board" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Run `atlassian-axi jira board list-sprints <ID>` to list a board's sprints",
      "Run `atlassian-axi jira board view <ID>` to view a board",
    ],
  },
  {
    match: (c) =>
      c.domain === "board" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Try `atlassian-axi jira board list --project <KEY>` or drop filters to broaden",
      "Run `atlassian-axi auth status` to verify the credential has board access",
    ],
  },

  // Board view
  {
    match: (c) => c.domain === "board" && c.action === "view",
    lines: (c) => [
      `Run \`atlassian-axi jira board list-sprints ${c.id}\` to list its sprints`,
      `Run \`atlassian-axi jira board list-projects ${c.id}\` to list its projects`,
    ],
  },

  // Board list-sprints
  {
    match: (c) =>
      c.domain === "board" && c.action === "list-sprints" && !c.isEmpty,
    lines: (c) => [
      `Run \`atlassian-axi jira sprint list-workitems <SPRINT_ID> --board ${c.id}\` to list a sprint's work items`,
      "Run `atlassian-axi jira sprint view <SPRINT_ID>` to view a sprint",
    ],
  },
  {
    match: (c) =>
      c.domain === "board" &&
      c.action === "list-sprints" &&
      c.isEmpty === true,
    lines: (c) => [
      `Try \`atlassian-axi jira board list-sprints ${c.id} --state future,active,closed\` to include all states`,
    ],
  },

  // Board list-projects
  {
    match: (c) => c.domain === "board" && c.action === "list-projects",
    lines: () => [
      "Run `atlassian-axi jira project view <KEY>` to view a project",
      "Run `atlassian-axi jira workitem list --project <KEY>` to list its work items",
    ],
  },

  // Sprint view
  {
    match: (c) => c.domain === "sprint" && c.action === "view",
    lines: (c) => [
      `Run \`atlassian-axi jira sprint list-workitems ${c.id} --board <BOARD_ID>\` to list its work items`,
      `Run \`atlassian-axi jira sprint update ${c.id} --state <future|active|closed>\` to change its state`,
    ],
  },

  // Sprint list-workitems
  {
    match: (c) =>
      c.domain === "sprint" && c.action === "list-workitems" && !c.isEmpty,
    lines: () => [
      "Run `atlassian-axi jira workitem view <KEY>` to view details",
      "Run `atlassian-axi jira workitem transition <KEY> --to <status>` to move one",
    ],
  },
  {
    match: (c) =>
      c.domain === "sprint" &&
      c.action === "list-workitems" &&
      c.isEmpty === true,
    lines: (c) => [
      `Run \`atlassian-axi jira sprint view ${c.id}\` to confirm the sprint (its board may differ from --board)`,
      "Run `atlassian-axi jira board list-sprints <BOARD_ID>` to find the right sprint",
    ],
  },

  // Sprint create / update (id can be missing when acli's create shape drifts)
  {
    match: (c) =>
      c.domain === "sprint" && (c.action === "create" || c.action === "update"),
    lines: (c) =>
      c.id === undefined
        ? [
            "Run `atlassian-axi jira board list-sprints <BOARD_ID>` to find the sprint's ID",
          ]
        : [
            `Run \`atlassian-axi jira sprint view ${c.id}\` to see the sprint`,
            `Run \`atlassian-axi jira sprint list-workitems ${c.id} --board <BOARD_ID>\` to list its work items`,
          ],
  },

  // Filter list / search
  {
    match: (c) =>
      c.domain === "filter" &&
      (c.action === "list" || c.action === "search") &&
      !c.isEmpty,
    lines: () => [
      "Run `atlassian-axi jira filter view <ID>` to see a filter's JQL",
    ],
  },
  {
    match: (c) =>
      c.domain === "filter" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Run `atlassian-axi jira filter list --favourite` to list favourites instead",
      "Run `atlassian-axi jira filter search --name <substring>` to search all filters",
    ],
  },
  {
    match: (c) =>
      c.domain === "filter" && c.action === "search" && c.isEmpty === true,
    lines: () => [
      "Broaden the search: drop --name/--owner or try a shorter substring",
    ],
  },

  // Filter view / update
  {
    match: (c) => c.domain === "filter" && c.action === "view",
    lines: (c) => [
      'Run `atlassian-axi jira workitem search "<the filter\'s JQL>"` to run it',
      `Run \`atlassian-axi jira filter update ${c.id} --jql "..."\` to change it`,
    ],
  },
  {
    match: (c) => c.domain === "filter" && c.action === "update",
    lines: (c) => [
      `Run \`atlassian-axi jira filter view ${c.id}\` to see the updated filter`,
    ],
  },

  // Dashboard list
  {
    match: (c) => c.domain === "dashboard" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Narrow with `atlassian-axi jira dashboard list --name <substring> --owner <email>`",
    ],
  },
  {
    match: (c) =>
      c.domain === "dashboard" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Broaden the search: drop --name/--owner or try a shorter substring",
    ],
  },

  // Field mutations
  {
    match: (c) =>
      c.domain === "field" && (c.action === "create" || c.action === "update"),
    lines: () => [
      "Run `atlassian-axi jira workitem view <KEY> --fields <a,b,c>` to see field values on a work item",
    ],
  },
  {
    match: (c) => c.domain === "field" && c.action === "delete",
    lines: (c) => [
      `Run \`atlassian-axi jira field restore ${c.id}\` to restore it from the trash`,
    ],
  },
  {
    match: (c) => c.domain === "field" && c.action === "restore",
    lines: (c) => [
      `Run \`atlassian-axi jira field update ${c.id} --name "..."\` to rename it`,
    ],
  },

  // Confluence page get
  {
    match: (c) => c.domain === "page" && c.action === "get",
    lines: (c) => [
      `Run \`atlassian-axi confluence page update ${c.id} --body-file <path>\` to edit it`,
      'Run `atlassian-axi confluence search "<CQL>"` to find related pages',
    ],
  },

  // Confluence page create / update
  {
    match: (c) =>
      c.domain === "page" && (c.action === "create" || c.action === "update"),
    lines: (c) => [
      `Run \`atlassian-axi confluence page get ${c.id} --full\` to see the full page`,
    ],
  },

  // Confluence page delete
  {
    match: (c) => c.domain === "page" && c.action === "delete",
    lines: () => [
      'Run `atlassian-axi confluence search "<CQL>"` to find other pages',
      "Run `atlassian-axi confluence space list` to browse spaces",
    ],
  },

  // Confluence space list
  {
    match: (c) => c.domain === "space" && c.action === "list" && !c.isEmpty,
    lines: () => [
      'Run `atlassian-axi confluence search "space = <KEY> AND type = page"` to list a space\'s pages',
      'Run `atlassian-axi confluence page create --space <KEY> --title "..." --body-file <path>` to create a page',
    ],
  },
  {
    match: (c) =>
      c.domain === "space" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Run `atlassian-axi auth status` to verify the credential has Confluence access",
    ],
  },

  // Confluence search
  {
    match: (c) => c.domain === "confluence-search" && !c.isEmpty,
    lines: () => [
      "Run `atlassian-axi confluence page get <id>` to read a result",
    ],
  },
  {
    match: (c) => c.domain === "confluence-search" && c.isEmpty === true,
    lines: () => [
      'Broaden the CQL, e.g. `atlassian-axi confluence search "text ~ \'<term>\'"`',
      "Run `atlassian-axi confluence space list` to check space keys",
    ],
  },
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry.lines(ctx).map((line) => appendSiteFlag(line, ctx));
    }
  }
  return [];
}
