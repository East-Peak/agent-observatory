import type { ReactNode } from 'react';
import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import {
  formatUsdFromPico,
  formatTokensCompact,
  formatDeltaPercent,
  formatMonthDay,
} from '@/ui/format';
import { selectSpendOverview } from './spendOverviewModel';
import { Sparkline } from './Sparkline';

const SPEND_COLOR = 'var(--accent-spend)';

type ValueKind = 'cost' | 'tokens' | 'count' | 'percent';

/** One house-style headline metric: visible figure + the RAW base-10 integer the verifier reads. */
function Metric({
  metricKey,
  kind,
  raw,
  label,
  children,
  size = 'sm',
}: {
  readonly metricKey: string;
  readonly kind: ValueKind;
  readonly raw: string;
  readonly label: string;
  readonly children: ReactNode;
  readonly size?: 'sm' | 'lg';
}) {
  return (
    <div className={`metric metric--${size}`}>
      <span className="metric__label">{label}</span>
      <span
        className="metric__value"
        data-testid="panel-metric"
        data-metric-key={metricKey}
        data-metric-value={raw}
        data-value-kind={kind}
      >
        {children}
      </span>
    </div>
  );
}

export function SpendOverviewPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectSpendOverview(snapshot, card, scope.range, scope.source);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';
  const hasPrior = model.priorCostPico > 0n;
  const dir = model.deltaCostPico > 0n ? 'up' : model.deltaCostPico < 0n ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  const deltaMagnitude = model.deltaCostPico < 0n ? -model.deltaCostPico : model.deltaCostPico;

  return (
    <section className="panel panel--spend" aria-labelledby="spend-overview-title" data-panel-root="spendOverview">
      <header className="panel__head">
        <div className="panel__titleblock">
          <p className="panel__eyebrow">Normalized spend · estimated</p>
          <h2 id="spend-overview-title" className="panel__title">
            Spend Overview
          </h2>
          <p className="panel__provenance">
            As of {snapshot.asOf} · {formatMonthDay(model.from)} – {formatMonthDay(model.to)}
          </p>
        </div>
        <ul className="sourcelegend" aria-label="Source palette">
          {SOURCE_OPTIONS.filter((o) => o.key !== 'all').map((o) => (
            <li key={o.key} className="sourcelegend__item">
              <span className="source-dot" data-source={o.key} aria-hidden="true" />
              {o.label}
            </li>
          ))}
        </ul>
      </header>

      <ScopeBar />

      <div className="panel__metrics">
        <Metric metricKey="total-cost" kind="cost" raw={model.totalCostPico.toString()} label="Total Spend" size="lg">
          {formatUsdFromPico(model.totalCostPico)}
        </Metric>

        <div className={`deltachip deltachip--${dir}`} data-dir={dir}>
          <span className="deltachip__arrow" aria-hidden="true">
            {arrow}
          </span>
          <span className="deltachip__body">
            <span
              className="deltachip__amount"
              data-testid="panel-metric"
              data-metric-key="delta-cost"
              data-metric-value={model.deltaCostPico.toString()}
              data-value-kind="cost"
            >
              {formatUsdFromPico(deltaMagnitude)}
            </span>
            <span
              className="deltachip__pct"
              data-testid="panel-metric"
              data-metric-key="delta-pct"
              data-metric-value={model.deltaBasisPoints.toString()}
              data-value-kind="percent"
            >
              {hasPrior ? formatDeltaPercent(model.deltaBasisPoints) : 'new'}
            </span>
          </span>
          <span className="deltachip__caption">vs prior period</span>
        </div>

        <Metric metricKey="total-tokens" kind="tokens" raw={model.totalTokens.toString()} label="Tokens">
          {formatTokensCompact(model.totalTokens)}
        </Metric>

        <Metric metricKey="active-days" kind="count" raw={model.activeDays.toString()} label="Active Days">
          {model.activeDays}
        </Metric>
      </div>

      <div className="panel__chart">
        <div className="panel__chart-head">
          <span className="panel__chart-title">Daily normalized spend</span>
          <span className="panel__chart-scope">
            {rangeLabel} · {sourceLabel}
          </span>
        </div>
        <Sparkline series={model.series} color={SPEND_COLOR} />
        <div className="panel__chart-axis">
          <span>{formatMonthDay(model.from)}</span>
          <span>{formatMonthDay(model.to)}</span>
        </div>
      </div>
    </section>
  );
}
