import { toOrdinal, fromOrdinal } from './dateRange';

/** The time granularity of a contribution-grid column. */
export type BucketKind = 'day' | 'week' | 'month';

/**
 * The bucket id a `YYYY-MM-DD` date falls into, UTC + pure-integer (no `Date` API, so it passes the
 * `clock-determinism` gate):
 *  - `day`   → the date itself (`YYYY-MM-DD`)
 *  - `week`  → the ISO-8601 Monday of its week, as `YYYY-MM-DD`
 *  - `month` → `YYYY-MM`
 */
export function bucketOf(isoDate: string, bucket: BucketKind): string {
  if (bucket === 'day') return isoDate;
  if (bucket === 'month') return isoDate.slice(0, 7);
  // week: 1970-01-05 (ordinal 4) was a Monday, so Mondays sit at ordinals ≡ 4 (mod 7). The `+7) % 7`
  // keeps the offset non-negative for any date.
  const o = toOrdinal(isoDate);
  const mondayOffset = (((o - 4) % 7) + 7) % 7;
  return fromOrdinal(o - mondayOffset);
}

/**
 * The ordered, de-duplicated bucket ids spanning an inclusive `[from, to]` day window — DENSE: every
 * bucket the window touches is present, even one with no data (the contribution grid materializes zero
 * cells over the full cartesian rows × buckets). A partial first/last week is labeled by its Monday.
 */
export function bucketsInWindow(from: string, to: string, bucket: BucketKind): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let o = toOrdinal(from); o <= toOrdinal(to); o++) {
    const id = bucketOf(fromOrdinal(o), bucket);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
