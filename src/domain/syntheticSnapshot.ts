import type { Source, Snapshot, UsageRecord } from './types';

const ASOF = '2026-06-27';
const DAYS = 40; // ≥30 distinct days

/** (source, models) — every model exists in rateCard.json. OpenClaw rides Claude models. */
const SOURCE_MODELS: ReadonlyArray<readonly [Source, readonly string[]]> = [
  ['claude', ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-fable-5']],
  ['codex', ['gpt-5.5', 'gpt-5.4']],
  ['openclaw', ['claude-sonnet-4-6']],
];

/** mulberry32 — tiny seeded PRNG; deterministic, no Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** asOf minus n days, UTC (argful Date is deterministic; never reads wall-clock). */
function isoMinusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function generateSnapshot(): Snapshot {
  const rng = mulberry32(20260627);
  const records: UsageRecord[] = [];

  for (let i = 0; i < DAYS; i++) {
    const date = isoMinusDays(ASOF, DAYS - 1 - i); // ascending dates ending at asOf
    for (const [source, models] of SOURCE_MODELS) {
      for (let m = 0; m < models.length; m++) {
        const model = models[m]!;
        // claude/opus-4-8 (the first cell) appears every day → guarantees ≥DAYS days +
        // a stable baseline; other cells are sampled, creating asymmetric filter outputs.
        const alwaysOn = source === 'claude' && m === 0;
        if (!alwaysOn && rng() < 0.5) continue;
        records.push({
          source,
          date,
          model,
          inputTokens: 50 + Math.floor(rng() * 4000),
          outputTokens: 200 + Math.floor(rng() * 30000),
          cacheCreationTokens: Math.floor(rng() * 600000),
          cacheReadTokens: Math.floor(rng() * 12000000),
          reasoningTokens: source === 'codex' ? Math.floor(rng() * 40000) : 0,
        });
      }
    }
  }

  return { asOf: ASOF, records };
}
