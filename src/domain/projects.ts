import type { ProjectMeta, UsageRecord } from './types';

/**
 * Reserved non-repo project keys. They use `__…__` sentinels so a real git-toplevel path (which a
 * repo project key always is) can never collide with them.
 */
export const UNATTRIBUTED = '__unattributed__';
export const CODEX_PROJECT = '__codex__';
export const OPENCLAW_PROJECT = '__openclaw__';

/** The registry entries for the reserved keys, merged into every `Snapshot.projects`. */
export const RESERVED_PROJECTS: Readonly<Record<string, ProjectMeta>> = {
  [UNATTRIBUTED]: { kind: 'unattributed', label: 'Unattributed' },
  [CODEX_PROJECT]: { kind: 'tool', label: 'Codex' },
  [OPENCLAW_PROJECT]: { kind: 'tool', label: 'OpenClaw' },
};

/** The {@link ProjectMeta} for one project key: a reserved sentinel's fixed entry, else a `repo`
 * keyed by its git-toplevel path with the basename as its display label. */
export function metaForKey(key: string): ProjectMeta {
  const reserved = RESERVED_PROJECTS[key];
  if (reserved) return reserved;
  const slash = key.lastIndexOf('/');
  return { kind: 'repo', label: slash >= 0 ? key.slice(slash + 1) : key };
}

/**
 * Build the `Snapshot.projects` registry from the records' distinct project keys. `overrides` lets the
 * ingest supply alias labels (a friendly name overriding the basename) for specific repo keys.
 */
export function deriveRegistry(
  records: readonly UsageRecord[],
  overrides: Readonly<Record<string, ProjectMeta>> = {},
): Record<string, ProjectMeta> {
  const registry: Record<string, ProjectMeta> = {};
  for (const r of records) {
    if (!(r.project in registry)) registry[r.project] = overrides[r.project] ?? metaForKey(r.project);
  }
  return registry;
}
