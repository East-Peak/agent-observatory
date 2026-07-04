import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../../src/domain/target.js';
import type { ProjectMap } from '../../src/domain/types.js';

const map: ProjectMap = {
  projectRoots: ['/Users/example/projects/alpha-app', '/Users/example/projects/beta-tool'],
  workspaceRoot: '/Users/example/.config/agent-observatory/workspace',
};

describe('resolveTarget', () => {
  it('maps a file under a project root to a repo target keyed by the root path', () => {
    expect(resolveTarget('/Users/example/projects/alpha-app/app/x.ts', map)).toEqual({
      kind: 'repo',
      key: '/Users/example/projects/alpha-app',
    });
  });

  it('matches on a segment boundary — a sibling prefix does NOT match', () => {
    expect(resolveTarget('/Users/example/projects/alpha-app-extra/x.ts', map).kind).toBe('overhead');
  });

  it('maps a workspace project doc to DIRECT project cost, keyed by project name', () => {
    expect(
      resolveTarget('/Users/example/.config/agent-observatory/workspace/projects/research.md', map),
    ).toEqual({
      kind: 'direct',
      key: 'research',
    });
    expect(
      resolveTarget(
        '/Users/example/.config/agent-observatory/workspace/projects/planning-lane/timeline.md',
        map,
      ),
    ).toEqual({
      kind: 'direct',
      key: 'planning-lane',
    });
    expect(
      resolveTarget('/Users/example/.config/agent-observatory/workspace/projects/call-transcript.txt', map),
    ).toEqual({
      kind: 'meta',
      key: 'workspace',
    });
  });

  it('maps other workspace paths to meta', () => {
    expect(resolveTarget('/Users/example/.config/agent-observatory/workspace/log/2026-07.md', map)).toEqual({
      kind: 'meta',
      key: 'workspace',
    });
  });

  it('maps tmp to scratch and an unknown path to overhead', () => {
    expect(resolveTarget('/private/tmp/notes.md', map).kind).toBe('scratch');
    expect(resolveTarget('/Users/example/Downloads/x', map).kind).toBe('overhead');
  });
});
