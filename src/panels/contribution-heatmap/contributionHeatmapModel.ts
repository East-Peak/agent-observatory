import type { Snapshot, UsageRecord } from '@/domain/types';
import { type RateCard, normalizeCost } from '@/domain/normalizeCost';
import { aggregateByProjectPeriod, type ProjectPeriodCell } from '@/domain/aggregate';
import { quantileScale } from '@/domain/intensity';
import { bucketOf, bucketsInWindow, type BucketKind } from '@/domain/buckets';
import { currentWindow, inWindow, type RangeKey } from '@/domain/dateRange';
import { sourceOfKey, type SourceKey } from '@/domain/sources';
import { metaForKey, CODEX_PROJECT, OPENCLAW_PROJECT, UNATTRIBUTED } from '@/domain/projects';

export type Bucket = BucketKind; // 'day' | 'week' | 'month'
export type Metric = 'tokens' | 'cost';

/** One coloured cell of the grid: its raw value in the active metric + its per-section intensity bin
 *  and grid position — exactly the carriers the frozen oracle reads. */
export interface HeatmapCell {
  readonly projectKey: string;
  readonly bucketId: string;
  readonly section: 'project' | 'tool';
  readonly value: bigint;
  readonly intensity: number;
  readonly rowIndex: number; // global — project section first
  readonly colIndex: number; // bucket order
}
export interface HeatmapRow {
  readonly projectKey: string;
  readonly label: string;
  readonly cells: readonly HeatmapCell[];
}
export interface HeatmapSectionView {
  readonly section: 'project' | 'tool';
  readonly isEmpty: boolean;
  readonly rows: readonly HeatmapRow[];
}
export interface ContributionHeatmapModel {
  readonly from: string;
  readonly to: string;
  readonly buckets: readonly string[];
  /** [project section, tool section] — always both, each possibly empty. */
  readonly sections: readonly HeatmapSectionView[];
}

/** One revealed breakdown line when a cell is focused: a (source, model) pair's value in that cell. */
export interface HeatmapBreakdownRow {
  readonly key: string; // "<source>|<model>"
  readonly value: bigint;
}

const tokenTotal = (r: UsageRecord): number =>
  r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;
const isTool = (p: string): boolean => p === CODEX_PROJECT || p === OPENCLAW_PROJECT;

function earliestDate(records: readonly UsageRecord[], fallback: string): string {
  let min: string | null = null;
  for (const r of records) if (min === null || r.date < min) min = r.date;
  return min ?? fallback;
}

function scoped(snapshot: Snapshot, source: SourceKey): readonly UsageRecord[] {
  const want = sourceOfKey(source);
  return want === null ? snapshot.records : snapshot.records.filter((r) => r.source === want);
}

/** Build one section's rows from the dense grid: value per cell in the active metric, per-section
 *  quantile intensity, and the global rowIndex continuing from `startRowIndex`. */
function buildSection(
  section: 'project' | 'tool',
  rowKeys: readonly string[],
  inWindowRecords: readonly UsageRecord[],
  card: RateCard,
  bucket: Bucket,
  window: { from: string; to: string },
  metric: Metric,
  nBuckets: number,
  startRowIndex: number,
): HeatmapSectionView {
  if (rowKeys.length === 0) return { section, isEmpty: true, rows: [] };
  const grid = aggregateByProjectPeriod(inWindowRecords, card, bucket, window, rowKeys);
  const valueOf = (c: ProjectPeriodCell): bigint => (metric === 'tokens' ? BigInt(c.totalTokens) : c.costPico);
  const scale = quantileScale(grid.map(valueOf));
  const cells: HeatmapCell[] = grid.map((c, i) => {
    const value = valueOf(c);
    return {
      projectKey: c.projectKey,
      bucketId: c.bucketId,
      section,
      value,
      intensity: scale.binOf(value),
      rowIndex: startRowIndex + Math.floor(i / nBuckets),
      colIndex: i % nBuckets,
    };
  });
  const rows: HeatmapRow[] = rowKeys.map((projectKey, r) => ({
    projectKey,
    label: metaForKey(projectKey).label,
    cells: cells.slice(r * nBuckets, (r + 1) * nBuckets),
  }));
  return { section, isEmpty: false, rows };
}

/**
 * The contribution-heatmap view-model for a (range, source, bucket, metric) mode. Mirrors the frozen
 * oracle's recompute EXACTLY: source-filter, window from the scoped earliest, dense project × time grid
 * via the frozen `aggregateByProjectPeriod`, per-section `quantileScale` intensity. Project section =
 * repo + `__unattributed__` (effort desc, Unattributed last); Tools strip = the present tool sentinels
 * in fixed order. Global rowIndex runs project rows first.
 */
export function selectContributionHeatmap(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
  bucket: Bucket,
  metric: Metric,
): ContributionHeatmapModel {
  const rows = scoped(snapshot, source);
  const window = currentWindow(range, snapshot.asOf, earliestDate(rows, snapshot.asOf));
  const inCur = rows.filter((r) => inWindow(r.date, window));
  const buckets = bucketsInWindow(window.from, window.to, bucket);

  const effort = new Map<string, number>();
  for (const r of inCur) effort.set(r.project, (effort.get(r.project) ?? 0) + tokenTotal(r));

  const projectRowKeys = [...effort.keys()]
    .filter((p) => !isTool(p))
    .sort((a, b) => {
      const au = a === UNATTRIBUTED;
      const bu = b === UNATTRIBUTED;
      if (au !== bu) return au ? 1 : -1; // Unattributed last
      const ta = effort.get(a)!;
      const tb = effort.get(b)!;
      if (ta !== tb) return tb - ta; // effort desc
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const toolRowKeys = [CODEX_PROJECT, OPENCLAW_PROJECT].filter((p) => effort.has(p)); // fixed order

  const n = buckets.length;
  const projectSection = buildSection('project', projectRowKeys, inCur, card, bucket, window, metric, n, 0);
  const toolStart = projectSection.isEmpty ? 0 : projectRowKeys.length;
  const toolSection = buildSection('tool', toolRowKeys, inCur, card, bucket, window, metric, n, toolStart);

  return { from: window.from, to: window.to, buckets, sections: [projectSection, toolSection] };
}

/** The (source, model) breakdown a focused cell reveals: the cell's own records grouped by source|model,
 *  summed in the active metric. Mirrors the oracle's recomputeCellBreakdown. */
export function selectCellBreakdown(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
  bucket: Bucket,
  metric: Metric,
  projectKey: string,
  bucketId: string,
): HeatmapBreakdownRow[] {
  const rows = scoped(snapshot, source);
  const window = currentWindow(range, snapshot.asOf, earliestDate(rows, snapshot.asOf));
  const cellRecs = rows.filter(
    (r) => r.project === projectKey && inWindow(r.date, window) && bucketOf(r.date, bucket) === bucketId,
  );
  const by = new Map<string, bigint>();
  for (const r of cellRecs) {
    const k = `${r.source}|${r.model}`;
    by.set(k, (by.get(k) ?? 0n) + (metric === 'tokens' ? BigInt(tokenTotal(r)) : normalizeCost(r, card)));
  }
  return [...by.entries()].map(([key, value]) => ({ key, value }));
}
