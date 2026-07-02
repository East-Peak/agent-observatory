import type { Snapshot, Source, UsageRecord } from '@/domain/types';
import { normalizeCost, type RateCard } from '@/domain/normalizeCost';
import { type RangeKey } from '@/domain/dateRange';
import { type SourceKey } from '@/domain/sources';
import { scopeRecords } from '@/domain/scopeRecords';

/** One activity-feed item: a single scoped `(source, date, model, project)` cell with its normalized cost. */
export interface FeedItem {
  /** `"<source>|<date>|<model>|<projectKey>"` — the house-style feed key the verifier reads. The
   * project key is part of the identity so per-project records sharing a (source, date, model) triple
   * stay distinct feed rows rather than collapsing/colliding. */
  readonly key: string;
  readonly source: Source;
  readonly date: string;
  readonly model: string;
  readonly project: string;
  readonly costPico: bigint;
  readonly totalTokens: number;
}

/** The activityFeed view-model: total normalized spend + token volume + one item per scoped record. */
export interface ActivityFeedModel {
  readonly from: string;
  readonly to: string;
  readonly totalCostPico: bigint;
  /** Σ of every token kind across the scoped records (the invariant `total-tokens` metric). */
  readonly totalTokens: number;
  readonly items: readonly FeedItem[];
}

function tokenTotal(r: UsageRecord): number {
  return r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;
}

/**
 * Derive the activityFeed view-model for a `(range, source)` scope. Shares the `scopeRecords` scoping,
 * then emits one item per record with its cost flowed through the injected rate card via `normalizeCost`
 * (so each item scales with the card). Items are ordered most-recent first for the feed; the oracle
 * compares them as an unordered multiset.
 */
export function selectActivityFeed(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): ActivityFeedModel {
  const { records: inCurrent, window } = scopeRecords(snapshot.records, snapshot.asOf, range, source);

  const items: FeedItem[] = inCurrent.map((r) => ({
    key: `${r.source}|${r.date}|${r.model}|${r.project}`,
    source: r.source,
    date: r.date,
    model: r.model,
    project: r.project,
    costPico: normalizeCost(r, card),
    totalTokens: tokenTotal(r),
  }));
  const totalCostPico = items.reduce((acc, i) => acc + i.costPico, 0n);
  const totalTokens = items.reduce((acc, i) => acc + i.totalTokens, 0);

  // Display order only (most-recent first, then most-expensive); the oracle compares as a multiset.
  const ordered = [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.costPico !== b.costPico) return a.costPico > b.costPico ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return { from: window.from, to: window.to, totalCostPico, totalTokens, items: ordered };
}
