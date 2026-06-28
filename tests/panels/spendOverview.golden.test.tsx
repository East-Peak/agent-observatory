import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataSourceProvider } from '@/data/DataSourceContext';
import { ScopeProvider, type Scope } from '@/app/ScopeProvider';
import { SpendOverviewPanel } from '@/panels/spend-overview/SpendOverviewPanel';
import type { RangeKey } from '@/domain/dateRange';
import type { SourceKey } from '@/domain/sources';
import golden from '../../data/fixtures/panel-golden.json';

interface GoldenMetric {
  readonly value: string;
  readonly kind: string;
}
interface GoldenState {
  readonly range: string;
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly metrics: Record<string, GoldenMetric>;
  readonly series: ReadonlyArray<{ readonly date: string; readonly value: string; readonly kind: string }>;
}

const states = golden.panels.spendOverview.states as readonly GoldenState[];

function renderState(scope: Scope): void {
  render(
    <MemoryRouter>
      <DataSourceProvider>
        <ScopeProvider initialScope={scope}>
          <SpendOverviewPanel />
        </ScopeProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

describe('spendOverview — panel-golden (raw DOM equals the frozen golden)', () => {
  it('covers every required (range, source) state', () => {
    expect(states.length).toBeGreaterThanOrEqual(6);
  });

  it.each(states.map((s) => [`${s.range} / ${s.source}`, s] as const))(
    'reproduces the frozen raw values for %s',
    (_label, state) => {
      renderState({ range: state.range as RangeKey, source: state.source as SourceKey });

      // Headline metrics: exact RAW base-10 integer + value-kind, keyed by data-metric-key.
      const metricEls = screen.getAllByTestId('panel-metric');
      const renderedKeys = metricEls.map((el) => el.getAttribute('data-metric-key'));
      expect(new Set(renderedKeys)).toEqual(new Set(Object.keys(state.metrics)));

      for (const [key, expected] of Object.entries(state.metrics)) {
        const el = metricEls.find((n) => n.getAttribute('data-metric-key') === key);
        expect(el, `metric ${key} present`).toBeTruthy();
        expect(el!.getAttribute('data-metric-value'), `metric ${key} value`).toBe(expected.value);
        expect(el!.getAttribute('data-value-kind'), `metric ${key} kind`).toBe(expected.kind);
      }

      // Series points: exact RAW pico values in date order, cost-kind.
      const points = screen.getAllByTestId('series-point');
      expect(points.map((p) => p.getAttribute('data-point-value'))).toEqual(state.series.map((s) => s.value));
      expect(points.map((p) => p.getAttribute('data-point-date'))).toEqual(state.series.map((s) => s.date));
      for (const p of points) expect(p.getAttribute('data-value-kind')).toBe('cost');
    },
  );
});
