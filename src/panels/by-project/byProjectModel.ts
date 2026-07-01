import type { Snapshot, UsageRecord } from '@/domain/types';
import { type RateCard } from '@/domain/normalizeCost';
import { aggregateByProject, type ProjectTotal } from '@/domain/aggregate';
import { currentWindow, inWindow, type RangeKey } from '@/domain/dateRange';
import { sourceOfKey, type SourceKey } from '@/domain/sources';

/**
 * The byProject leaderboard view-model: total normalized spend over the repo + `__unattributed__`
 * GRID (tools excluded) plus one ranked row per project (cost, token volume, token share of the grid).
 * Scoping mirrors the frozen oracle's `recomputeByProject` EXACTLY — filter by source, resolve the
 * window from the source-scoped earliest date, keep in-window records — then hand off to the frozen
 * `aggregateByProject` (tool-exclusion, share basis points, effort-desc-then-Unattributed-last sort).
 * A tool-only source scope yields an empty grid → `isEmpty` → the panel's empty state.
 */
export interface ByProjectModel {
  readonly from: string;
  readonly to: string;
  readonly totalCostPico: bigint;
  readonly rows: readonly ProjectTotal[];
  readonly isEmpty: boolean;
}

function earliestDate(records: readonly UsageRecord[], fallback: string): string {
  let min: string | null = null;
  for (const r of records) if (min === null || r.date < min) min = r.date;
  return min ?? fallback;
}

export function selectByProject(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): ByProjectModel {
  const wantSource = sourceOfKey(source);
  const scoped =
    wantSource === null ? snapshot.records : snapshot.records.filter((r) => r.source === wantSource);

  const current = currentWindow(range, snapshot.asOf, earliestDate(scoped, snapshot.asOf));
  const inCurrent = scoped.filter((r) => inWindow(r.date, current));

  const rows = aggregateByProject(inCurrent, card);
  const totalCostPico = rows.reduce((acc, r) => acc + r.costPico, 0n);

  return { from: current.from, to: current.to, totalCostPico, rows, isEmpty: rows.length === 0 };
}
