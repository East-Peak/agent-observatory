import { describe, it, expect } from 'vitest';
import { selectActivityFeed } from '@/panels/activity-feed/activityFeedModel';
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
    m1: [band({ input: '1000000' })],
    m2: [band({ input: '3000000' })],
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

describe('selectActivityFeed', () => {
  it('emits one item per scoped record keyed source|date|model with Σ pico cost + total', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      records: [
        rec({ source: 'claude', date: '2026-06-20', model: 'm1', inputTokens: 10, outputTokens: 5 }), // 10e6, 15 tokens
        rec({ source: 'codex', date: '2026-06-21', model: 'm2', inputTokens: 100 }), // 300e6, 100 tokens
      ],
    };
    const m = selectActivityFeed(snapshot, card, 'all', 'all');
    expect(m.totalCostPico).toBe(310_000_000n);
    expect(m.totalTokens).toBe(115);
    expect(m.items.length).toBe(2);
    expect(m.items.map((i) => ({ key: i.key, costPico: i.costPico })).sort((a, b) => (a.key < b.key ? -1 : 1))).toEqual([
      { key: 'claude|2026-06-20|m1', costPico: 10_000_000n },
      { key: 'codex|2026-06-21|m2', costPico: 300_000_000n },
    ]);
  });

  it('orders items most-recent first', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      records: [
        rec({ source: 'claude', date: '2026-06-20', model: 'm1', inputTokens: 10 }),
        rec({ source: 'codex', date: '2026-06-21', model: 'm2', inputTokens: 100 }),
      ],
    };
    const m = selectActivityFeed(snapshot, card, 'all', 'all');
    expect(m.items.map((i) => i.date)).toEqual(['2026-06-21', '2026-06-20']);
  });

  it('applies the source filter', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      records: [
        rec({ source: 'claude', date: '2026-06-20', model: 'm1', inputTokens: 10 }),
        rec({ source: 'codex', date: '2026-06-21', model: 'm2', inputTokens: 100 }),
      ],
    };
    const m = selectActivityFeed(snapshot, card, 'all', 'codex');
    expect(m.totalCostPico).toBe(300_000_000n);
    expect(m.totalTokens).toBe(100);
    expect(m.items.map((i) => i.key)).toEqual(['codex|2026-06-21|m2']);
  });
});
