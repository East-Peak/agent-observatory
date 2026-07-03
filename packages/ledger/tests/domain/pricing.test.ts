import { describe, it, expect } from 'vitest';
import { RateCardError, type BillableUsage, type RateCard } from '../../../pricing/src/index.js';
import { pricerFromRateCard } from '../../src/domain/pricing.js';

const card: RateCard = {
  version: 'ledger-test-card',
  asOf: '2026-07-03',
  unit: 'picoUsdPerToken',
  rates: {
    model_a: [
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        input: '3',
        output: '30',
        cacheCreation: '4',
        cacheRead: '5',
        reasoning: '30',
      },
    ],
  },
};

const billable: BillableUsage = {
  source: 'claude',
  date: '2026-07-03',
  model: 'model_a',
  usage: { input: 2, output: 7, cacheCreation: 11, cacheRead: 13, reasoning: 17 },
};

describe('pricerFromRateCard', () => {
  it('prices ledger billable usage through the shared exact-money engine', () => {
    const price = pricerFromRateCard(card);
    expect(price(billable)).toBe(2n * 3n + 7n * 30n + 11n * 4n + 13n * 5n + 17n * 30n);
  });

  it('fails closed through RateCardError when a billable model is unpriced', () => {
    const price = pricerFromRateCard(card);
    expect(() => price({ ...billable, model: 'missing' })).toThrow(RateCardError);
  });
});
