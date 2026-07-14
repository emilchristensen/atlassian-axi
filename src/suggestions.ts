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
      "Run `atlassian-axi <command> <subcommand>` — commands: auth, jira, setup",
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
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry.lines(ctx).map((line) => appendSiteFlag(line, ctx));
    }
  }
  return [];
}
