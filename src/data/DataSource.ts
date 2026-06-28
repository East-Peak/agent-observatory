import type { Snapshot } from '@/domain/types';
import type { RateCard } from '@/domain/normalizeCost';

/**
 * The data seam the whole app reads through. A pure reader: it yields the canonical
 * {@link Snapshot} and the {@link RateCard} the domain layer normalizes against.
 *
 * Two interchangeable backends sit behind it: `FixturesDataSource` (default — the committed
 * byte-stable synthetic snapshot) and, in Phase 2, an ingest-produced `CcusageDataSource`.
 * Keeping the rate card on this seam is also the verifier's injection point: `pipeline-coupling`
 * swaps in a scaled card here (via the provider's `value` seam) without the panels knowing.
 */
export interface DataSource {
  getSnapshot(): Snapshot;
  getRateCard(): RateCard;
}
