import type { Snapshot } from '@/domain/types';
import type { DataSource } from './DataSource';
import { createFixturesDataSource, baseRateCard } from './FixturesDataSource';

/** Minimal shape guard for an externally-produced snapshot (the ingested JSON could be hand-edited
 * or stale). Ingest already validates before writing; this just keeps a malformed artifact from
 * reaching the renderer — it falls back to fixtures instead. */
function isSnapshotShape(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.asOf === 'string' && Array.isArray(v.records);
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
