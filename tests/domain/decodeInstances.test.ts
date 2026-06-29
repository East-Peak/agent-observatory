import { describe, it, expect } from 'vitest';
import { decodeClaudeInstances, decodeClaudeDaily, CcusageDecodeError } from '@/domain/decode';
import { reconcileInstancesDaily } from '@/domain/buildSnapshot';
import { resolveProject } from '@/domain/projectIdentity';
import { UNATTRIBUTED } from '@/domain/projects';
import instancesEnv from '../../data/fixtures/decoder/claude-instances.json';
import dailyEnv from '../../data/fixtures/decoder/claude-daily.json';

// The roots the synthetic fixture's encoded dirs forward-match against (yard-ops-src is NESTED under
// yard-ops; Downloads/scratch is under no root -> __unattributed__).
const knownRoots = ['/Users/dev/projects/yard-ops', '/Users/dev/projects/marin-civic-graph'];
const resolveFn = (encodedDir: string): string => resolveProject(encodedDir, { knownRoots }).key;

describe('decodeClaudeInstances', () => {
  it('emits one canonical record per (resolved project, day, model), MERGING nested cwds into their repo', () => {
    expect(decodeClaudeInstances(instancesEnv, resolveFn)).toEqual([
      {
        source: 'claude',
        date: '2026-05-27',
        project: '/Users/dev/projects/marin-civic-graph',
        model: 'claude-sonnet-4-6',
        inputTokens: 200,
        outputTokens: 1000,
        cacheCreationTokens: 20000,
        cacheReadTokens: 400000,
        reasoningTokens: 0,
      },
      {
        // yard-ops (600/3000/60000/1.2M) + nested yard-ops/src (200/1000/20000/400k), same day+model -> merged.
        source: 'claude',
        date: '2026-05-27',
        project: '/Users/dev/projects/yard-ops',
        model: 'claude-sonnet-4-6',
        inputTokens: 800,
        outputTokens: 4000,
        cacheCreationTokens: 80000,
        cacheReadTokens: 1600000,
        reasoningTokens: 0,
      },
      {
        source: 'claude',
        date: '2026-05-28',
        project: '/Users/dev/projects/yard-ops',
        model: 'claude-opus-4-7',
        inputTokens: 1500,
        outputTokens: 60000,
        cacheCreationTokens: 300000,
        cacheReadTokens: 4500000,
        reasoningTokens: 0,
      },
      {
        source: 'claude',
        date: '2026-05-28',
        project: '/Users/dev/projects/yard-ops',
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 20000,
        cacheCreationTokens: 300000,
        cacheReadTokens: 3000000,
        reasoningTokens: 0,
      },
      {
        source: 'claude',
        date: '2026-05-28',
        project: UNATTRIBUTED,
        model: 'claude-opus-4-7',
        inputTokens: 500,
        outputTokens: 20000,
        cacheCreationTokens: 100000,
        cacheReadTokens: 1500000,
        reasoningTokens: 0,
      },
    ]);
  });

  it('produces records unique by (date, project, model) — the merge prevents duplicate identities', () => {
    const recs = decodeClaudeInstances(instancesEnv, resolveFn);
    const keys = recs.map((r) => `${r.date}|${r.project}|${r.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the committed instances + daily fixtures reconcile (instances is daily decomposed by project)', () => {
    const instances = decodeClaudeInstances(instancesEnv, resolveFn);
    const daily = decodeClaudeDaily(dailyEnv);
    expect(reconcileInstancesDaily(instances, daily)).toEqual([]);
  });

  it('fails closed when the envelope is missing the projects map', () => {
    expect(() => decodeClaudeInstances({ totals: {} }, resolveFn)).toThrow(CcusageDecodeError);
    expect(() => decodeClaudeInstances(null, resolveFn)).toThrow(CcusageDecodeError);
  });

  it('fails closed when a model breakdown is missing a required token field', () => {
    const drifted = {
      projects: {
        '-Users-dev-projects-yard-ops': [
          {
            date: '2026-06-01',
            modelBreakdowns: [{ modelName: 'claude-opus-4-8', outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 }],
          },
        ],
      },
    };
    expect(() => decodeClaudeInstances(drifted, resolveFn)).toThrow(CcusageDecodeError);
  });
});
