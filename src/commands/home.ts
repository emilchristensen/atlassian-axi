import type { SiteContext } from "../context.js";
import { acliInstalled, acliJson } from "../acli.js";
import { resolveCredential } from "../config.js";
import { renderHelp, renderList, renderOutput } from "../toon.js";
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
 * the resolved site (if any), auth state, and a best-effort "my open work
 * items" block (acli). Phase 3 adds a Confluence spaces count.
 *
 * Best-effort by contract: this must never throw, because a thrown error would
 * poison the SessionStart ambient block for every agent session.
 */
export async function homeCommand(
  _args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const blocks: string[] = [];

  blocks.push(ctx?.site ? `site: ${ctx.site}` : "site: not configured");
  const authLine = await resolveAuthLine();
  blocks.push(`auth: ${authLine}`);

  if (authLine.startsWith("ok")) {
    const items = await myOpenWorkitems().catch(() => []);
    if (items.length > 0) {
      blocks.push(renderList("my_open_workitems", items, workitemDashboardSchema));
    }
  }

  blocks.push(
    renderHelp([
      "Run `atlassian-axi <command> <subcommand>` — commands: auth, jira, setup",
    ]),
  );

  return renderOutput(blocks);
}

// The dashboard runs inside the SessionStart hook's 10 s budget, so the
// best-effort acli search gets a short leash: a hung acli must not stall
// every agent session start (the runner's own timeout is 15 s).
const WORKITEMS_BUDGET_MS = 2_000;

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

/**
 * Best-effort auth summary for the ambient dashboard. Never throws (a thrown
 * error would poison every session's SessionStart block) and does no network:
 * it reports acli presence and whether a full credential resolves.
 */
async function resolveAuthLine(): Promise<string> {
  try {
    if (!(await acliInstalled())) {
      return "acli not installed";
    }
    const resolved = await resolveCredential();
    const configured = Boolean(
      resolved.site && resolved.email && resolved.apiToken,
    );
    return configured
      ? "ok (run `atlassian-axi auth status` to verify)"
      : "not configured";
  } catch {
    return "not configured";
  }
}
