import type { ReactNode } from 'react';
import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { formatUsdFromPico, formatTokensCompact, formatMonthDay } from '@/ui/format';
import { selectCacheEfficiency } from './cacheEfficiencyModel';

type ValueKind = 'cost' | 'tokens';

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
 * cacheEfficiency: scoped cache-read / cache-creation / fresh-input token volume plus the pico-USD
 * a panel of caching saved (what the cache-read tokens would have cost at the input rate, minus what
 * they did cost). `saved-cost` flows through the injected rate card, so it scales under coupling;
 * the token metrics stay invariant.
 */
export function CacheEfficiencyPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectCacheEfficiency(snapshot, card, scope.range, scope.source);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';
  const cacheTotal = model.cacheReadTokens + model.freshInputTokens;
  const hitRate = cacheTotal > 0 ? Math.round((model.cacheReadTokens / cacheTotal) * 100) : 0;

  return (
    <section
      className="panel panel--cache"
      aria-labelledby="cache-efficiency-title"
      data-panel-root="cacheEfficiency"
    >
      <header className="panel__head">
        <div className="panel__titleblock">
          <p className="panel__eyebrow">Prompt caching · token economics</p>
          <h2 id="cache-efficiency-title" className="panel__title">
            Cache Efficiency
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
        <Metric metricKey="saved-cost" kind="cost" raw={model.savedPico.toString()} label="Saved by Caching" size="lg">
          {formatUsdFromPico(model.savedPico)}
        </Metric>
        <Metric metricKey="cache-read-tokens" kind="tokens" raw={model.cacheReadTokens.toString()} label="Cache Reads">
          {formatTokensCompact(model.cacheReadTokens)}
        </Metric>
        <Metric
          metricKey="cache-creation-tokens"
          kind="tokens"
          raw={model.cacheCreationTokens.toString()}
          label="Cache Writes"
        >
          {formatTokensCompact(model.cacheCreationTokens)}
        </Metric>
        <Metric
          metricKey="fresh-input-tokens"
          kind="tokens"
          raw={model.freshInputTokens.toString()}
          label="Fresh Input"
        >
          {formatTokensCompact(model.freshInputTokens)}
        </Metric>
      </div>

      <div className="panel__chart">
        <div className="cachebar" aria-hidden="true">
          <span className="cachebar__read" style={{ width: `${hitRate}%` }} />
          <span className="cachebar__fresh" style={{ width: `${100 - hitRate}%` }} />
        </div>
        <p className="panel__note">
          {hitRate}% of read input served from cache · saved {formatUsdFromPico(model.savedPico)} vs. uncached input
        </p>
      </div>
    </section>
  );
}
