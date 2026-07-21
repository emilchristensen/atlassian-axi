import type { SiteContext } from "../context.js";
import { acliInstalled, acliJson } from "../acli.js";
import { resolveAuthMode } from "../config.js";
import { confluenceJson } from "../confluence.js";
import { renderHelp, renderList, renderOutput } from "../toon.js";
import { hasNextPage, resultsOf } from "./confluence/shared.js";
import {
  itemsOf,
  workitemDashboardSchema,
  type JsonRecord,
} from "./jira/shared.js";

export const HOME_HELP = "";

const MY_OPEN_JQL =
  "assignee = currentUser() AND resolution = EMPTY ORDER BY updated DESC";

/**
 * No-arg dashboard — also the session-hook target (see `setup hooks`). Reports
 * the resolved site (if any), auth state, and best-effort "my open work
 * items" (acli) and "spaces" (Confluence REST) blocks.
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
    // The two halves are gated independently: the Confluence spaces probe
    // needs only the credential, the workitems probe additionally needs acli.
    // Both fetches are budget-capped; run them in parallel.
    const [items, spacesLine] = await Promise.all([
      auth.acliInstalled
        ? myOpenWorkitems().catch(() => [] as JsonRecord[])
        : Promise.resolve([] as JsonRecord[]),
      spacesCount().catch(() => null),
    ]);
    if (items.length > 0) {
      blocks.push(renderList("my_open_workitems", items, workitemDashboardSchema));
    }
    if (spacesLine !== null) {
      blocks.push(`spaces: ${spacesLine}`);
    }
  }

  blocks.push(
    renderHelp([
      "Run `atlassian-axi <command> <subcommand>` — commands: auth, jira, confluence, setup",
    ]),
  );

  return renderOutput(blocks);
}

// The dashboard runs inside the SessionStart hook's 10 s budget, so each
// best-effort fetch gets a short leash: a hung acli or a slow Confluence API
// must not stall every agent session start (their own timeouts are 15 s).
const WORKITEMS_BUDGET_MS = 2_000;
const SPACES_BUDGET_MS = 2_000;
const SPACES_PROBE_LIMIT = 25;

/** Best-effort my-open-workitems fetch (report §4.5); errors degrade to []. */
async function myOpenWorkitems(): Promise<JsonRecord[]> {
  const payload = await withBudget(
    acliJson<unknown>([
      "jira",
      "workitem",
      "search",
      "--jql",
      MY_OPEN_JQL,
      "--limit",
      "3",
      "--json",
    ]),
    WORKITEMS_BUDGET_MS,
    [] as unknown,
  );
  return itemsOf(payload, "issues", "workItems", "results", "values").slice(0, 3);
}

/**
 * Best-effort spaces count for the dashboard (report §4.5). v2 spaces has no
 * total count, so probe one page and render "N" or "N+" when more exist;
 * null (rendered as no line at all) on any failure.
 */
async function spacesCount(): Promise<string | null> {
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
  const count = resultsOf(payload).length;
  return hasNextPage(payload) ? `${count}+` : String(count);
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
  /** acli on PATH — additionally gates the Jira workitems probe. */
  acliInstalled: boolean;
  /** Site of the resolved credential (either auth mode); undefined when none. */
  site?: string;
}

/**
 * Best-effort auth summary for the ambient dashboard. Never throws (a thrown
 * error would poison every session's SessionStart block) and does no network:
 * it reports acli presence and whether a full credential resolves — as
 * independent facts, because the Confluence half works without acli.
 */
async function resolveAuthState(): Promise<AuthState> {
  try {
    const [installed, mode] = await Promise.all([
      acliInstalled().catch(() => false),
      resolveAuthMode(),
    ]);
    const configured = mode.mode !== "none";
    if (!configured) {
      return {
        line: installed ? "not configured" : "not configured (acli not installed)",
        configured,
        acliInstalled: installed,
      };
    }
    const modeLabel = mode.mode === "oauth" ? "oauth" : "api-token";
    const site =
      mode.mode === "oauth" ? mode.oauth.site : mode.credential.site;
    return {
      line: installed
        ? `ok (${modeLabel} — run \`atlassian-axi auth status\` to verify)`
        : `ok (${modeLabel}, Confluence only — acli not installed, Jira half unavailable)`,
      configured,
      acliInstalled: installed,
      ...(site ? { site } : {}),
    };
  } catch {
    return { line: "not configured", configured: false, acliInstalled: false };
  }
}
