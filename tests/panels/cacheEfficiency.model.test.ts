import { describe, it, expect } from 'vitest';
import { selectCacheEfficiency } from '@/panels/cache-efficiency/cacheEfficiencyModel';
import { type RateCard } from '@/domain/normalizeCost';
import type { Snapshot, UsageRecord } from '@/domain/types';

const band = (over: Record<string, string>) => ({
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  input: '0',
  output: '0',
  cacheCreation: '0',
  cacheRead: '0',
  reasoning: '0',
  ...over,
});

const card: RateCard = {
  version: 'test',
  asOf: '2026-06-27',
  unit: 'picoUsdPerToken',
  rates: {
    m1: [band({ input: '1000000', cacheRead: '100000' })],
    m2: [band({ input: '3000000', cacheRead: '300000' })],
  },
};

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'claude',
  date: '2026-06-20',
  model: 'm1',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('selectCacheEfficiency', () => {
  it('sums scoped cache/fresh tokens and pico saved = Σ cacheRead × (inputRate − cacheReadRate)', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      records: [
        rec({ model: 'm1', cacheReadTokens: 1000 }), // 1000 × (1e6 − 1e5) = 900,000,000
        rec({ source: 'codex', model: 'm2', inputTokens: 50, cacheReadTokens: 2000 }), // 2000 × (3e6 − 3e5) = 5,400,000,000
      ],
    };
    const m = selectCacheEfficiency(snapshot, card, 'all', 'all');
    expect(m.cacheReadTokens).toBe(3000);
    expect(m.cacheCreationTokens).toBe(0);
    expect(m.freshInputTokens).toBe(50);
    expect(m.savedPico).toBe(6_300_000_000n);
  });

  it('applies the source filter', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      records: [
        rec({ model: 'm1', cacheReadTokens: 1000 }),
        rec({ source: 'codex', model: 'm2', inputTokens: 50, cacheReadTokens: 2000 }),
      ],
    };
    const m = selectCacheEfficiency(snapshot, card, 'all', 'claude');
    expect(m.cacheReadTokens).toBe(1000);
    expect(m.freshInputTokens).toBe(0);
    expect(m.savedPico).toBe(900_000_000n);
  });
});
