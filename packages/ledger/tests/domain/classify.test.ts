import { describe, it, expect } from 'vitest';
import { classifyTurn } from '../../src/domain/classify.js';
import type { AgentTurn, ProjectMap } from '../../src/domain/types.js';

const map: ProjectMap = { projectRoots: ['/p/marin-families'], workspaceRoot: '/ws' };
const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  sessionId: 's',
  index: 0,
  cwd: null,
  usage: null,
  files: [],
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

  it('falls back to the per-turn cwd when there is no file evidence (the 100%-coverage signal)', () => {
    const a = classifyTurn(turn({ cwd: '/p/marin-families' }), map);
    expect(a).toMatchObject({ evidence: 'cwd', confidence: 'contextual', target: { kind: 'repo' } });
  });

  it('is unattributed only when there is no evidence at all', () => {
    const a = classifyTurn(turn({ cwd: null }), map);
    expect(a).toMatchObject({ evidence: 'none', confidence: 'none', target: { kind: 'unattributed' } });
  });
});
