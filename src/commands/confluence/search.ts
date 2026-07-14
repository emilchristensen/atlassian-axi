import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { formatCountLine } from "../../format.js";
import { getSuggestions } from "../../suggestions.js";
import { renderHelp, renderList, renderOutput } from "../../toon.js";
import { parseFlags, parseLimit } from "../shared.js";
import { resultsOf, searchResultSchema, type JsonRecord } from "./shared.js";

export const SEARCH_HELP = `usage: atlassian-axi confluence search "<CQL>" [flags]
CQL search across Confluence (v1 REST — the v2 API has no search endpoint).
flags[1]:
  --limit <n> (default 30)
examples:
  atlassian-axi confluence search "space = ENG AND type = page"
  atlassian-axi confluence search "title ~ 'release notes'" --limit 5
  atlassian-axi confluence search "text ~ 'pagination' AND lastModified >= now('-30d')"`;

export async function searchCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--limit"] });
  if (parsed.help) return SEARCH_HELP;

  // The router keeps "search" itself at args[0], so the CQL query is the
  // first positional after it — exactly what parseFlags returns.
  const cql = parsed.positional;
  if (!cql) {
    throw new AxiError("Missing CQL query", "VALIDATION_ERROR", [
      'Run `atlassian-axi confluence search "<CQL>"`',
      'Example: `atlassian-axi confluence search "space = ENG AND type = page"`',
    ]);
  }
  const limit = parseLimit(parsed.values["--limit"]);

  const payload = await confluenceJson<unknown>("/wiki/rest/api/search", {
    query: { cql, limit },
  });
  const items = resultsOf(payload);
  const totalSize = totalSizeOf(payload);

  const blocks: string[] = [
    formatCountLine({
      count: items.length,
      ...(totalSize !== null ? { totalCount: totalSize } : { limit }),
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
