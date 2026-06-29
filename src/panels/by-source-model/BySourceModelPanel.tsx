import type { ReactNode } from 'react';
import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import type { Source } from '@/domain/types';
import { formatUsdFromPico, formatTokensCompact, formatMonthDay } from '@/ui/format';
import { selectBySourceModel } from './bySourceModelModel';

type ValueKind = 'cost' | 'tokens';

const sourceName = (s: Source): string => SOURCE_OPTIONS.find((o) => o.key === s)?.label ?? s;

/** One house-style metric: visible figure + the RAW base-10 integer the verifier reads. */
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

/**
 * bySourceModel: total normalized spend + token volume, plus one breakdown row per `(source, model)`
 * in scope. Each row's value carrier emits the RAW pico-USD `BigInt` string the verifier reads and
 * shows the same figure formatted — so the frozen panel oracle's value, coupling, and visible-text
 * checks all hold. Cost flows from the injected rate card through `normalizeCost`; the token metric is
 * invariant under rate-card scaling.
 */
export function BySourceModelPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectBySourceModel(snapshot, card, scope.range, scope.source);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';
  const max = model.rows.reduce((m, r) => (r.costPico > m ? r.costPico : m), 0n);

  return (
    <section
      className="panel panel--breakdown"
      aria-labelledby="by-source-model-title"
      data-panel-root="bySourceModel"
    >
      <header className="panel__head">
        <div className="panel__titleblock">
          <p className="panel__eyebrow">Normalized spend · by source &amp; model</p>
          <h2 id="by-source-model-title" className="panel__title">
            By Source &amp; Model
          </h2>
          <p className="panel__provenance">
            As of {snapshot.asOf} · {formatMonthDay(model.from)} – {formatMonthDay(model.to)}
          </p>
        </div>
        <div className="panel__chart-scope">
          {rangeLabel} · {sourceLabel}
        </div>
      </header>

      <ScopeBar />

      <div className="panel__metrics">
        <Metric metricKey="total-cost" kind="cost" raw={model.totalCostPico.toString()} label="Total Spend" size="lg">
          {formatUsdFromPico(model.totalCostPico)}
        </Metric>
        <Metric metricKey="total-tokens" kind="tokens" raw={model.totalTokens.toString()} label="Tokens">
          {formatTokensCompact(model.totalTokens)}
        </Metric>
      </div>

      <ul className="breakdown" aria-label="Spend by source and model">
        {model.rows.map((r) => {
          const pct = max > 0n ? Number((r.costPico * 100n) / max) : 0;
          return (
            <li key={r.key} className="breakdown__row">
              <span className="breakdown__label">
                <span className="source-dot" data-source={r.source} aria-hidden="true" /> {sourceName(r.source)} ·{' '}
                {r.model}
              </span>
              <span className="breakdown__bar" aria-hidden="true">
                <span className="breakdown__fill" data-source={r.source} style={{ width: `${pct}%` }} />
              </span>
              <span
                className="breakdown__value"
                data-testid="breakdown-row"
                data-row-key={r.key}
                data-row-value={r.costPico.toString()}
                data-value-kind="cost"
              >
                {formatUsdFromPico(r.costPico)}
              </span>
              <span className="breakdown__tokens">{formatTokensCompact(r.totalTokens)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
