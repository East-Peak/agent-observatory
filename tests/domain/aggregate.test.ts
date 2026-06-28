import { describe, it, expect } from 'vitest';
import { aggregateByDay } from '@/domain/aggregate';
import { type RateCard } from '@/domain/normalizeCost';
import type { UsageRecord } from '@/domain/types';

const card: RateCard = {
  version: 'test',
  asOf: '2026-06-27',
  unit: 'picoUsdPerToken',
  rates: {
    m1: [
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        input: '1000000',
        output: '2000000',
        cacheCreation: '500000',
        cacheRead: '100000',
        reasoning: '2000000',
      },
    ],
  },
};

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'claude',
  date: '2026-06-01',
  model: 'm1',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('aggregateByDay', () => {
  it('groups by date (ascending), summing normalized cost (pico BigInt) and tokens', () => {
    const records = [
      rec({ date: '2026-06-02', inputTokens: 1 }), // out of order on purpose; cost 1e6
      rec({ date: '2026-06-01', inputTokens: 10 }), // cost 10e6
      rec({ date: '2026-06-01', outputTokens: 5, cacheReadTokens: 100 }), // 10e6 + 10e6 = 20e6
    ];

    expect(aggregateByDay(records, card)).toEqual([
      {
        date: '2026-06-01',
        costPico: 30_000_000n,
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 100,
        reasoningTokens: 0,
        totalTokens: 115,
      },
      {
        date: '2026-06-02',
        costPico: 1_000_000n,
        inputTokens: 1,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 1,
      },
    ]);
  });
});
