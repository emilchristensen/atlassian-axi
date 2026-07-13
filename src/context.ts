/**
 * Resolved Atlassian site context shared by both halves of the CLI. Phase 0
 * only resolves the site name; later phases attach the resolved credential and
 * turn this into the single source of truth described in the ship report
 * (env `ATLASSIAN_SITE` > config file > unset).
 */
export interface SiteContext {
  /** Bare site name, e.g. "mysite.atlassian.net". */
  site: string;
  /** How the site was resolved — determines override precedence. */
  source: "flag" | "env";
}

/**
 * Resolve the active site. Priority: explicit `--site` flag > `ATLASSIAN_SITE`
 * env var. Returns undefined when nothing is configured; commands then surface
 * an auth/setup hint rather than guessing.
 */
export function resolveSite(flagValue?: string): SiteContext | undefined {
  if (flagValue && flagValue.trim() !== "") {
    return { site: flagValue.trim(), source: "flag" };
  }
  const envSite = process.env["ATLASSIAN_SITE"];
  if (envSite && envSite.trim() !== "") {
    return { site: envSite.trim(), source: "env" };
  }
  return undefined;
}
