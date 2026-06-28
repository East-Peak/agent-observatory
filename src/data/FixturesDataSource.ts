import type { Snapshot } from '@/domain/types';
import type { RateCard } from '@/domain/normalizeCost';
import type { DataSource } from './DataSource';
import snapshotJson from '../../data/fixtures/synthetic-snapshot.json';
import rateCardJson from '../../rateCard.json';

// The committed fixtures are our own canonical, schema-checked data (the `data-richness`,
// `byte-stability`, and `money-encoding` gates police them), so a direct typed view is safe
// here — the runtime ccusage decoders (Phase 2) live on the real-data path, not this one.
const SNAPSHOT = snapshotJson as unknown as Snapshot;
const BASE_RATE_CARD = rateCardJson as unknown as RateCard;

/** The default rate card (frozen `rateCard.json`), exposed for the verifier's scaling seam. */
export function baseRateCard(): RateCard {
  return BASE_RATE_CARD;
}

/**
 * The default backend: reads the committed synthetic snapshot + frozen rate card. An optional
 * `rateCard` override is the verifier-owned injection seam `pipeline-coupling` uses to render
 * with a scaled card while leaving the snapshot untouched.
 */
export function createFixturesDataSource(overrides?: { readonly rateCard?: RateCard }): DataSource {
  const rateCard = overrides?.rateCard ?? BASE_RATE_CARD;
  return {
    getSnapshot: () => SNAPSHOT,
    getRateCard: () => rateCard,
  };
}

/** The app default instance (no overrides). */
export const fixturesDataSource: DataSource = createFixturesDataSource();
