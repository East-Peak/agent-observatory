/**
 * Pure, UTC-only calendar math for relative time-ranges.
 *
 * Relative ranges anchor to the snapshot's `asOf` — NEVER wall-clock — and all date
 * arithmetic is integer-based (Howard Hinnant's days-from-civil algorithm), so it carries
 * no timezone and reads no `Date` API. The `clock-determinism` gate statically forbids
 * `Date.now` / `new Date` / local-tz getters in this path; this module honours that with
 * pure arithmetic over `YYYY-MM-DD` strings (which compare lexicographically = chronologically).
 */

export type RangeKey = 'last7' | 'last30' | 'thisMonth' | 'all';

export interface RangeOption {
  readonly key: RangeKey;
  readonly label: string;
}

/** House-style time-range options, in display order (the frozen smoke asserts these labels). */
export const RANGE_OPTIONS: readonly RangeOption[] = [
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Days since 1970-01-01 for a proleptic-Gregorian (y, m, d). Integer-exact, UTC, no Date. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Inverse of {@link daysFromCivil}: (days since epoch) -> (y, m, d). */
function civilFromDays(z: number): readonly [number, number, number] {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return [m <= 2 ? y + 1 : y, m, d];
}

/** `YYYY-MM-DD` -> integer day ordinal (days since 1970-01-01). */
export function toOrdinal(iso: string): number {
  const [y, m, d] = iso.split('-');
  return daysFromCivil(Number(y), Number(m), Number(d));
}

/** Integer day ordinal -> zero-padded `YYYY-MM-DD`. */
export function fromOrdinal(n: number): string {
  const [y, m, d] = civilFromDays(n);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** `iso` shifted by `n` whole days (negative = into the past). */
export function addDays(iso: string, n: number): string {
  return fromOrdinal(toOrdinal(iso) + n);
}

/** An inclusive `[from, to]` calendar window (both bounds are real days with data possible). */
export interface DateWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * The concrete inclusive window a range selects, anchored to `asOf`. `earliest` is the first
 * day that carries data in the current scope — it is the lower bound for `All Time` (so the
 * prior-period math has a real span to mirror).
 */
export function currentWindow(range: RangeKey, asOf: string, earliest: string): DateWindow {
  switch (range) {
    case 'last7':
      return { from: addDays(asOf, -6), to: asOf };
    case 'last30':
      return { from: addDays(asOf, -29), to: asOf };
    case 'thisMonth':
      return { from: `${asOf.slice(0, 7)}-01`, to: asOf };
    case 'all':
      return { from: earliest, to: asOf };
  }
}

/** The equal-length window immediately preceding `current` (for delta-vs-prior-period). */
export function priorWindow(current: DateWindow): DateWindow {
  const length = toOrdinal(current.to) - toOrdinal(current.from) + 1;
  return { from: addDays(current.from, -length), to: addDays(current.from, -1) };
}

/** Inclusive membership test (string compare is chronological for `YYYY-MM-DD`). */
export function inWindow(date: string, w: DateWindow): boolean {
  return date >= w.from && date <= w.to;
}
