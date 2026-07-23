import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "@atlassian-axi/core";
import { formatCountLine } from "@atlassian-axi/core";
import { getSuggestions } from "../../suggestions.js";
import { renderHelp, renderList, renderOutput } from "@atlassian-axi/core";
import {
  parseLimit,
  splitFields,
  unknownSubcommandError,
} from "@atlassian-axi/core";
import { parseSiteFlags } from "./flags.js";
import {
  fieldsSchema,
  hasNextPage,
  resultsOf,
  spaceListSchema,
} from "./shared.js";

export const SPACE_HELP = `usage: confluence-axi space <subcommand> [flags]
subcommands[1]:
  list
flags{list}:
  --limit <n> (default 30)
  --fields <a,b,c> (default key,name,type,id; key always included)
examples:
  confluence-axi space list
  confluence-axi space list --limit 50
  confluence-axi space list --fields name`;

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
      throw unknownSubcommandError(
        "space subcommand",
        sub,
        ["list"],
        "confluence-axi space --help",
      );
  }
}

async function listSpaces(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseSiteFlags(args, { values: ["--limit", "--fields"] });
  if (parsed.help) return SPACE_HELP;
  const limit = parseLimit(parsed.values["--limit"]);
  const fields = splitFields(parsed.values["--fields"]);

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
    blocks.push(
      renderList(
        "spaces",
        items,
        fields ? fieldsSchema(spaceListSchema, fields, "key") : spaceListSchema,
      ),
    );
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
