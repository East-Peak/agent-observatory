import { describe, it, expect } from 'vitest';
import { normalizeCost, RateCardError, selectBand, type BillableUsage, type RateCard } from '../src/index.js';

const card: RateCard = {
  version: 'test-card',
  asOf: '2026-07-03',
  unit: 'picoUsdPerToken',
  rates: {
    model_a: [
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-01',
        input: '1',
        output: '10',
        cacheCreation: '2',
        cacheRead: '3',
        reasoning: '10',
      },
      {
        effectiveFrom: '2026-06-01',
        effectiveTo: null,
        input: '4',
        output: '40',
        cacheCreation: '5',
        cacheRead: '6',
        reasoning: '40',
      },
    ],
  },
};

const billable = (overrides: Partial<BillableUsage> = {}): BillableUsage => ({
  source: 'claude',
  date: '2026-07-03',
  model: 'model_a',
  usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
  ...overrides,
});

describe('selectBand', () => {
  it('selects the effective-dated band by [from, to) date boundaries', () => {
    expect(selectBand(card, 'model_a', '2026-05-31').input).toBe('1');
    expect(selectBand(card, 'model_a', '2026-06-01').input).toBe('4');
  });

  it('fails closed for unknown models or uncovered dates', () => {
    expect(() => selectBand(card, 'missing', '2026-07-03')).toThrow(RateCardError);
    expect(() => selectBand(card, 'model_a', '2025-12-31')).toThrow(RateCardError);
  });
});

describe('normalizeCost', () => {
  it('prices every token class in exact integer pico-USD', () => {
    const cost = normalizeCost(
      billable({
        usage: { input: 7, output: 11, cacheCreation: 13, cacheRead: 17, reasoning: 19 },
      }),
      card,
    );

    expect(cost).toBe(7n * 4n + 11n * 40n + 13n * 5n + 17n * 6n + 19n * 40n);
  });
});
