import { describe, it, expect } from 'vitest';
import { normalizeCost, type RateCard } from '@/domain/normalizeCost';
import type { UsageRecord } from '@/domain/types';
import rateCardJson from '../../rateCard.json';
import inputJson from '../../data/fixtures/normalization-input.json';
import expectedJson from '../../data/fixtures/expected-normalized.json';

const card = rateCardJson as unknown as RateCard;
const records = inputJson.records as unknown as UsageRecord[];

// Key by the FULL canonical record identity (date, source, project, model) — the same tuple the
// snapshot sort and the carrier keys use — so two records differing only by project never collide
// in the golden lookup (cost itself is project-independent, but the identity must be).
const identity = (r: { date: string; source: string; project: string; model: string }): string =>
  `${r.date}|${r.source}|${r.project}|${r.model}`;

describe('normalization golden (real rateCard.json vs hand-derived expected)', () => {
  it('normalizeCost reproduces the frozen expected pico cost for every input row', () => {
    const expected = new Map(expectedJson.rows.map((r) => [identity(r), BigInt(r.costPico)]));
    let total = 0n;
    for (const record of records) {
      const want = expected.get(identity(record));
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
