import type { Snapshot } from '@/domain/types';
import type { DataSource } from './DataSource';
import { createFixturesDataSource, baseRateCard } from './FixturesDataSource';

/** Minimal shape guard for an externally-produced snapshot (the ingested JSON could be hand-edited,
 * stale, or a leftover v1 artifact). Ingest already validates before writing; this just keeps a
 * malformed artifact from reaching the renderer — it falls back to fixtures instead. Requires the v2
 * project schema (a `projects` registry + a non-empty `project` on every record), so a stale v1-format
 * snapshot is rejected rather than rendered with undefined attribution. */
function isSnapshotShape(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.asOf !== 'string' || !Array.isArray(v.records)) return false;
  if (typeof v.projects !== 'object' || v.projects === null) return false;
  const projects = v.projects as Record<string, unknown>;
  // Every record's project must be a non-empty key that EXISTS in the registry — a registry the
  // renderer reads `projects[key].kind/label` from. A record pointing at an unregistered project would
  // render undefined, so reject the whole artifact and fall back.
  return v.records.every((r) => {
    const project = (r as { project?: unknown }).project;
    return typeof project === 'string' && project.length > 0 && project in projects;
  });
}

/**
 * Choose the production data source from the (optionally absent) ingested real snapshot. When
 * `data/snapshot.json` has been produced by `scripts/ingest.mjs`, serve it priced by the frozen
 * base rate card; otherwise (fresh clone / pre-ingest / a malformed artifact) fall back to the
 * committed synthetic fixtures so the app always renders. Pure decision — unit-tested. The
 * fallback delegates to `createFixturesDataSource` rather than importing the synthetic JSON,
 * keeping that import on the single seam `import-boundary` allows (`FixturesDataSource.ts`).
 */
export function selectDataSource(realSnapshot: unknown): DataSource {
  if (!isSnapshotShape(realSnapshot)) return createFixturesDataSource();
  return {
    getSnapshot: () => realSnapshot,
    getRateCard: () => baseRateCard(),
  };
}
