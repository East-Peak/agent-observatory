import { describe, it, expect } from 'vitest';
import { selectSpendOverview } from '@/panels/spend-overview/spendOverviewModel';
import { normalizeCost, type RateCard } from '@/domain/normalizeCost';
import type { Snapshot } from '@/domain/types';
import { inWindow, currentWindow, priorWindow } from '@/domain/dateRange';
import { sourceOfKey } from '@/domain/sources';
import snapshotJson from '../../data/fixtures/synthetic-snapshot.json';
import rateCardJson from '../../rateCard.json';
import { scaleRateCard } from '@/test-support/scaleRateCard';

const snapshot = snapshotJson as unknown as Snapshot;
const card = rateCardJson as unknown as RateCard;

/** Independent recomputation of the period cost from raw records (no view-model). */
function periodCost(source: string, from: string, to: string): bigint {
  return snapshot.records
    .filter((r) => (source === 'all' ? true : r.source === source))
    .filter((r) => r.date >= from && r.date <= to)
    .reduce((a, r) => a + normalizeCost(r, card), 0n);
}

describe('selectSpendOverview — the spendOverview view-model', () => {
  it('returns a date-ascending daily series whose costs sum to the headline total', () => {
    const m = selectSpendOverview(snapshot, card, 'all', 'all');
    const dates = m.series.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates); // already ascending
    expect(m.activeDays).toBe(m.series.length);
    const seriesSum = m.series.reduce((a, p) => a + p.costPico, 0n);
    expect(m.totalCostPico).toBe(seriesSum);
  });

  it('matches an independent raw recomputation for the current window', () => {
    const m = selectSpendOverview(snapshot, card, 'last30', 'all');
    expect(m.totalCostPico).toBe(periodCost('all', m.from, m.to));
  });

  it('applies the source filter (claude-only excludes other sources)', () => {
    const m = selectSpendOverview(snapshot, card, 'all', 'claude');
    const cur = currentWindow('all', snapshot.asOf, '2026-05-19');
    void cur;
    // every record contributing to the series is a claude record
    expect(m.totalCostPico).toBe(periodCost('claude', m.from, m.to));
    // and it is strictly less than the all-sources total over the same window
    const all = selectSpendOverview(snapshot, card, 'all', 'all');
    expect(m.totalCostPico < all.totalCostPico).toBe(true);
  });

  it('computes delta = current total minus the equal-length prior period', () => {
    const m = selectSpendOverview(snapshot, card, 'last7', 'all');
    const prior = priorWindow({ from: m.from, to: m.to });
    const priorCost = periodCost('all', prior.from, prior.to);
    expect(m.priorCostPico).toBe(priorCost);
    expect(m.deltaCostPico).toBe(m.totalCostPico - priorCost);
  });

  it('treats All Time as having no prior baseline (delta-pct = 0)', () => {
    const m = selectSpendOverview(snapshot, card, 'all', 'all');
    expect(m.priorCostPico).toBe(0n);
    expect(m.deltaBasisPoints).toBe(0);
  });

  it('is linear in the rate card: cost scales by k, token/day counts stay invariant', () => {
    const base = selectSpendOverview(snapshot, card, 'last30', 'all');
    for (const k of [2, 3, 7]) {
      const scaled = selectSpendOverview(snapshot, scaleRateCard(card, k), 'last30', 'all');
      expect(scaled.totalCostPico).toBe(base.totalCostPico * BigInt(k));
      expect(scaled.deltaCostPico).toBe(base.deltaCostPico * BigInt(k));
      expect(scaled.totalTokens).toBe(base.totalTokens); // invariant
      expect(scaled.activeDays).toBe(base.activeDays); // invariant
      expect(scaled.deltaBasisPoints).toBe(base.deltaBasisPoints); // ratio invariant
      scaled.series.forEach((p, i) => {
        expect(p.costPico).toBe(base.series[i]!.costPico * BigInt(k));
      });
    }
  });

  it('only includes in-window records (sanity on the window predicate)', () => {
    const m = selectSpendOverview(snapshot, card, 'thisMonth', 'all');
    const w = { from: m.from, to: m.to };
    for (const p of m.series) expect(inWindow(p.date, w)).toBe(true);
    expect(sourceOfKey('all')).toBeNull();
  });
});
