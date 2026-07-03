import { describe, it, expect } from 'vitest';
import { classifyTurn, classifyTurnAllocations } from '../../src/domain/classify.js';
import type { AgentTurn, ProjectMap } from '../../src/domain/types.js';

const map: ProjectMap = { projectRoots: ['/p/marin-families', '/p/other'], workspaceRoot: '/ws' };
const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  sessionId: 's',
  index: 0,
  source: 'claude',
  date: '2026-07-03',
  model: 'claude-opus-4-8',
  cwd: null,
  usage: null,
  files: [],
  commands: [],
  ...over,
});

describe('classifyTurn — the evidence hierarchy', () => {
  it('a file mutation is strong evidence and wins over cwd', () => {
    const a = classifyTurn(
      turn({ cwd: '/p/other', files: [{ path: '/p/marin-families/x.ts', kind: 'mutate' }] }),
      map,
    );
    expect(a).toMatchObject({
      evidence: 'file-mutate',
      confidence: 'strong',
      target: { kind: 'repo', key: '/p/marin-families' },
    });
  });

  it('a mutation overrides a conflicting cwd (edited B while cd-ed in A)', () => {
    // cd-ed in the repo, but the actual edit landed in the workspace → the edit wins.
    const a = classifyTurn(
      turn({ cwd: '/p/marin-families', files: [{ path: '/ws/log/x.md', kind: 'mutate' }] }),
      map,
    );
    expect(a.target.kind).toBe('meta');
  });

  it('falls back to a read (lower confidence) when there is no mutation', () => {
    const a = classifyTurn(turn({ files: [{ path: '/p/marin-families/x.ts', kind: 'read' }] }), map);
    expect(a).toMatchObject({ evidence: 'file-read', confidence: 'contextual', target: { kind: 'repo' } });
  });

  it('uses explicit Bash command targets as strong evidence and wins over cwd', () => {
    const a = classifyTurn(turn({ cwd: '/p/other', commands: ['git -C /p/marin-families status'] }), map);
    expect(a).toMatchObject({
      evidence: 'bash-target',
      confidence: 'strong',
      target: { kind: 'repo', key: '/p/marin-families' },
    });
  });

  it('resolves relative Bash path targets from the turn cwd', () => {
    const a = classifyTurn(
      turn({ cwd: '/p/marin-families/src', commands: ['npm --prefix ../packages/ledger test'] }),
      map,
    );
    expect(a).toMatchObject({
      evidence: 'bash-target',
      confidence: 'strong',
      target: { kind: 'repo', key: '/p/marin-families' },
    });
  });

  it('splits conflicting strong evidence instead of picking one dominant target', () => {
    const allocations = classifyTurnAllocations(
      turn({
        cwd: '/ws',
        files: [{ path: '/p/marin-families/app.ts', kind: 'mutate' }],
        commands: ['git -C /p/other status'],
      }),
      map,
    );

    expect(allocations).toEqual([
      {
        target: { kind: 'repo', key: '/p/marin-families' },
        evidence: 'file-mutate',
        confidence: 'strong',
        weight: 1,
      },
      {
        target: { kind: 'repo', key: '/p/other' },
        evidence: 'bash-target',
        confidence: 'strong',
        weight: 1,
      },
    ]);
  });

  it('falls back to the per-turn cwd when there is no file evidence (the 100%-coverage signal)', () => {
    const a = classifyTurn(turn({ cwd: '/p/marin-families' }), map);
    expect(a).toMatchObject({ evidence: 'cwd', confidence: 'contextual', target: { kind: 'repo' } });
  });

  it('is unattributed only when there is no evidence at all', () => {
    const a = classifyTurn(turn({ cwd: null }), map);
    expect(a).toMatchObject({ evidence: 'none', confidence: 'none', target: { kind: 'unattributed' } });
  });
});
