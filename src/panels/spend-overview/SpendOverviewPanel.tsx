import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { formatUsdFromPico, formatTokensCompact, formatDeltaPercent, formatMonthDay } from '@/ui/format';
import { PanelShell } from '@/components/ui/panel';
import { StatTile } from '@/components/ui/stat';
import { selectSpendOverview } from './spendOverviewModel';
import { Sparkline } from './Sparkline';

const SPEND_COLOUR = 'var(--color-source-claude)';

/**
 * spendOverview: total normalized spend + a period-over-period delta + token & active-day counts, over
 * a daily-spend sparkline. Carriers unchanged (the sparkline still emits series-point geometry) —
 * restyled to the shared card/stat-tile system.
 */
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
  // Spend going DOWN is good, UP is bad — status ink, never the series colour.
  const deltaTone =
    dir === 'down' ? 'text-[var(--color-good)]' : dir === 'up' ? 'text-[var(--color-critical)]' : 'text-muted-foreground';

  return (
    <PanelShell
      panelKey="spendOverview"
      titleId="spend-overview-title"
      eyebrow="Normalized spend · estimated"
      title="Spend Overview"
      asOf={snapshot.asOf}
      from={model.from}
      to={model.to}
      scopeLabel={`${rangeLabel} · ${sourceLabel}`}
    >
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <StatTile label="Total Spend" metricKey="total-cost" kind="cost" raw={model.totalCostPico.toString()} size="lg">
          {formatUsdFromPico(model.totalCostPico)}
        </StatTile>

        <div className="flex flex-col gap-1">
          <span className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">vs prior period</span>
          <span className={`flex items-baseline gap-1.5 text-base font-semibold ${deltaTone}`}>
            <span aria-hidden="true">{arrow}</span>
            <span
              data-testid="panel-metric"
              data-metric-key="delta-cost"
              data-metric-value={model.deltaCostPico.toString()}
              data-value-kind="cost"
              className="tabular-nums"
            >
              {formatUsdFromPico(deltaMagnitude)}
            </span>
            <span
              data-testid="panel-metric"
              data-metric-key="delta-pct"
              data-metric-value={model.deltaBasisPoints.toString()}
              data-value-kind="percent"
              className="text-sm tabular-nums text-muted-foreground"
            >
              {hasPrior ? formatDeltaPercent(model.deltaBasisPoints) : 'new'}
            </span>
          </span>
        </div>

        <StatTile label="Tokens" metricKey="total-tokens" kind="tokens" raw={model.totalTokens.toString()}>
          {formatTokensCompact(model.totalTokens)}
        </StatTile>
        <StatTile label="Active Days" metricKey="active-days" kind="count" raw={model.activeDays.toString()}>
          {model.activeDays}
        </StatTile>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-secondary-foreground">Daily normalized spend</span>
          <span className="text-xs text-muted-foreground">
            {rangeLabel} · {sourceLabel}
          </span>
        </div>
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <Sparkline series={model.series} color={SPEND_COLOUR} />
        </div>
        <div className="flex justify-between text-[0.65rem] tabular-nums text-muted-foreground">
          <span>{formatMonthDay(model.from)}</span>
          <span>{formatMonthDay(model.to)}</span>
        </div>
      </div>
    </PanelShell>
  );
}
