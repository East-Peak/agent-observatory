import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../../src/domain/target.js';
import type { ProjectMap } from '../../src/domain/types.js';

const map: ProjectMap = {
  projectRoots: ['/Users/stu/projects/marin-families', '/Users/stu/projects/agent-ledger'],
  workspaceRoot: '/Users/stu/.openclaw/workspace',
};

describe('resolveTarget', () => {
  it('maps a file under a project root to a repo target keyed by the root path', () => {
    expect(resolveTarget('/Users/stu/projects/marin-families/app/x.ts', map)).toEqual({
      kind: 'repo',
      key: '/Users/stu/projects/marin-families',
    });
  });

  it('matches on a segment boundary — a sibling prefix does NOT match', () => {
    // marin-families-extra must not resolve to the marin-families repo
    expect(resolveTarget('/Users/stu/projects/marin-families-extra/x.ts', map).kind).toBe('overhead');
  });

  it('maps a workspace project doc to DIRECT project cost, keyed by project name', () => {
    expect(resolveTarget('/Users/stu/.openclaw/workspace/projects/inkling.md', map)).toEqual({
      kind: 'direct',
      key: 'inkling',
    });
  });

  it('maps other workspace paths to meta', () => {
    expect(resolveTarget('/Users/stu/.openclaw/workspace/log/2026-07.md', map)).toEqual({
      kind: 'meta',
      key: 'workspace',
    });
  });

  it('maps tmp to scratch and an unknown path to overhead', () => {
    expect(resolveTarget('/private/tmp/notes.md', map).kind).toBe('scratch');
    expect(resolveTarget('/Users/stu/Downloads/x', map).kind).toBe('overhead');
  });
});
