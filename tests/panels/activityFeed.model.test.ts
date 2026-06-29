import { describe, it, expect } from 'vitest';
import { selectActivityFeed } from '@/panels/activity-feed/activityFeedModel';
import { type RateCard } from '@/domain/normalizeCost';
import { UNATTRIBUTED, RESERVED_PROJECTS, deriveRegistry } from '@/domain/projects';
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
  project: UNATTRIBUTED,
  model: 'm1',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('selectActivityFeed', () => {
  it('emits one item per scoped record keyed source|date|model|project with Σ pico cost + total', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      projects: RESERVED_PROJECTS,
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
      { key: `claude|2026-06-20|m1|${UNATTRIBUTED}`, costPico: 10_000_000n },
      { key: `codex|2026-06-21|m2|${UNATTRIBUTED}`, costPico: 300_000_000n },
    ]);
  });

  it('orders items most-recent first', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      projects: RESERVED_PROJECTS,
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
      projects: RESERVED_PROJECTS,
      records: [
        rec({ source: 'claude', date: '2026-06-20', model: 'm1', inputTokens: 10 }),
        rec({ source: 'codex', date: '2026-06-21', model: 'm2', inputTokens: 100 }),
      ],
    };
    const m = selectActivityFeed(snapshot, card, 'all', 'codex');
    expect(m.totalCostPico).toBe(300_000_000n);
    expect(m.totalTokens).toBe(100);
    expect(m.items.map((i) => i.key)).toEqual([`codex|2026-06-21|m2|${UNATTRIBUTED}`]);
  });

  it('keys by project too, so two same-(source,date,model) records in different projects do not collide', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      records: [
        rec({ source: 'claude', date: '2026-06-20', model: 'm1', project: '/r/alpha', inputTokens: 10 }), // 10e6
        rec({ source: 'claude', date: '2026-06-20', model: 'm1', project: '/r/beta', inputTokens: 20 }), // 20e6
      ],
      projects: deriveRegistry([
        { project: '/r/alpha' } as UsageRecord,
        { project: '/r/beta' } as UsageRecord,
      ]),
    };
    const m = selectActivityFeed(snapshot, card, 'all', 'all');
    expect(m.items.length).toBe(2);
    expect(m.items.map((i) => ({ key: i.key, costPico: i.costPico })).sort((a, b) => (a.key < b.key ? -1 : 1))).toEqual([
      { key: 'claude|2026-06-20|m1|/r/alpha', costPico: 10_000_000n },
      { key: 'claude|2026-06-20|m1|/r/beta', costPico: 20_000_000n },
    ]);
  });
});
