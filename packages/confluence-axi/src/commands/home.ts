import {
  formatCountLine,
  renderHelp,
  renderList,
  renderOutput,
  type SiteContext,
} from "@atlassian-axi/core";
import { resolveAuthMode } from "../config.js";
import { confluenceJson } from "../confluence.js";
import { getSuggestions } from "../suggestions.js";
import {
  hasNextPage,
  resultsOf,
  spaceListSchema,
  type JsonRecord,
} from "./confluence/shared.js";

export const HOME_HELP = "";

/**
 * No-arg dashboard — also the session-hook target (see `setup hooks`). Reports
 * the resolved site (if any), auth state, and a best-effort spaces block:
 * the count plus the first few space rows (Confluence REST).
 *
 * Best-effort by contract: this must never throw, because a thrown error would
 * poison the SessionStart ambient block for every agent session.
 */
export async function homeCommand(
  _args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const blocks: string[] = [];

  const auth = await resolveAuthState();
  // Site precedence mirrors the credential resolution: an explicit --site
  // flag or ATLASSIAN_SITE env (ctx) wins, then the stored credential's site.
  // Without the fallback the dashboard said "site: not configured" while
  // auth was ok — a contradiction in every agent's ambient block.
  const site = ctx?.site ?? auth.site;
  blocks.push(site ? `site: ${site}` : "site: not configured");
  blocks.push(`auth: ${auth.line}`);

  if (auth.configured) {
    // Best-effort, budget-capped: a slow Confluence API must not stall every
    // agent session start (the transport's own timeout is 15 s).
    const spaces = await probeSpaces().catch(() => null);
    if (spaces !== null) {
      const count = spaces.items.length;
      // Mirror `space list`: a v2 next-cursor means the probe window was the
      // binding cap, so render the count as truncated. Separate `count` key
      // from the `spaces[N]` rows below (one output must not carry two `spaces`).
      blocks.push(
        formatCountLine({ count, ...(spaces.hasMore ? { limit: count } : {}) }),
      );
      if (count > 0) {
        // Content first: the space KEYS are what `page create --space <KEY>`
        // and `search "space = KEY"` need, and they are already fetched — a
        // bare count would force a second call for data we hold.
        blocks.push(
          renderList(
            "spaces",
            spaces.items.slice(0, SPACES_SHOWN),
            spaceListSchema,
          ),
        );
      }
    }
  }

  blocks.push(
    renderHelp(getSuggestions({ domain: "home", action: "home", site: ctx })),
  );

  return renderOutput(blocks);
}

// The dashboard runs inside the SessionStart hook's 10 s budget, so the
// best-effort fetch gets a short leash.
const SPACES_BUDGET_MS = 2_000;
const SPACES_PROBE_LIMIT = 25;
// The ambient block stays small: enough keys to act on, not a full listing
// (`confluence-axi space list` is the complete view).
const SPACES_SHOWN = 5;

interface SpacesProbe {
  items: JsonRecord[];
  /** v2 cursor has a next page — more spaces exist beyond the probe window. */
  hasMore: boolean;
}

/**
 * Best-effort spaces probe for the dashboard: the fetched rows themselves, so
 * an agent gets addressable space keys instead of a bare number. v2 spaces has
 * no total count, so a next cursor is the only truncation signal. null
 * (rendered as no block at all) on any failure.
 */
async function probeSpaces(): Promise<SpacesProbe | null> {
  const payload = await withBudget(
    confluenceJson<unknown>("/wiki/api/v2/spaces", {
      query: { limit: SPACES_PROBE_LIMIT },
    }),
    SPACES_BUDGET_MS,
    null as unknown,
  );
  if (payload === null) {
    return null;
  }
  return {
    items: resultsOf(payload),
    hasMore: hasNextPage(payload),
  };
}

/** Resolve to `fallback` when `promise` misses the deadline or rejects. */
function withBudget<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

interface AuthState {
  line: string;
  /** Full credential resolves — gates the Confluence spaces probe. */
  configured: boolean;
  /** Site of the resolved credential (either auth mode); undefined when none. */
  site?: string;
}

/**
 * Best-effort auth summary for the ambient dashboard. Never throws (a thrown
 * error would poison every session's SessionStart block) and does no network:
 * it reports whether a full credential resolves.
 */
async function resolveAuthState(): Promise<AuthState> {
  try {
    const mode = await resolveAuthMode();
    const configured = mode.mode !== "none";
    if (!configured) {
      return { line: "not configured", configured };
    }
    const modeLabel = mode.mode === "oauth" ? "oauth" : "api-token";
    const site =
      mode.mode === "oauth" ? mode.oauth.site : mode.credential.site;
    return {
      line: `ok (${modeLabel} — run \`confluence-axi auth status\` to verify)`,
      configured,
      ...(site ? { site } : {}),
    };
  } catch {
    return { line: "not configured", configured: false };
  }
}
