import { describe, it, expect } from 'vitest';
import { aggregateBySourceModel, cacheEfficiency } from '@/domain/aggregate';
import { type RateCard } from '@/domain/normalizeCost';
import { UNATTRIBUTED } from '@/domain/projects';
import type { UsageRecord } from '@/domain/types';

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
    m1: [band({ input: '1000000', output: '2000000', cacheRead: '100000' })],
    m2: [band({ input: '3000000', output: '4000000', cacheRead: '300000' })],
  },
};

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'claude',
  date: '2026-06-01',
  project: UNATTRIBUTED,
  model: 'm1',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('aggregateBySourceModel', () => {
  it('groups by (source, model), sums cost + tokens, most expensive first', () => {
    const records = [
      rec({ source: 'claude', model: 'm1', date: '2026-06-01', inputTokens: 10, outputTokens: 5 }), // 10·1e6 + 5·2e6 = 20e6
      rec({ source: 'claude', model: 'm1', date: '2026-06-02', inputTokens: 1 }), //  1e6 → group m1 = 21e6
      rec({ source: 'codex', model: 'm2', date: '2026-06-01', inputTokens: 100 }), // 100·3e6 = 300e6
    ];
    expect(aggregateBySourceModel(records, card)).toEqual([
      {
        source: 'codex',
        model: 'm2',
        costPico: 300_000_000n,
        inputTokens: 100,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 100,
      },
      {
        source: 'claude',
        model: 'm1',
        costPico: 21_000_000n,
        inputTokens: 11,
        outputTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 16,
      },
    ]);
  });
});

describe('cacheEfficiency', () => {
  it('sums cache-read/fresh-input volume and pico saved = Σ cacheRead × (inputRate − cacheReadRate)', () => {
    const records = [
      rec({ model: 'm1', cacheReadTokens: 1000 }), // 1000 × (1e6 − 1e5) = 900,000,000
      rec({ source: 'codex', model: 'm2', inputTokens: 50, cacheReadTokens: 2000 }), // 2000 × (3e6 − 3e5) = 5,400,000,000
    ];
    expect(cacheEfficiency(records, card)).toEqual({
      cacheReadTokens: 3000,
      cacheCreationTokens: 0,
      freshInputTokens: 50,
      savedPico: 6_300_000_000n,
    });
  });
});
