/**
 * Shared formatting helpers for consistent count and truncation phrasing.
 *
 * Standard phrases:
 *   count: N                                — simple count
 *   count: N of T total                     — when total is known
 *   count: N (showing first D — raise with --limit N) — client-side slice
 *   count: N (showing first N — raise with --limit)   — request limit hit
 *   count: N+ (GitHub search API limit reached) — search API limit
 */

export interface CountLineOptions {
  /** Number of items returned / displayed. */
  count: number;
  /** The request limit; when count === limit, results may be truncated. */
  limit?: number;
  /** True total count from an API (e.g. GraphQL totalCount). */
  totalCount?: number;
  /** Whether the API limit was reached (search-specific). */
  apiLimitHit?: boolean;
  /** Display limit that further truncates results for output. */
  displayLimit?: number;
}

export function formatCountLine(opts: CountLineOptions): string {
  const { count, limit, totalCount, apiLimitHit, displayLimit } = opts;

  // API limit hit (search)
  if (apiLimitHit) {
    return `count: ${count}+ (GitHub search API limit reached)`;
  }

  // Total count known from GraphQL or API — when the REQUESTED limit was the
  // binding constraint, say how to get the rest (--limit is otherwise
  // undiscoverable at the moment it matters). When count < limit the server
  // capped the page instead, so promising "--limit N for all" would be false
  // (Confluence v1 search caps a request at 250 — review finding 2026-07-19).
  if (totalCount !== undefined && totalCount !== null) {
    return count < totalCount && limit !== undefined && count === limit
      ? `count: ${count} of ${totalCount} total (use --limit ${totalCount} for all)`
      : `count: ${count} of ${totalCount} total`;
  }

  // Display limit truncation (e.g. search showing first N of results). The
  // caller sliced a fully-fetched set client-side, so `count` IS the true
  // total and raising --limit to it provably reveals everything — name the
  // remedy, matching the count === limit branch below.
  if (displayLimit !== undefined && count > displayLimit) {
    return `count: ${count} (showing first ${displayLimit} — raise with --limit ${count})`;
  }

  // Hit the request limit — results may be truncated
  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count} — raise with --limit)`;
  }

  // Simple count
  return `count: ${count}`;
}
