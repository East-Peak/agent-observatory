import { describe, it, expect } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataSourceProvider } from '@/data/DataSourceContext';
import { ScopeProvider } from '@/app/ScopeProvider';
import { SpendOverviewPanel } from '@/panels/spend-overview/SpendOverviewPanel';
import { createFixturesDataSource, baseRateCard } from '@/data/FixturesDataSource';
import { scaleRateCard } from '@/test-support/scaleRateCard';
import type { RateCard } from '@/domain/normalizeCost';
import scaleFactors from '../../data/fixtures/scale-factors.json';

const COST_KINDS = new Set(['cost', 'rate']);

interface Cell {
  readonly id: string;
  readonly kind: string;
  readonly value: string;
}

/** Render the panel with `card` injected, snapshot every house-style raw value, then unmount. */
function snapshotDom(card: RateCard): Cell[] {
  render(
    <MemoryRouter>
      <DataSourceProvider source={createFixturesDataSource({ rateCard: card })}>
        <ScopeProvider initialScope={{ range: 'last30', source: 'all' }}>
          <SpendOverviewPanel />
        </ScopeProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
  const metrics = screen.getAllByTestId('panel-metric').map<Cell>((el) => ({
    id: `m:${el.getAttribute('data-metric-key')}`,
    kind: el.getAttribute('data-value-kind') ?? '',
    value: el.getAttribute('data-metric-value') ?? '',
  }));
  const series = screen.getAllByTestId('series-point').map<Cell>((el) => ({
    id: `s:${el.getAttribute('data-point-date')}`,
    kind: el.getAttribute('data-value-kind') ?? '',
    value: el.getAttribute('data-point-value') ?? '',
  }));
  cleanup();
  return [...metrics, ...series];
}

describe('spendOverview — pipeline-coupling (cost is linear in the rate card)', () => {
  const factors = scaleFactors.factors as readonly number[];

  it('declares at least two scale factors', () => {
    expect(factors.length).toBeGreaterThanOrEqual(2);
  });

  it('scales cost/rate values by k and leaves non-cost values invariant', () => {
    const base = snapshotDom(baseRateCard());
    const byId = new Map(base.map((c) => [c.id, c]));

    // Sanity: there is real cost to scale AND a real invariant to hold.
    expect(base.some((c) => COST_KINDS.has(c.kind) && BigInt(c.value) !== 0n)).toBe(true);
    expect(base.some((c) => !COST_KINDS.has(c.kind))).toBe(true);
    const delta = byId.get('m:delta-cost');
    expect(delta && BigInt(delta.value) !== 0n).toBe(true); // last30 has a prior period

    for (const k of factors) {
      const scaled = snapshotDom(scaleRateCard(baseRateCard(), k));
      expect(scaled.length).toBe(base.length);
      for (const cell of scaled) {
        const ref = byId.get(cell.id);
        expect(ref, `${cell.id} present in baseline`).toBeTruthy();
        expect(cell.kind).toBe(ref!.kind);
        if (COST_KINDS.has(cell.kind)) {
          expect(BigInt(cell.value)).toBe(BigInt(ref!.value) * BigInt(k));
        } else {
          expect(cell.value).toBe(ref!.value); // invariant under card scaling
        }
      }
    }
  });
});
