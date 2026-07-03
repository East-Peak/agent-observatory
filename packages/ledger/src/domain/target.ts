import type { ProjectMap, Target } from './types.js';

/** True when `p` is `base` itself or lies under it at a segment boundary (so `/a` never matches `/ab`). */
function isUnder(p: string, base: string): boolean {
  return p === base || p.startsWith(base.endsWith('/') ? base : `${base}/`);
}

/**
 * Map an absolute path to its allocation target — the cost-accounting taxonomy. Order matters: a
 * project-specific workspace doc is DIRECT project cost (checked before the generic workspace = meta),
 * then the longest-matching git root (segment-boundary), then scratch, then overhead. Never returns
 * `unattributed` — that is the classifier's verdict for a turn with no path evidence at all.
 */
export function resolveTarget(path: string, map: ProjectMap): Target {
  const wsProjects = `${map.workspaceRoot}/projects`;
  if (isUnder(path, wsProjects)) {
    const name = path
      .slice(wsProjects.length + 1)
      .split('/')[0]
      ?.replace(/\.md$/, '');
    if (name) return { kind: 'direct', key: name };
  }
  if (isUnder(path, map.workspaceRoot)) return { kind: 'meta', key: 'workspace' };

  // Longest matching root wins (a nested root beats its enclosing one).
  const root = map.projectRoots.filter((r) => isUnder(path, r)).sort((a, b) => b.length - a.length)[0];
  if (root) return { kind: 'repo', key: root };

  if (isUnder(path, '/tmp') || isUnder(path, '/private/tmp')) return { kind: 'scratch', key: 'scratch' };
  return { kind: 'overhead', key: 'other' };
}
