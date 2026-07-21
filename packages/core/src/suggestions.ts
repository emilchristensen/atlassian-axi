import type { SiteContext } from "./context.js";

/**
 * Contextual next-step suggestions, keyed by {domain, action, state, isEmpty}.
 * Every command response ends with these so an agent always knows the exact
 * follow-up commands to run (the core AXI ergonomic, mirrored from gh-axi).
 *
 * This module is the domain-agnostic ENGINE. Each CLI package owns its own
 * suggestion `table` (jira-axi / confluence-axi) and passes it, plus its bin
 * name, to `matchSuggestions`.
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

export type SuggestionEntry = {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendSiteFlag(
  line: string,
  ctx: SuggestionContext,
  binName: string,
): string {
  const flag = siteFlag(ctx);
  if (!flag) return line;
  const bin = escapeRegExp(binName);
  return line.replace(
    new RegExp(`\`([^\`]*\\b${bin}\\b[^\`]*)\``, "g"),
    `\`$1${flag}\``,
  );
}

/**
 * Run a CLI's suggestion table against a context, appending the --site flag to
 * any follow-up command line that mentions the bin (when the site came from a
 * flag). First matching entry wins.
 */
export function matchSuggestions(
  table: readonly SuggestionEntry[],
  ctx: SuggestionContext,
  binName: string,
): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry.lines(ctx).map((line) => appendSiteFlag(line, ctx, binName));
    }
  }
  return [];
}

/**
 * Closest known command for did-you-mean on typos. The threshold scales with
 * input length (1 edit for short inputs, up to 2 for longer ones) so terse
 * unrelated input like `at` or `jr` never gets a bogus hint.
 */
export function closestCommand(
  input: string,
  known: readonly string[],
): string | undefined {
  const threshold = Math.min(2, Math.floor(input.length / 3) + 1);
  const normalized = input.toLowerCase();
  let best: { name: string; distance: number } | undefined;
  for (const name of known) {
    const distance = editDistance(normalized, name.toLowerCase());
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}
