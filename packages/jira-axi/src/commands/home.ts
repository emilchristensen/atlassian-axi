import { renderHelp, renderList, renderOutput } from "@atlassian-axi/core";
import { acliInstalled, acliJson } from "../acli.js";
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
 * the acli install/login state and a best-effort "my open work items" block.
 *
 * Auth is delegated entirely to acli's own login, so there is no credential to
 * resolve here: a successful workitems probe implies acli is logged in, a
 * failing one implies it is not (or the backend is unreachable).
 *
 * Best-effort by contract: this must never throw, because a thrown error would
 * poison the SessionStart ambient block for every agent session.
 */
export async function homeCommand(): Promise<string> {
  const blocks: string[] = [];

  const installed = await acliInstalled().catch(() => false);
  if (!installed) {
    blocks.push(
      "acli: not installed (install it, e.g. `brew install acli`, then `acli jira auth login`)",
    );
    blocks.push(helpBlock());
    return renderOutput(blocks);
  }

  // acli is on PATH; a workitems probe doubles as the login check. null means
  // the probe failed (not logged in, or the backend was unreachable).
  const items = await myOpenWorkitems();
  if (items === null) {
    blocks.push("acli: installed (run `acli jira auth login` if commands fail)");
  } else {
    blocks.push("acli: installed");
    if (items.length > 0) {
      blocks.push(
        renderList("my_open_workitems", items, workitemDashboardSchema),
      );
    }
  }

  blocks.push(helpBlock());
  return renderOutput(blocks);
}

function helpBlock(): string {
  return renderHelp([
    "Run `jira-axi <command> <subcommand>` - commands: workitem, project, board, sprint, filter, dashboard, field, setup",
  ]);
}

// The dashboard runs inside the SessionStart hook's 10 s budget, so the
// best-effort fetch gets a short leash: a hung acli must not stall every agent
// session start (its own timeout is 15 s).
const WORKITEMS_BUDGET_MS = 2_000;

/**
 * Best-effort my-open-workitems fetch. Returns the items on success (possibly
 * empty), or null when acli errors or misses the budget — the caller uses null
 * to distinguish "logged in, no items" from "not logged in / unreachable".
 */
async function myOpenWorkitems(): Promise<JsonRecord[] | null> {
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
    ]).catch(() => null),
    WORKITEMS_BUDGET_MS,
    null,
  );
  if (payload === null) {
    return null;
  }
  return itemsOf(payload, "issues", "workItems", "results", "values").slice(
    0,
    3,
  );
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
