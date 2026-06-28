import { describe, it, expect } from 'vitest';
import { normalizeCost, RateCardError, type RateCard } from '@/domain/normalizeCost';
import type { UsageRecord } from '@/domain/types';

// m1's price doubled on 2026-06-01 (a future price change appended as a new band).
const card: RateCard = {
  version: 'test',
  asOf: '2026-06-27',
  unit: 'picoUsdPerToken',
  rates: {
    m1: [
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-01',
        input: '1000000',
        output: '2000000',
        cacheCreation: '500000',
        cacheRead: '100000',
        reasoning: '2000000',
      },
      {
        effectiveFrom: '2026-06-01',
        effectiveTo: null,
        input: '2000000',
        output: '4000000',
        cacheCreation: '1000000',
        cacheRead: '200000',
        reasoning: '4000000',
      },
    ],
  },
};

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'codex',
  date: '2026-03-01',
  model: 'm1',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('normalizeCost', () => {
  it('prices each record at the band in effect on its date (point-in-time)', () => {
    const tokens = {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 2,
      cacheReadTokens: 100,
      reasoningTokens: 3,
    };
    // band 1 (May 15): 10·1e6 + 5·2e6 + 2·5e5 + 100·1e5 + 3·2e6 = 37e6
    expect(normalizeCost(rec({ ...tokens, date: '2026-05-15' }), card)).toBe(37_000_000n);
    // band 2 (Jun 15): rates doubled → 74e6. Same model, same tokens, later date.
    expect(normalizeCost(rec({ ...tokens, date: '2026-06-15' }), card)).toBe(74_000_000n);
  });

  it('treats effectiveTo as exclusive (the change date itself uses the NEW band)', () => {
    expect(normalizeCost(rec({ inputTokens: 10, date: '2026-05-31' }), card)).toBe(10_000_000n); // band 1
    expect(normalizeCost(rec({ inputTokens: 10, date: '2026-06-01' }), card)).toBe(20_000_000n); // band 2
  });

  it('stays exact on huge token counts that would overflow a JS number', () => {
    // 9e9 output tokens × 2e6 pico (band 1) = 1.8e16 pico — exceeds 2^53 (~9.007e15).
    expect(normalizeCost(rec({ outputTokens: 9_000_000_000, date: '2026-03-01' }), card)).toBe(
      18_000_000_000_000_000n,
    );
  });

  it('throws RateCardError for a model with no rate (fail closed)', () => {
    expect(() => normalizeCost(rec({ model: 'unpriced' }), card)).toThrow(RateCardError);
  });

  it('throws RateCardError when no band covers the record date', () => {
    expect(() => normalizeCost(rec({ inputTokens: 10, date: '2025-12-31' }), card)).toThrow(
      RateCardError,
    );
  });
});
