import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "@atlassian-axi/core";
import { AxiError } from "../../errors.js";
import { formatCountLine } from "@atlassian-axi/core";
import { getSuggestions } from "../../suggestions.js";
import { renderHelp, renderList, renderOutput } from "@atlassian-axi/core";
import { parseLimit, splitFields } from "@atlassian-axi/core";
import { parseSiteFlags } from "./flags.js";
import {
  fieldsSchema,
  resultsOf,
  searchResultSchema,
  type JsonRecord,
} from "./shared.js";

export const SEARCH_HELP = `usage: confluence-axi search "<CQL>" [flags]
CQL search across Confluence (v1 REST — the v2 API has no search endpoint).
flags[2]:
  --limit <n> (default 30)
  --fields <a,b,c> (default id,type,title,space,modified,excerpt; id always included)
examples:
  confluence-axi search "space = ENG AND type = page"
  confluence-axi search "title ~ 'release notes'" --limit 5
  confluence-axi search "space = ENG" --fields title
  confluence-axi search "text ~ 'pagination' AND lastmodified >= now('-30d')"`;

export async function searchCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseSiteFlags(args, { values: ["--limit", "--fields"] });
  if (parsed.help) return SEARCH_HELP;

  // The cli wrapper keeps "search" itself at args[0], so the CQL query is the
  // first positional after it — exactly what parseFlags returns.
  const cql = parsed.positional;
  if (!cql) {
    throw new AxiError("Missing CQL query", "VALIDATION_ERROR", [
      'Run `confluence-axi search "<CQL>"`',
      'Example: `confluence-axi search "space = ENG AND type = page"`',
    ]);
  }
  // An unquoted multi-token query (`search type=page AND space=ENG`) would
  // otherwise run the first token as the whole CQL and silently drop the rest,
  // returning wrong results with exit 0. Reject the leftover positional loudly,
  // mirroring requirePageId's extra-argument guard (parseFlags already consumed
  // --limit and its value, so only real query tokens remain here).
  const extra = args.slice(1).filter((a) => !a.startsWith("--"))[1];
  if (extra !== undefined) {
    throw new AxiError(
      `Unexpected extra argument: ${extra}`,
      "VALIDATION_ERROR",
      ['Quote the whole CQL as one argument: confluence-axi search "<CQL>"'],
    );
  }
  const limit = parseLimit(parsed.values["--limit"]);
  const fields = splitFields(parsed.values["--fields"]);

  const payload = await confluenceJson<unknown>("/wiki/rest/api/search", {
    query: { cql, limit },
  });
  const items = resultsOf(payload);
  const totalSize = totalSizeOf(payload);

  const blocks: string[] = [
    // Pass the requested limit even when the total is known: the --limit hint
    // only fires when the request limit was the binding constraint.
    formatCountLine({
      count: items.length,
      limit,
      ...(totalSize !== null ? { totalCount: totalSize } : {}),
    }),
  ];
  if (items.length > 0) {
    blocks.push(
      renderList(
        "results",
        items,
        fields ? fieldsSchema(searchResultSchema, fields, "id") : searchResultSchema,
      ),
    );
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "confluence-search",
        action: "search",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

/** v1 search reports a true total as `totalSize`; tolerate its absence. */
function totalSizeOf(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const total = (payload as JsonRecord).totalSize;
  return typeof total === "number" ? total : null;
}
