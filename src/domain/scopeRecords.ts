import type { UsageRecord } from '@/domain/types';
import { currentWindow, inWindow, type RangeKey } from '@/domain/dateRange';
import { sourceOfKey, type SourceKey } from '@/domain/sources';

export interface ScopedWindow {
  /** Source-filtered records across ALL dates (for a panel that also needs a prior window). */
  readonly scoped: readonly UsageRecord[];
  /** The current window, resolved from the source-scoped earliest date (asOf fallback). */
  readonly window: { readonly from: string; readonly to: string };
  /** `scoped` intersected with the current window — what most panels aggregate. */
  readonly records: readonly UsageRecord[];
}

/**
 * The one (source, range) scope every panel model shares: filter by source, resolve the window from the
 * source-scoped earliest date, keep in-window records. Returns the source-scoped set + the window too,
 * so a panel that needs a prior period (spendOverview's delta) can reuse them.
 */
export function scopeRecords(
  records: readonly UsageRecord[],
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): ScopedWindow {
  const want = sourceOfKey(source);
  const scoped = want === null ? records : records.filter((r) => r.source === want);
  let earliest: string | null = null;
  for (const r of scoped) if (earliest === null || r.date < earliest) earliest = r.date;
  const window = currentWindow(range, asOf, earliest ?? asOf);
  return { scoped, window, records: scoped.filter((r) => inWindow(r.date, window)) };
}
