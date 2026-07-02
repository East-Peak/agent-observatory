import type { Snapshot } from '@/domain/types';
import { normalizeCost, type RateCard } from '@/domain/normalizeCost';
import { aggregateByDay } from '@/domain/aggregate';
import { priorWindow, inWindow, type RangeKey } from '@/domain/dateRange';
import { type SourceKey } from '@/domain/sources';
import { scopeRecords } from '@/domain/scopeRecords';

/** One day on the spend sparkline: normalized cost (pico-USD BigInt) + summed token volume. */
export interface SpendPoint {
  readonly date: string;
  readonly costPico: bigint;
  readonly totalTokens: number;
}

/**
 * The spendOverview view-model: normalized $ + tokens over the scoped window, the daily series
 * behind the sparkline, and the delta against the equal-length prior period. All money is exact
 * pico-USD `BigInt`; the dollar conversion happens only at the render boundary.
 */
export interface SpendOverviewModel {
  /** Concrete inclusive window the scope resolved to. */
  readonly from: string;
  readonly to: string;
  readonly totalCostPico: bigint;
  readonly totalTokens: number;
  /** Distinct days with activity in the window (= series length). */
  readonly activeDays: number;
  readonly priorCostPico: bigint;
  /** `totalCostPico − priorCostPico` (signed). */
  readonly deltaCostPico: bigint;
  /** Signed change vs prior period in basis points (100 = 1%); 0 when there is no prior baseline. */
  readonly deltaBasisPoints: number;
  readonly series: readonly SpendPoint[];
}

/** Derive the spendOverview view-model from a snapshot + rate card for a (range, source) scope. */
export function selectSpendOverview(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): SpendOverviewModel {
  const { scoped, window, records: inCurrent } = scopeRecords(snapshot.records, snapshot.asOf, range, source);
  const days = aggregateByDay(inCurrent, card);

  const totalCostPico = days.reduce((a, d) => a + d.costPico, 0n);
  const totalTokens = days.reduce((a, d) => a + d.totalTokens, 0);

  const prior = priorWindow(window);
  const priorCostPico = scoped
    .filter((r) => inWindow(r.date, prior))
    .reduce((a, r) => a + normalizeCost(r, card), 0n);

  const deltaCostPico = totalCostPico - priorCostPico;
  const deltaBasisPoints = priorCostPico === 0n ? 0 : Number((deltaCostPico * 10000n) / priorCostPico);

  return {
    from: window.from,
    to: window.to,
    totalCostPico,
    totalTokens,
    activeDays: days.length,
    priorCostPico,
    deltaCostPico,
    deltaBasisPoints,
    series: days.map((d) => ({ date: d.date, costPico: d.costPico, totalTokens: d.totalTokens })),
  };
}
