import type { Source, UsageRecord } from './types';
import { normalizeCost, selectBand, type RateCard } from './normalizeCost';

/** Per-day rollup: normalized cost (pico-USD BigInt) + summed token counts. */
export interface DayTotal {
  readonly date: string;
  readonly costPico: bigint;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

type MutableDayTotal = {
  date: string;
  costPico: bigint;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

/** Roll records up by calendar day, ascending by date. */
export function aggregateByDay(records: readonly UsageRecord[], card: RateCard): DayTotal[] {
  const byDate = new Map<string, MutableDayTotal>();
  for (const r of records) {
    let acc = byDate.get(r.date);
    if (!acc) {
      acc = {
        date: r.date,
        costPico: 0n,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      };
      byDate.set(r.date, acc);
    }
    acc.costPico += normalizeCost(r, card);
    acc.inputTokens += r.inputTokens;
    acc.outputTokens += r.outputTokens;
    acc.cacheCreationTokens += r.cacheCreationTokens;
    acc.cacheReadTokens += r.cacheReadTokens;
    acc.reasoningTokens += r.reasoningTokens;
    acc.totalTokens +=
      r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Per (source, model) rollup. */
export interface SourceModelTotal {
  readonly source: Source;
  readonly model: string;
  readonly costPico: bigint;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

type MutableSMT = {
  source: Source;
  model: string;
  costPico: bigint;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

/** Roll records up by (source, model), most expensive first (tie-break source|model asc). */
export function aggregateBySourceModel(
  records: readonly UsageRecord[],
  card: RateCard,
): SourceModelTotal[] {
  const by = new Map<string, MutableSMT>();
  for (const r of records) {
    const key = `${r.source}|${r.model}`;
    let acc = by.get(key);
    if (!acc) {
      acc = {
        source: r.source,
        model: r.model,
        costPico: 0n,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      };
      by.set(key, acc);
    }
    acc.costPico += normalizeCost(r, card);
    acc.inputTokens += r.inputTokens;
    acc.outputTokens += r.outputTokens;
    acc.cacheCreationTokens += r.cacheCreationTokens;
    acc.cacheReadTokens += r.cacheReadTokens;
    acc.reasoningTokens += r.reasoningTokens;
    acc.totalTokens +=
      r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;
  }
  return [...by.values()].sort((a, b) => {
    if (a.costPico !== b.costPico) return a.costPico > b.costPico ? -1 : 1;
    const ka = `${a.source}|${a.model}`;
    const kb = `${b.source}|${b.model}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** Cache-efficiency summary: cache-read vs fresh-input volume + pico-USD saved by caching
 * (what cache-read tokens would have cost at the input rate, minus what they did cost). */
export interface CacheEfficiency {
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly freshInputTokens: number;
  readonly savedPico: bigint;
}

export function cacheEfficiency(
  records: readonly UsageRecord[],
  card: RateCard,
): CacheEfficiency {
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let freshInputTokens = 0;
  let savedPico = 0n;
  for (const r of records) {
    const b = selectBand(card, r.model, r.date);
    cacheReadTokens += r.cacheReadTokens;
    cacheCreationTokens += r.cacheCreationTokens;
    freshInputTokens += r.inputTokens;
    // What the cache-read tokens would have cost at the input rate, minus what they did cost.
    savedPico += BigInt(r.cacheReadTokens) * (BigInt(b.input) - BigInt(b.cacheRead));
  }
  return { cacheReadTokens, cacheCreationTokens, freshInputTokens, savedPico };
}
