import type { Snapshot, Source } from '@/domain/types';
import { type RateCard } from '@/domain/normalizeCost';
import { aggregateBySourceModel } from '@/domain/aggregate';
import { type RangeKey } from '@/domain/dateRange';
import { type SourceKey } from '@/domain/sources';
import { scopeRecords } from '@/domain/scopeRecords';

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

/**
 * Derive the bySourceModel view-model for a `(range, source)` scope. Shares the `scopeRecords` scoping,
 * then rolls up by `(source, model)` through the injected rate card (so cost flows through `normalizeCost`
 * and stays coupled to the card). `totalTokens` sums every token kind and is invariant under card scaling.
 */
export function selectBySourceModel(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): BySourceModelModel {
  const { records: inCurrent, window } = scopeRecords(snapshot.records, snapshot.asOf, range, source);

  const rows = aggregateBySourceModel(inCurrent, card).map((a) => ({
    key: `${a.source}|${a.model}`,
    source: a.source,
    model: a.model,
    costPico: a.costPico,
    totalTokens: a.totalTokens,
  }));
  const totalCostPico = rows.reduce((acc, r) => acc + r.costPico, 0n);
  const totalTokens = rows.reduce((acc, r) => acc + r.totalTokens, 0);

  return { from: window.from, to: window.to, totalCostPico, totalTokens, rows };
}
