import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import type { Source } from '@/domain/types';
import { formatUsdFromPico, formatTokensCompact, formatMonthDay } from '@/ui/format';
import { PanelShell } from '@/components/ui/panel';
import { StatTile } from '@/components/ui/stat';
import { selectActivityFeed } from './activityFeedModel';

const sourceName = (s: Source): string => SOURCE_OPTIONS.find((o) => o.key === s)?.label ?? s;

/**
 * activityFeed: total normalized spend + token volume, plus a recent-runs list — one feed item per
 * scoped `(source, date, model)` record, carrying the full house-style feed contract and showing its
 * formatted cost. Carriers unchanged — restyled to the shared card/stat-tile system.
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
    <PanelShell
      panelKey="activityFeed"
      titleId="activity-feed-title"
      eyebrow="Recent activity · normalized cost"
      title="Activity Feed"
      asOf={snapshot.asOf}
      from={model.from}
      to={model.to}
      scopeLabel={`${rangeLabel} · ${sourceLabel}`}
    >
      <div className="flex flex-wrap gap-8">
        <StatTile label="Total Spend" metricKey="total-cost" kind="cost" raw={model.totalCostPico.toString()} size="lg">
          {formatUsdFromPico(model.totalCostPico)}
        </StatTile>
        <StatTile label="Tokens" metricKey="total-tokens" kind="tokens" raw={model.totalTokens.toString()}>
          {formatTokensCompact(model.totalTokens)}
        </StatTile>
      </div>

      <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto" aria-label="Recent runs">
        {model.items.map((it) => (
          <li
            key={it.key}
            data-testid="feed-item"
            data-feed-key={it.key}
            data-feed-date={it.date}
            data-feed-source={it.source}
            data-feed-project={it.project}
            data-feed-session={`${it.source}-${it.date}-${it.model}-${it.project}`}
            data-feed-cost-pico={it.costPico.toString()}
            data-value-kind="cost"
            className="grid grid-cols-[3.5rem_7rem_1fr_auto_auto] items-center gap-3 py-2 text-sm"
          >
            <span className="text-xs tabular-nums text-muted-foreground">{formatMonthDay(it.date)}</span>
            <span className="flex items-center gap-1.5 text-secondary-foreground">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-source-${it.source})` }}
                aria-hidden="true"
              />
              {sourceName(it.source)}
            </span>
            <span className="truncate text-muted-foreground">{it.model}</span>
            <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{formatTokensCompact(it.totalTokens)}</span>
            <span className="w-16 text-right font-semibold tabular-nums text-foreground">{formatUsdFromPico(it.costPico)}</span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
