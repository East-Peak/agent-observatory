import { describe, it, expect } from 'vitest';
import { normalizeCost, type RateCard } from '@/domain/normalizeCost';
import type { UsageRecord } from '@/domain/types';
import rateCardJson from '../../rateCard.json';
import inputJson from '../../data/fixtures/normalization-input.json';
import expectedJson from '../../data/fixtures/expected-normalized.json';

const card = rateCardJson as unknown as RateCard;
const records = inputJson.records as unknown as UsageRecord[];

describe('normalization golden (real rateCard.json vs hand-derived expected)', () => {
  it('normalizeCost reproduces the frozen expected pico cost for every input row', () => {
    const expected = new Map(expectedJson.rows.map((r) => [`${r.model}|${r.date}`, BigInt(r.costPico)]));
    let total = 0n;
    for (const record of records) {
      const want = expected.get(`${record.model}|${record.date}`);
      expect(want, `expected row for ${record.model} @ ${record.date}`).toBeDefined();
      const cost = normalizeCost(record, card);
      expect(cost).toBe(want);
      total += cost;
    }
    expect(total).toBe(BigInt(expectedJson.totalPico));
    expect(records).toHaveLength(expectedJson.rows.length);
  });

  it('the rate card and expected golden reference the same rateCard version', () => {
    expect(card.version).toBe(expectedJson.rateCardVersion);
    expect(inputJson.rateCardVersion).toBe(expectedJson.rateCardVersion);
  });
});
