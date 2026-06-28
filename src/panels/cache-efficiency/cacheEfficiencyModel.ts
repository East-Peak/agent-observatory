import type { Snapshot, UsageRecord } from '@/domain/types';
import { type RateCard } from '@/domain/normalizeCost';
import { cacheEfficiency } from '@/domain/aggregate';
import { currentWindow, inWindow, type RangeKey } from '@/domain/dateRange';
import { sourceOfKey, type SourceKey } from '@/domain/sources';

/** The cacheEfficiency view-model: scoped cache vs fresh-input token volume + pico-USD saved by caching. */
export interface CacheEfficiencyModel {
  readonly from: string;
  readonly to: string;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly freshInputTokens: number;
  readonly savedPico: bigint;
}

function earliestDate(records: readonly UsageRecord[], fallback: string): string {
  let min: string | null = null;
  for (const r of records) if (min === null || r.date < min) min = r.date;
  return min ?? fallback;
}

/** Derive the cacheEfficiency view-model for a `(range, source)` scope (same scoping the oracle uses). */
export function selectCacheEfficiency(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): CacheEfficiencyModel {
  const wantSource = sourceOfKey(source);
  const scoped =
    wantSource === null ? snapshot.records : snapshot.records.filter((r) => r.source === wantSource);

  const current = currentWindow(range, snapshot.asOf, earliestDate(scoped, snapshot.asOf));
  const inCurrent = scoped.filter((r) => inWindow(r.date, current));

  const eff = cacheEfficiency(inCurrent, card);
  return {
    from: current.from,
    to: current.to,
    cacheReadTokens: eff.cacheReadTokens,
    cacheCreationTokens: eff.cacheCreationTokens,
    freshInputTokens: eff.freshInputTokens,
    savedPico: eff.savedPico,
  };
}
