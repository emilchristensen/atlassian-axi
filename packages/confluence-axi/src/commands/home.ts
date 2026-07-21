import {
  renderHelp,
  renderOutput,
  type SiteContext,
} from "@atlassian-axi/core";
import { resolveAuthMode } from "../config.js";
import { confluenceJson } from "../confluence.js";
import { hasNextPage, resultsOf } from "./confluence/shared.js";

export const HOME_HELP = "";

/**
 * No-arg dashboard — also the session-hook target (see `setup hooks`). Reports
 * the resolved site (if any), auth state, and a best-effort "spaces" count
 * (Confluence REST).
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
    const spacesLine = await spacesCount().catch(() => null);
    if (spacesLine !== null) {
      blocks.push(`spaces: ${spacesLine}`);
    }
  }

  blocks.push(
    renderHelp([
      "Run `confluence-axi <command> <subcommand>` — commands: auth, page, space, search, setup",
    ]),
  );

  return renderOutput(blocks);
}

// The dashboard runs inside the SessionStart hook's 10 s budget, so the
// best-effort fetch gets a short leash.
const SPACES_BUDGET_MS = 2_000;
const SPACES_PROBE_LIMIT = 25;

/**
 * Best-effort spaces count for the dashboard. v2 spaces has no total count, so
 * probe one page and render "N" or "N+" when more exist; null (rendered as no
 * line at all) on any failure.
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
