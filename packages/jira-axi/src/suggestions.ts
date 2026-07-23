import {
  matchSuggestions,
  type SuggestionContext,
  type SuggestionEntry,
} from "@atlassian-axi/core";

export type { SuggestionContext };

/**
 * Contextual next-step suggestions for jira-axi, keyed by {domain, action,
 * state, isEmpty}. Every command response ends with these so an agent always
 * knows the exact follow-up commands to run (the core AXI ergonomic). The
 * domain-agnostic engine lives in @atlassian-axi/core; this table is the
 * Jira-only slice.
 */
const table: SuggestionEntry[] = [
  // Home
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `jira-axi <command> <subcommand>` - commands: workitem, project, board, sprint, filter, dashboard, field, setup",
    ],
  },

  // Workitem list / search
  {
    match: (c) =>
      c.domain === "workitem" &&
      (c.action === "list" || c.action === "search") &&
      !c.isEmpty,
    lines: () => [
      "Run `jira-axi workitem view <KEY>` to view details",
      "Run `jira-axi workitem transition <KEY> --to <status>` to move one",
    ],
  },
  {
    match: (c) =>
      c.domain === "workitem" &&
      (c.action === "list" || c.action === "search") &&
      c.isEmpty === true,
    lines: () => [
      'Run `jira-axi workitem create --project <KEY> --type Task --summary "..."` to create one',
      'Run `jira-axi workitem search "<JQL>"` to search with a different query',
    ],
  },

  // Workitem view
  {
    match: (c) => c.domain === "workitem" && c.action === "view",
    lines: (c) => [
      `Run \`jira-axi workitem comment ${c.id} --body "..."\` to comment`,
      `Run \`jira-axi workitem transition ${c.id} --to <status>\` to change status`,
      `Run \`jira-axi workitem assign ${c.id} --assignee <email|@me>\` to assign`,
      `Run \`jira-axi workitem edit ${c.id} --summary "..."\` to edit`,
    ],
  },

  // Workitem create
  {
    match: (c) => c.domain === "workitem" && c.action === "create",
    lines: (c) => [
      `Run \`jira-axi workitem view ${c.id}\` to see the full work item`,
      `Run \`jira-axi workitem transition ${c.id} --to <status>\` to move it`,
      `Run \`jira-axi workitem assign ${c.id} --assignee <email|@me>\` to assign`,
    ],
  },

  // Workitem edit. Unlike its sibling mutations, edit's confirmation already
  // renders the full detail view, so suggesting a bare `view` would be
  // circular — point at what the confirmation does NOT show instead.
  {
    match: (c) => c.domain === "workitem" && c.action === "edit",
    lines: (c) => [
      `Run \`jira-axi workitem view ${c.id} --comments\` to see the discussion`,
      `Run \`jira-axi workitem transition ${c.id} --to <status>\` to change status`,
    ],
  },

  // Workitem assign
  {
    match: (c) => c.domain === "workitem" && c.action === "assign",
    lines: (c) => [
      `Run \`jira-axi workitem view ${c.id}\` to see the updated work item`,
    ],
  },

  // Workitem transition
  {
    match: (c) => c.domain === "workitem" && c.action === "transition",
    lines: (c) => [
      `Run \`jira-axi workitem view ${c.id}\` to see the updated work item`,
      `Run \`jira-axi workitem comment ${c.id} --body "..."\` to add context`,
    ],
  },

  // Workitem comment
  {
    match: (c) => c.domain === "workitem" && c.action === "comment",
    lines: (c) => [
      `Run \`jira-axi workitem view ${c.id} --comments\` to see all comments`,
    ],
  },

  // Project list
  {
    match: (c) => c.domain === "project" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Run `jira-axi project view <KEY>` to view a project",
      "Run `jira-axi workitem list --project <KEY>` to list its work items",
    ],
  },
  {
    match: (c) =>
      c.domain === "project" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Run `acli jira auth status` to verify the login has project access",
    ],
  },

  // Project view
  {
    match: (c) => c.domain === "project" && c.action === "view",
    lines: (c) => [
      `Run \`jira-axi workitem list --project ${c.id}\` to list its work items`,
      `Run \`jira-axi workitem create --project ${c.id} --type Task --summary "..."\` to create one`,
    ],
  },

  // Board list
  {
    match: (c) => c.domain === "board" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Run `jira-axi board list-sprints <ID>` to list a board's sprints",
      "Run `jira-axi board view <ID>` to view a board",
    ],
  },
  {
    match: (c) =>
      c.domain === "board" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Try `jira-axi board list --project <KEY>` or drop filters to broaden",
      "Run `acli jira auth status` to verify the login has board access",
    ],
  },

  // Board view — the sprint hint is gated on board type (state carries it):
  // only scrum boards support sprints, so hinting list-sprints on a kanban/
  // simple board would point at a command that fails.
  {
    match: (c) => c.domain === "board" && c.action === "view",
    lines: (c) => [
      ...(c.state === undefined || c.state === "scrum"
        ? [`Run \`jira-axi board list-sprints ${c.id}\` to list its sprints`]
        : []),
      `Run \`jira-axi board list-projects ${c.id}\` to list its projects`,
    ],
  },

  // Board list-sprints
  {
    match: (c) =>
      c.domain === "board" && c.action === "list-sprints" && !c.isEmpty,
    lines: (c) => [
      `Run \`jira-axi sprint list-workitems <SPRINT_ID> --board ${c.id}\` to list a sprint's work items`,
      "Run `jira-axi sprint view <SPRINT_ID>` to view a sprint",
    ],
  },
  {
    match: (c) =>
      c.domain === "board" &&
      c.action === "list-sprints" &&
      c.isEmpty === true,
    lines: (c) => [
      `Try \`jira-axi board list-sprints ${c.id} --state future,active,closed\` to include all states`,
    ],
  },

  // Board list-projects
  {
    match: (c) => c.domain === "board" && c.action === "list-projects",
    lines: () => [
      "Run `jira-axi project view <KEY>` to view a project",
      "Run `jira-axi workitem list --project <KEY>` to list its work items",
    ],
  },

  // Sprint view
  {
    match: (c) => c.domain === "sprint" && c.action === "view",
    lines: (c) => [
      `Run \`jira-axi sprint list-workitems ${c.id} --board <BOARD_ID>\` to list its work items`,
      `Run \`jira-axi sprint update ${c.id} --state <future|active|closed>\` to change its state`,
    ],
  },

  // Sprint list-workitems
  {
    match: (c) =>
      c.domain === "sprint" && c.action === "list-workitems" && !c.isEmpty,
    lines: () => [
      "Run `jira-axi workitem view <KEY>` to view details",
      "Run `jira-axi workitem transition <KEY> --to <status>` to move one",
    ],
  },
  {
    match: (c) =>
      c.domain === "sprint" &&
      c.action === "list-workitems" &&
      c.isEmpty === true,
    lines: (c) => [
      `Run \`jira-axi sprint view ${c.id}\` to confirm the sprint (its board may differ from --board)`,
      "Run `jira-axi board list-sprints <BOARD_ID>` to find the right sprint",
    ],
  },

  // Sprint create / update (id can be missing when acli's create shape drifts)
  {
    match: (c) =>
      c.domain === "sprint" && (c.action === "create" || c.action === "update"),
    lines: (c) =>
      c.id === undefined
        ? [
            "Run `jira-axi board list-sprints <BOARD_ID>` to find the sprint's ID",
          ]
        : [
            `Run \`jira-axi sprint view ${c.id}\` to see the sprint`,
            `Run \`jira-axi sprint list-workitems ${c.id} --board <BOARD_ID>\` to list its work items`,
          ],
  },

  // Filter list / search
  {
    match: (c) =>
      c.domain === "filter" &&
      (c.action === "list" || c.action === "search") &&
      !c.isEmpty,
    lines: () => ["Run `jira-axi filter view <ID>` to see a filter's JQL"],
  },
  {
    // state carries which variant ran ("my" | "favourite") so the empty-state
    // hint never suggests the exact flag combination that just came up empty.
    match: (c) =>
      c.domain === "filter" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      c.state === "favourite"
        ? "Run `jira-axi filter list` to list filters you own instead"
        : "Run `jira-axi filter list --favourite` to list favourites instead",
      "Run `jira-axi filter search --name <substring>` to search all filters",
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
      'Run `jira-axi workitem search "<the filter\'s JQL>"` to run it',
      `Run \`jira-axi filter update ${c.id} --jql "..."\` to change it`,
    ],
  },
  {
    match: (c) => c.domain === "filter" && c.action === "update",
    lines: (c) => [
      `Run \`jira-axi filter view ${c.id}\` to see the updated filter`,
    ],
  },

  // Dashboard list
  {
    match: (c) => c.domain === "dashboard" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Narrow with `jira-axi dashboard list --name <substring> --owner <email>`",
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
      "Run `jira-axi workitem view <KEY> --fields <a,b,c>` to see field values on a work item",
    ],
  },
  {
    match: (c) => c.domain === "field" && c.action === "delete",
    lines: (c) => [
      `Run \`jira-axi field restore ${c.id}\` to restore it from the trash`,
    ],
  },
  {
    match: (c) => c.domain === "field" && c.action === "restore",
    lines: (c) => [
      `Run \`jira-axi field update ${c.id} --name "..."\` to rename it`,
    ],
  },
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  return matchSuggestions(table, ctx, "jira-axi");
}
