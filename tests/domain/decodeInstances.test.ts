import { describe, it, expect } from 'vitest';
import { decodeClaudeInstances, CcusageDecodeError } from '@/domain/decode';
import { resolveProject } from '@/domain/projectIdentity';
import { UNATTRIBUTED } from '@/domain/projects';
import instancesEnv from '../../data/fixtures/decoder/claude-instances.json';

// The roots the synthetic fixture's encoded dirs forward-match against (yard-ops-src is NESTED under
// yard-ops; Downloads/scratch is under no root -> __unattributed__).
const knownRoots = ['/Users/dev/projects/yard-ops', '/Users/dev/projects/marin-civic-graph'];
const resolveFn = (encodedDir: string): string => resolveProject(encodedDir, { knownRoots }).key;

describe('decodeClaudeInstances', () => {
  it('emits one canonical record per (resolved project, day, model), MERGING nested cwds into their repo', () => {
    expect(decodeClaudeInstances(instancesEnv, resolveFn)).toEqual([
      {
        source: 'claude',
        date: '2026-06-01',
        project: '/Users/dev/projects/marin-civic-graph',
        model: 'claude-sonnet-4-6',
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
        reasoningTokens: 0,
      },
      {
        // yard-ops (10/20) + nested yard-ops/src (100/200) on the same day+model -> one merged record.
        source: 'claude',
        date: '2026-06-01',
        project: '/Users/dev/projects/yard-ops',
        model: 'claude-opus-4-8',
        inputTokens: 110,
        outputTokens: 220,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
      {
        source: 'claude',
        date: '2026-06-02',
        project: '/Users/dev/projects/yard-ops',
        model: 'claude-opus-4-8',
        inputTokens: 5,
        outputTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
      {
        source: 'claude',
        date: '2026-06-02',
        project: UNATTRIBUTED,
        model: 'claude-opus-4-8',
        inputTokens: 7,
        outputTokens: 8,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
    ]);
  });

  it('produces records unique by (date, project, model) — the merge prevents duplicate identities', () => {
    const recs = decodeClaudeInstances(instancesEnv, resolveFn);
    const keys = recs.map((r) => `${r.date}|${r.project}|${r.model}`);
    expect(new Set(keys).size).toBe(keys.length);
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
