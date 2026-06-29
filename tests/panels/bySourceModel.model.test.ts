import { describe, it, expect } from 'vitest';
import { selectBySourceModel } from '@/panels/by-source-model/bySourceModelModel';
import { type RateCard } from '@/domain/normalizeCost';
import { UNATTRIBUTED, RESERVED_PROJECTS } from '@/domain/projects';
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

describe('selectBySourceModel', () => {
  it('groups scoped records by (source, model) with Σ pico cost + a matching total', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      projects: RESERVED_PROJECTS,
      records: [
        rec({ source: 'claude', model: 'm1', inputTokens: 10 }), // 10e6
        rec({ source: 'claude', model: 'm1', date: '2026-06-21', inputTokens: 1 }), // 1e6 → claude|m1 = 11e6
        rec({ source: 'codex', model: 'm2', inputTokens: 100 }), // 300e6
      ],
    };
    const m = selectBySourceModel(snapshot, card, 'all', 'all');
    expect(m.totalCostPico).toBe(311_000_000n);
    expect(m.rows.map((r) => ({ key: r.key, costPico: r.costPico }))).toEqual([
      { key: 'codex|m2', costPico: 300_000_000n },
      { key: 'claude|m1', costPico: 11_000_000n },
    ]);
  });

  it('sums every token kind into a scoped total-tokens count', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      projects: RESERVED_PROJECTS,
      records: [
        rec({
          source: 'claude',
          model: 'm1',
          inputTokens: 10,
          outputTokens: 2,
          cacheCreationTokens: 3,
          cacheReadTokens: 4,
          reasoningTokens: 1,
        }), // 20 tokens
        rec({ source: 'codex', model: 'm2', inputTokens: 100, outputTokens: 5 }), // 105 tokens
      ],
    };
    const m = selectBySourceModel(snapshot, card, 'all', 'all');
    expect(m.totalTokens).toBe(125);
  });

  it('applies the source filter', () => {
    const snapshot: Snapshot = {
      asOf: '2026-06-27',
      projects: RESERVED_PROJECTS,
      records: [
        rec({ source: 'claude', model: 'm1', inputTokens: 10 }),
        rec({ source: 'codex', model: 'm2', inputTokens: 100 }),
      ],
    };
    const m = selectBySourceModel(snapshot, card, 'all', 'claude');
    expect(m.totalCostPico).toBe(10_000_000n);
    expect(m.totalTokens).toBe(10);
    expect(m.rows.map((r) => ({ key: r.key, costPico: r.costPico }))).toEqual([
      { key: 'claude|m1', costPico: 10_000_000n },
    ]);
  });
});
