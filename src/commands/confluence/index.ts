import { takeFlag } from "../../args.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { pageCommand, PAGE_HELP } from "./page.js";
import { spaceCommand, SPACE_HELP } from "./space.js";
import { searchCommand, SEARCH_HELP } from "./search.js";

export const CONFLUENCE_HELP = `usage: atlassian-axi confluence <resource> <subcommand> [flags]
resources[3]:
  page, space, search
page:
  get <id>, create --space <KEY> --title <text> --body-file <path>, update <id>, delete <id>, attachments <id>, labels <id> [--add|--remove <names>], children <id>
space:
  list
search:
  search "<CQL>" (v1 CQL — the v2 API has no search endpoint)
examples:
  atlassian-axi confluence page get 12345
  atlassian-axi confluence space list
  atlassian-axi confluence search "space = ENG AND type = page"
Run \`atlassian-axi confluence page --help\` (or space/search) for per-resource flags.`;

/**
 * Router for the direct-REST Confluence domain. Strips the shared --site flag
 * first (the SDK context already consumed it) so its value is never mistaken
 * for a positional by resource subcommands.
 */
export async function confluenceCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const rest = [...args];
  takeFlag(rest, "--site");

  // A leading --help is help regardless of what follows (`confluence --help
  // page` must not become "Unknown confluence resource: --help").
  const resource = rest[0];
  if (!resource || resource === "--help") {
    return CONFLUENCE_HELP;
  }

  switch (resource) {
    case "page":
      return pageCommand(rest.slice(1), ctx);
    case "space":
      return spaceCommand(rest.slice(1), ctx);
    case "search":
      // search has no sub-resources; it consumes its own positional CQL.
      return searchCommand(rest, ctx);
    default:
      throw new AxiError(
        `Unknown confluence resource: ${resource}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi confluence --help` for usage"],
      );
  }
}

export { PAGE_HELP, SPACE_HELP, SEARCH_HELP };
