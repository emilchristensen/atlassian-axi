import type { SiteContext } from "../context.js";
import { acliInstalled } from "../acli.js";
import { resolveCredential } from "../config.js";
import { renderHelp, renderOutput } from "../toon.js";

export const HOME_HELP = "";

/**
 * No-arg dashboard — also the session-hook target (see `setup hooks`). Phase 0
 * is intentionally minimal: it reports the resolved site (if any) and auth
 * state, then points at the command families. Later phases enrich it with
 * "my open work items" (acli) and a spaces count (Confluence REST).
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
  blocks.push(`auth: ${await resolveAuthLine()}`);
  blocks.push(
    renderHelp([
      "Run `atlassian-axi <command> <subcommand>` — commands: auth, jira, confluence, setup",
    ]),
  );

  return renderOutput(blocks);
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
