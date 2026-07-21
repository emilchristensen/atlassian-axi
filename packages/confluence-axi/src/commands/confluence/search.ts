import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "@atlassian-axi/core";
import { AxiError } from "../../errors.js";
import { formatCountLine } from "@atlassian-axi/core";
import { getSuggestions } from "../../suggestions.js";
import { renderHelp, renderList, renderOutput } from "@atlassian-axi/core";
import { parseFlags, parseLimit } from "@atlassian-axi/core";
import { resultsOf, searchResultSchema, type JsonRecord } from "./shared.js";

export const SEARCH_HELP = `usage: confluence-axi search "<CQL>" [flags]
CQL search across Confluence (v1 REST — the v2 API has no search endpoint).
flags[1]:
  --limit <n> (default 30)
examples:
  confluence-axi search "space = ENG AND type = page"
  confluence-axi search "title ~ 'release notes'" --limit 5
  confluence-axi search "text ~ 'pagination' AND lastmodified >= now('-30d')"`;

export async function searchCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--limit"] });
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
  const limit = parseLimit(parsed.values["--limit"]);

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
    blocks.push(renderList("results", items, searchResultSchema));
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
