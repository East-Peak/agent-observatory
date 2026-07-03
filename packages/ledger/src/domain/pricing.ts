import { normalizeCost, type RateCard } from '../../../pricing/src/index.js';
import type { Pricer } from './types.js';

export function pricerFromRateCard(card: RateCard): Pricer {
  return (usage) => normalizeCost(usage, card);
}
