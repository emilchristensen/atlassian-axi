import { describe, it, expect } from 'vitest';
import { formatCountLine } from '../src/format.js';

describe('formatCountLine', () => {
  it('returns simple count when no truncation', () => {
    expect(formatCountLine({ count: 5 })).toBe('count: 5');
  });

  it('returns count with total when totalCount is provided', () => {
    expect(formatCountLine({ count: 30, totalCount: 150 })).toBe('count: 30 of 150 total');
  });

  it('returns showing first N when truncated (count equals limit)', () => {
    expect(formatCountLine({ count: 30, limit: 30 })).toBe('count: 30 (showing first 30 — raise with --limit)');
  });

  it('returns count with total even when truncated if totalCount is known', () => {
    // totalCount takes priority over limit-based truncation message
    expect(formatCountLine({ count: 30, limit: 30, totalCount: 200 })).toBe('count: 30 of 200 total (use --limit 200 for all)');
  });

  it('returns simple count when count is less than limit', () => {
    expect(formatCountLine({ count: 5, limit: 30 })).toBe('count: 5');
  });

  it('returns count with API limit note for search', () => {
    expect(formatCountLine({ count: 1000, apiLimitHit: true })).toBe('count: 1000+ (search API limit reached)');
  });

  it('names the --limit remedy when displayLimit truncates results', () => {
    // The caller sliced a fully-fetched set, so count IS the true total and
    // raising --limit to it provably reveals everything (issue #42).
    expect(formatCountLine({ count: 50, displayLimit: 30 })).toBe(
      'count: 50 (showing first 30 — raise with --limit 50)',
    );
  });

  it('returns simple count when displayLimit is not exceeded', () => {
    expect(formatCountLine({ count: 20, displayLimit: 30 })).toBe('count: 20');
  });

  it('omits the --limit remedy on a displayLimit slice when the surface has no --limit flag', () => {
    // Flagless surfaces (the no-arg home block) still report the slice honestly
    // but must never dangle a --limit flag the caller cannot accept.
    expect(
      formatCountLine({ count: 8, displayLimit: 5, noLimitFlag: true }),
    ).toBe('count: 8 (showing first 5)');
  });

  it('handles zero count', () => {
    expect(formatCountLine({ count: 0 })).toBe('count: 0');
  });

  it('handles zero count with limit', () => {
    expect(formatCountLine({ count: 0, limit: 30 })).toBe('count: 0');
  });
});

describe('formatCountLine --limit hint gating (2026-07-19)', () => {
  it('hints --limit only when the requested limit was the binding constraint', () => {
    expect(formatCountLine({ count: 30, limit: 30, totalCount: 200 })).toBe(
      'count: 30 of 200 total (use --limit 200 for all)',
    );
  });

  it('does not overpromise when the server capped the page below the limit', () => {
    // Confluence v1 search caps a request at 250 regardless of limit.
    expect(formatCountLine({ count: 250, limit: 500, totalCount: 900 })).toBe(
      'count: 250 of 900 total',
    );
  });

  it('no hint when the page is complete', () => {
    expect(formatCountLine({ count: 2, limit: 30, totalCount: 2 })).toBe(
      'count: 2 of 2 total',
    );
  });
});
