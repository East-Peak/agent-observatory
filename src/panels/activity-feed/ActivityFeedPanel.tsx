import type { ReactNode } from 'react';
import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import type { Source } from '@/domain/types';
import { formatUsdFromPico, formatTokensCompact, formatMonthDay } from '@/ui/format';
import { selectActivityFeed } from './activityFeedModel';

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
 * activityFeed: total normalized spend + token volume, plus a recent-runs list — one feed item per
 * scoped `(source, date, model)` record. Each item carries the full house-style feed contract and
 * shows its formatted cost as visible text, so the frozen panel oracle's value, coupling, and
 * visible-text checks all hold. Each item's cost flows from the injected rate card through
 * `normalizeCost`, so it scales under coupling; the token metric is invariant.
 */
export function ActivityFeedPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectActivityFeed(snapshot, card, scope.range, scope.source);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';

  return (
    <section
      className="panel panel--feed"
      aria-labelledby="activity-feed-title"
      data-panel-root="activityFeed"
    >
      <header className="panel__head">
        <div className="panel__titleblock">
          <p className="panel__eyebrow">Recent activity · normalized cost</p>
          <h2 id="activity-feed-title" className="panel__title">
            Activity Feed
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

      <ul className="feed" aria-label="Recent runs">
        {model.items.map((it) => (
          <li
            key={it.key}
            className="feed__item"
            data-testid="feed-item"
            data-feed-key={it.key}
            data-feed-date={it.date}
            data-feed-source={it.source}
            data-feed-project={sourceName(it.source)}
            data-feed-session={`${it.source}-${it.date}-${it.model}`}
            data-feed-cost-pico={it.costPico.toString()}
            data-value-kind="cost"
          >
            <span className="feed__date">{formatMonthDay(it.date)}</span>
            <span className="feed__source">
              <span className="source-dot" data-source={it.source} aria-hidden="true" /> {sourceName(it.source)}
            </span>
            <span className="feed__model">{it.model}</span>
            <span className="feed__tokens">{formatTokensCompact(it.totalTokens)}</span>
            <span className="feed__cost">{formatUsdFromPico(it.costPico)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
