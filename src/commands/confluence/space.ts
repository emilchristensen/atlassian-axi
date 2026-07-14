import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "../../context.js";
import { formatCountLine } from "../../format.js";
import { getSuggestions } from "../../suggestions.js";
import { renderError, renderHelp, renderList, renderOutput } from "../../toon.js";
import { parseFlags, parseLimit } from "../shared.js";
import { hasNextPage, resultsOf, spaceListSchema } from "./shared.js";

export const SPACE_HELP = `usage: atlassian-axi confluence space <subcommand> [flags]
subcommands[1]:
  list
flags{list}:
  --limit <n> (default 30)
examples:
  atlassian-axi confluence space list
  atlassian-axi confluence space list --limit 50`;

export async function spaceCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return SPACE_HELP;
  }

  switch (sub) {
    case "list":
      return listSpaces(args, ctx);
    default:
      return renderError(
        `Unknown space subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi confluence space --help` for usage"],
      );
  }
}

async function listSpaces(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, { values: ["--limit"] });
  if (parsed.help) return SPACE_HELP;
  const limit = parseLimit(parsed.values["--limit"]);

  const payload = await confluenceJson<unknown>("/wiki/api/v2/spaces", {
    query: { limit },
  });
  const items = resultsOf(payload);

  const blocks: string[] = [
    formatCountLine({
      count: items.length,
      // v2 uses cursor pagination without a total; a next link means truncated.
      ...(hasNextPage(payload) ? { limit: items.length } : {}),
    }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("spaces", items, spaceListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "space",
        action: "list",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}
