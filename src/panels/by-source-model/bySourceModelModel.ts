import type { Snapshot, Source, UsageRecord } from '@/domain/types';
import { type RateCard } from '@/domain/normalizeCost';
import { aggregateBySourceModel } from '@/domain/aggregate';
import { currentWindow, inWindow, type RangeKey } from '@/domain/dateRange';
import { sourceOfKey, type SourceKey } from '@/domain/sources';

/** One breakdown row: a `(source, model)` pair with its normalized pico-USD cost in scope. */
export interface SourceModelRow {
  /** `"<source>|<model>"` — the house-style row key the verifier reads. */
  readonly key: string;
  readonly source: Source;
  readonly model: string;
  readonly costPico: bigint;
  readonly totalTokens: number;
}

/** The bySourceModel view-model: total normalized spend + token volume + one row per `(source, model)`. */
export interface BySourceModelModel {
  readonly from: string;
  readonly to: string;
  readonly totalCostPico: bigint;
  /** Σ of every token kind across the scoped records (the invariant `total-tokens` metric). */
  readonly totalTokens: number;
  readonly rows: readonly SourceModelRow[];
}

function earliestDate(records: readonly UsageRecord[], fallback: string): string {
  let min: string | null = null;
  for (const r of records) if (min === null || r.date < min) min = r.date;
  return min ?? fallback;
}

/**
 * Derive the bySourceModel view-model for a `(range, source)` scope. Mirrors the oracle's scoping
 * exactly: filter by source, resolve the window from the source-scoped earliest date, keep in-window
 * records, then roll up by `(source, model)` through the injected rate card (so cost flows through
 * `normalizeCost` and stays coupled to the card). `totalTokens` sums every token kind, matching the
 * oracle's `tokenTotal`, and is invariant under rate-card scaling.
 */
export function selectBySourceModel(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): BySourceModelModel {
  const wantSource = sourceOfKey(source);
  const scoped =
    wantSource === null ? snapshot.records : snapshot.records.filter((r) => r.source === wantSource);

  const current = currentWindow(range, snapshot.asOf, earliestDate(scoped, snapshot.asOf));
  const inCurrent = scoped.filter((r) => inWindow(r.date, current));

  const rows = aggregateBySourceModel(inCurrent, card).map((a) => ({
    key: `${a.source}|${a.model}`,
    source: a.source,
    model: a.model,
    costPico: a.costPico,
    totalTokens: a.totalTokens,
  }));
  const totalCostPico = rows.reduce((acc, r) => acc + r.costPico, 0n);
  const totalTokens = rows.reduce((acc, r) => acc + r.totalTokens, 0);

  return { from: current.from, to: current.to, totalCostPico, totalTokens, rows };
}
