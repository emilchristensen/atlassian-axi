/**
 * Shared formatting helpers for consistent count and truncation phrasing.
 *
 * Standard phrases:
 *   count: N                                — simple count
 *   count: N of T total                     — when total is known
 *   count: N (showing first D — raise with --limit N) — client-side slice
 *   count: N (showing first D)              — client-side slice, no --limit flag
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
  /**
   * Client-side slice size, for callers that fetched the collection UNBOUNDED
   * and sliced it for output.
   *
   * PRECONDITION: `count` must be the true total. The rendered hint promises
   * that `--limit ${count}` reveals everything, which is only honest when
   * nothing was left on the server. A server-paged fetch must use `limit`
   * instead - that branch deliberately refuses to name a number, because the
   * server may have capped the page below what was asked for.
   */
  displayLimit?: number;
  /**
   * Suppress the "raise with --limit N" remedy on a `displayLimit` slice, for
   * surfaces that have NO --limit flag to raise (e.g. the no-arg home block).
   * The slice is still reported honestly ("showing first D"); it just never
   * dangles a flag the caller cannot accept.
   */
  noLimitFlag?: boolean;
}

export function formatCountLine(opts: CountLineOptions): string {
  const { count, limit, totalCount, apiLimitHit, displayLimit, noLimitFlag } =
    opts;

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
    return noLimitFlag
      ? `count: ${count} (showing first ${displayLimit})`
      : `count: ${count} (showing first ${displayLimit} — raise with --limit ${count})`;
  }

  // Hit the request limit — results may be truncated
  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count} — raise with --limit)`;
  }

  // Simple count
  return `count: ${count}`;
}
