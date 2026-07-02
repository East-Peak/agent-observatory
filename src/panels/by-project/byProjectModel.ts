import type { Snapshot } from '@/domain/types';
import { type RateCard } from '@/domain/normalizeCost';
import { aggregateByProject, type ProjectTotal } from '@/domain/aggregate';
import { type RangeKey } from '@/domain/dateRange';
import { type SourceKey } from '@/domain/sources';
import { scopeRecords } from '@/domain/scopeRecords';

/**
 * The byProject leaderboard view-model: total normalized spend over the repo + `__unattributed__` GRID
 * (tools excluded) plus one ranked row per project (cost, token volume, token share of the grid). The
 * frozen `aggregateByProject` does the tool-exclusion, share, and effort-desc-then-Unattributed-last
 * sort; a tool-only source scope yields an empty grid → `isEmpty` → the panel's empty state.
 */
export interface ByProjectModel {
  readonly from: string;
  readonly to: string;
  readonly totalCostPico: bigint;
  readonly rows: readonly ProjectTotal[];
  readonly isEmpty: boolean;
}

export function selectByProject(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): ByProjectModel {
  const { records, window } = scopeRecords(snapshot.records, snapshot.asOf, range, source);
  const rows = aggregateByProject(records, card);
  const totalCostPico = rows.reduce((acc, r) => acc + r.costPico, 0n);
  return { from: window.from, to: window.to, totalCostPico, rows, isEmpty: rows.length === 0 };
}
