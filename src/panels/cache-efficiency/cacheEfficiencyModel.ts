import type { Snapshot } from '@/domain/types';
import { type RateCard } from '@/domain/normalizeCost';
import { cacheEfficiency } from '@/domain/aggregate';
import { type RangeKey } from '@/domain/dateRange';
import { type SourceKey } from '@/domain/sources';
import { scopeRecords } from '@/domain/scopeRecords';

/** The cacheEfficiency view-model: scoped cache vs fresh-input token volume + pico-USD saved by caching. */
export interface CacheEfficiencyModel {
  readonly from: string;
  readonly to: string;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly freshInputTokens: number;
  readonly savedPico: bigint;
}

/** Derive the cacheEfficiency view-model for a `(range, source)` scope (shared `scopeRecords` scoping). */
export function selectCacheEfficiency(
  snapshot: Snapshot,
  card: RateCard,
  range: RangeKey,
  source: SourceKey,
): CacheEfficiencyModel {
  const { records: inCurrent, window } = scopeRecords(snapshot.records, snapshot.asOf, range, source);

  const eff = cacheEfficiency(inCurrent, card);
  return {
    from: window.from,
    to: window.to,
    cacheReadTokens: eff.cacheReadTokens,
    cacheCreationTokens: eff.cacheCreationTokens,
    freshInputTokens: eff.freshInputTokens,
    savedPico: eff.savedPico,
  };
}
