import {
  matchSuggestions,
  type SuggestionContext,
  type SuggestionEntry,
} from "@atlassian-axi/core";

export type { SuggestionContext };

/**
 * Contextual next-step suggestions for confluence-axi, keyed by {domain,
 * action, isEmpty}. Every command response ends with these so an agent always
 * knows the exact follow-up commands to run (the core AXI ergonomic). The
 * domain-agnostic engine lives in @atlassian-axi/core; this table is the
 * Confluence-only slice.
 */
const table: SuggestionEntry[] = [
  // Home
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `confluence-axi <command> <subcommand>` — commands: auth, page, space, search, setup",
    ],
  },

  // Confluence page get
  {
    match: (c) => c.domain === "page" && c.action === "get",
    lines: (c) => [
      `Run \`confluence-axi page update ${c.id} --body-file <path>\` to edit it`,
      `Run \`confluence-axi page children ${c.id}\` to list its child pages`,
      'Run `confluence-axi search "<CQL>"` to find related pages',
    ],
  },

  // Confluence page attachments
  {
    match: (c) => c.domain === "page" && c.action === "attachments" && !c.isEmpty,
    lines: (c) => [
      `Narrow with \`confluence-axi page attachments ${c.id} --filename <name>\` or \`--media-type <type>\``,
      `Run \`confluence-axi page get ${c.id}\` to read the page itself`,
    ],
  },
  {
    match: (c) =>
      c.domain === "page" &&
      c.action === "attachments" &&
      c.isEmpty === true &&
      c.state === "filtered",
    lines: (c) => [
      `Broaden the search: drop --filename/--media-type, or run \`confluence-axi page attachments ${c.id}\` to list everything`,
    ],
  },
  {
    match: (c) =>
      c.domain === "page" && c.action === "attachments" && c.isEmpty === true,
    lines: (c) => [
      `Run \`confluence-axi page get ${c.id}\` to read the page (attachments are added in the Confluence UI)`,
    ],
  },

  // Confluence page labels (list and mutations share the follow-ups)
  {
    match: (c) =>
      c.domain === "page" &&
      (c.action === "labels-add" || c.action === "labels-remove"),
    lines: (c) => [
      `Run \`confluence-axi page labels ${c.id}\` to list the labels again`,
      "Run `confluence-axi search \"label = '<name>'\"` to find content sharing a label",
    ],
  },
  {
    match: (c) => c.domain === "page" && c.action === "labels" && !c.isEmpty,
    lines: (c) => [
      "Run `confluence-axi search \"label = '<name>'\"` to find content sharing a label",
      `Run \`confluence-axi page labels ${c.id} --add <name>\` or \`--remove <name>\` to change them`,
    ],
  },
  {
    match: (c) =>
      c.domain === "page" && c.action === "labels" && c.isEmpty === true,
    lines: (c) => [
      `Run \`confluence-axi page labels ${c.id} --add <name,name,...>\` to add labels`,
    ],
  },

  // Confluence page children
  {
    match: (c) => c.domain === "page" && c.action === "children" && !c.isEmpty,
    lines: () => [
      "Run `confluence-axi page get <id>` to read a child page",
      "Run `confluence-axi page children <id>` to descend another level",
    ],
  },
  {
    match: (c) =>
      c.domain === "page" && c.action === "children" && c.isEmpty === true,
    lines: (c) => [
      `Run \`confluence-axi page create --space <KEY> --title "..." --body-file <path> --parent ${c.id}\` to create a child page`,
    ],
  },

  // Confluence page create / update
  {
    match: (c) =>
      c.domain === "page" && (c.action === "create" || c.action === "update"),
    lines: (c) => [
      `Run \`confluence-axi page get ${c.id} --full\` to see the full page`,
    ],
  },

  // Confluence page delete
  {
    match: (c) => c.domain === "page" && c.action === "delete",
    lines: () => [
      'Run `confluence-axi search "<CQL>"` to find other pages',
      "Run `confluence-axi space list` to browse spaces",
    ],
  },

  // Confluence space list
  {
    match: (c) => c.domain === "space" && c.action === "list" && !c.isEmpty,
    lines: () => [
      'Run `confluence-axi search "space = <KEY> AND type = page"` to list a space\'s pages',
      'Run `confluence-axi page create --space <KEY> --title "..." --body-file <path>` to create a page',
    ],
  },
  {
    match: (c) =>
      c.domain === "space" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      "Run `confluence-axi auth status` to verify the credential has Confluence access",
    ],
  },

  // Confluence search
  {
    match: (c) => c.domain === "confluence-search" && !c.isEmpty,
    lines: () => ["Run `confluence-axi page get <id>` to read a result"],
  },
  {
    match: (c) => c.domain === "confluence-search" && c.isEmpty === true,
    lines: () => [
      'Broaden the CQL, e.g. `confluence-axi search "text ~ \'<term>\'"`',
      "Run `confluence-axi space list` to check space keys",
    ],
  },
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  return matchSuggestions(table, ctx, "confluence-axi");
}
