import { describe, it, expect } from 'vitest';
import { metaForKey, deriveRegistry, UNATTRIBUTED, CODEX_PROJECT, OPENCLAW_PROJECT } from '@/domain/projects';
import type { UsageRecord } from '@/domain/types';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'claude',
  date: '2026-06-01',
  project: UNATTRIBUTED,
  model: 'claude-opus-4-8',
  inputTokens: 1,
  outputTokens: 1,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('metaForKey', () => {
  it('labels a repo key (git-toplevel path) by its basename', () => {
    expect(metaForKey('/Users/tammypais/projects/yard-ops')).toEqual({ kind: 'repo', label: 'yard-ops' });
  });

  it('resolves the reserved sentinels to their fixed kind + label', () => {
    expect(metaForKey(UNATTRIBUTED)).toEqual({ kind: 'unattributed', label: 'Unattributed' });
    expect(metaForKey(CODEX_PROJECT)).toEqual({ kind: 'tool', label: 'Codex' });
    expect(metaForKey(OPENCLAW_PROJECT)).toEqual({ kind: 'tool', label: 'OpenClaw' });
  });
});

describe('deriveRegistry', () => {
  it('builds one registry entry per distinct project key across the records', () => {
    const reg = deriveRegistry([
      rec({ project: '/r/yard-ops' }),
      rec({ project: '/r/yard-ops' }),
      rec({ project: CODEX_PROJECT, source: 'codex' }),
    ]);
    expect(reg).toEqual({
      '/r/yard-ops': { kind: 'repo', label: 'yard-ops' },
      [CODEX_PROJECT]: { kind: 'tool', label: 'Codex' },
    });
  });

  it('honours an alias label override for a repo key', () => {
    const reg = deriveRegistry([rec({ project: '/r/ftt' })], { '/r/ftt': { kind: 'repo', label: 'family-tree-toolkit' } });
    expect(reg['/r/ftt']).toEqual({ kind: 'repo', label: 'family-tree-toolkit' });
  });
});
