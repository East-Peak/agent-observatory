import { describe, expect, it } from 'vitest';
import {
  buildLedgerProjectMap,
  opaqueProjectKeyFromName,
  validateLedgerProjectMap,
} from '../../src/domain/projectMap.js';

describe('project-map construction', () => {
  it('maps repo roots, workspace project docs, and accounting buckets to opaque project keys', () => {
    const map = buildLedgerProjectMap({
      workspaceRoot: '/Users/example/.openclaw/workspace',
      repoRoots: ['/Users/example/projects/example-families', '/Users/example/projects/example-observatory'],
      workspaceProjectNames: ['example-observatory', 'example-civic-graph'],
      version: 'map-test',
    });

    expect(map).toEqual({
      version: 'map-test',
      workspaceRoot: '/Users/example/.openclaw/workspace',
      targets: [
        {
          kind: 'repo',
          key: '/Users/example/projects/example-families',
          projectKey: opaqueProjectKeyFromName('example-families'),
        },
        {
          kind: 'repo',
          key: '/Users/example/projects/example-observatory',
          projectKey: opaqueProjectKeyFromName('example-observatory'),
        },
        {
          kind: 'direct',
          key: 'example-civic-graph',
          projectKey: opaqueProjectKeyFromName('example-civic-graph'),
        },
        {
          kind: 'direct',
          key: 'example-observatory',
          projectKey: opaqueProjectKeyFromName('example-observatory'),
        },
        { kind: 'meta', key: 'workspace', projectKey: 'workspace_meta' },
        { kind: 'scratch', key: 'scratch', projectKey: 'scratch' },
        { kind: 'overhead', key: 'other', projectKey: 'overhead_other' },
        { kind: 'unattributed', key: 'unattributed', projectKey: 'unattributed' },
      ],
    });
  });

  it('deduplicates targets without merging different target kinds', () => {
    const map = buildLedgerProjectMap({
      workspaceRoot: '/w',
      repoRoots: ['/p/a', '/p/a'],
      workspaceProjectNames: ['a', 'a'],
    });

    expect(map.targets.filter((target) => target.kind === 'repo')).toEqual([
      { kind: 'repo', key: '/p/a', projectKey: opaqueProjectKeyFromName('a') },
    ]);
    expect(map.targets.filter((target) => target.projectKey === opaqueProjectKeyFromName('a'))).toEqual([
      { kind: 'repo', key: '/p/a', projectKey: opaqueProjectKeyFromName('a') },
      { kind: 'direct', key: 'a', projectKey: opaqueProjectKeyFromName('a') },
    ]);
  });

  it('mints opaque stable keys rather than semantic project names', () => {
    expect(opaqueProjectKeyFromName('Forecast Tieout (OSS)')).toMatch(/^p_[a-f0-9]{16}$/);
    expect(opaqueProjectKeyFromName('Forecast Tieout (OSS)')).not.toContain('forecast');
    expect(opaqueProjectKeyFromName('---')).toMatch(/^p_[a-f0-9]{16}$/);
  });

  it('preserves exact existing target keys while adding missing targets', () => {
    const existing = buildLedgerProjectMap({
      workspaceRoot: '/w',
      repoRoots: ['/p/a'],
      workspaceProjectNames: ['a'],
    });
    const map = buildLedgerProjectMap({
      workspaceRoot: '/w',
      repoRoots: ['/p/a', '/p/b'],
      workspaceProjectNames: ['a', 'b'],
      existingMap: {
        ...existing,
        targets: existing.targets.map((target) =>
          target.kind === 'repo' && target.key === '/p/a'
            ? { ...target, projectKey: 'existing_opaque_key' }
            : target,
        ),
      },
    });

    expect(map.targets).toContainEqual({ kind: 'repo', key: '/p/a', projectKey: 'existing_opaque_key' });
    expect(map.targets.find((target) => target.kind === 'repo' && target.key === '/p/b')?.projectKey).toMatch(
      /^p_[a-f0-9]{16}$/,
    );
  });

  it('validates required buckets and target shape before launchd uses a map', () => {
    const map = buildLedgerProjectMap({ workspaceRoot: '/w', repoRoots: ['/p/a'] });
    expect(validateLedgerProjectMap(map)).toEqual([]);
    expect(
      validateLedgerProjectMap({
        ...map,
        targets: map.targets.filter((target) => target.kind !== 'unattributed'),
      }),
    ).toContain('missing required target: unattributed:unattributed');
  });
});
