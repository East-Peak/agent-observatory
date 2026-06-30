import { describe, it, expect } from 'vitest';
import { aggregateByProjectPeriod, aggregateByProject } from '@/domain/aggregate';
import { type RateCard } from '@/domain/normalizeCost';
import { UNATTRIBUTED, CODEX_PROJECT } from '@/domain/projects';
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

// m1: 1e6 pico per input token, so cost(pico) == inputTokens × 1_000_000.
const card: RateCard = {
  version: 'test',
  asOf: '2026-06-27',
  unit: 'picoUsdPerToken',
  rates: { m1: [band({ input: '1000000' })] },
};

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'claude',
  date: '2026-05-19',
  project: UNATTRIBUTED,
  model: 'm1',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('aggregateByProjectPeriod', () => {
  it('builds a DENSE rows × buckets grid (zeros materialized), summing in-window records per (project, bucket)', () => {
    const records = [
      rec({ project: '/r/yard-ops', date: '2026-05-19', inputTokens: 10 }), // week 05-18
      rec({ project: '/r/yard-ops', date: '2026-05-20', inputTokens: 5 }), //  week 05-18
      rec({ project: '/r/marin', date: '2026-05-25', inputTokens: 100 }), //   week 05-25
    ];
    const cells = aggregateByProjectPeriod(records, card, 'week', { from: '2026-05-19', to: '2026-05-25' }, [
      '/r/yard-ops',
      '/r/marin',
    ]);
    expect(cells).toEqual([
      { projectKey: '/r/yard-ops', bucketId: '2026-05-18', costPico: 15_000_000n, totalTokens: 15 },
      { projectKey: '/r/yard-ops', bucketId: '2026-05-25', costPico: 0n, totalTokens: 0 },
      { projectKey: '/r/marin', bucketId: '2026-05-18', costPico: 0n, totalTokens: 0 },
      { projectKey: '/r/marin', bucketId: '2026-05-25', costPico: 100_000_000n, totalTokens: 100 },
    ]);
  });

  it('ignores records outside the window and rows not requested', () => {
    const records = [
      rec({ project: '/r/yard-ops', date: '2026-05-19', inputTokens: 10 }),
      rec({ project: '/r/yard-ops', date: '2026-05-01', inputTokens: 999 }), // before window
      rec({ project: '/r/other', date: '2026-05-19', inputTokens: 999 }), // row not requested
    ];
    const cells = aggregateByProjectPeriod(records, card, 'day', { from: '2026-05-19', to: '2026-05-19' }, ['/r/yard-ops']);
    expect(cells).toEqual([
      { projectKey: '/r/yard-ops', bucketId: '2026-05-19', costPico: 10_000_000n, totalTokens: 10 },
    ]);
  });
});

describe('aggregateByProject', () => {
  it('totals the repo+unattributed grid (tools excluded), token share of the grid, repos desc then Unattributed last', () => {
    const records = [
      rec({ project: '/r/yard-ops', inputTokens: 100 }),
      rec({ project: '/r/marin', inputTokens: 300 }),
      rec({ project: UNATTRIBUTED, inputTokens: 100 }),
      rec({ source: 'codex', project: CODEX_PROJECT, inputTokens: 1000 }), // tool -> excluded from the grid
    ];
    // grid tokens = 100 + 300 + 100 = 500
    expect(aggregateByProject(records, card)).toEqual([
      { projectKey: '/r/marin', costPico: 300_000_000n, totalTokens: 300, tokenShareBp: 6000 },
      { projectKey: '/r/yard-ops', costPico: 100_000_000n, totalTokens: 100, tokenShareBp: 2000 },
      { projectKey: UNATTRIBUTED, costPico: 100_000_000n, totalTokens: 100, tokenShareBp: 2000 },
    ]);
  });

  it('returns an empty leaderboard when the grid is empty (tool-only scope)', () => {
    expect(aggregateByProject([rec({ source: 'codex', project: CODEX_PROJECT, inputTokens: 9 })], card)).toEqual([]);
  });

  it('returns an empty leaderboard when grid records exist but carry zero tokens (no denominator)', () => {
    // Shares are defined only when the grid has effort; an all-zero-token grid yields no rows.
    expect(aggregateByProject([rec({ project: '/r/yard-ops', inputTokens: 0 })], card)).toEqual([]);
  });
});
