import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import type { Source } from '@/domain/types';
import { formatUsdFromPico, formatTokensCompact } from '@/ui/format';
import { PanelShell } from '@/components/ui/panel';
import { StatTile } from '@/components/ui/stat';
import { selectBySourceModel } from './bySourceModelModel';

const sourceName = (s: Source): string => SOURCE_OPTIONS.find((o) => o.key === s)?.label ?? s;
const sourceColour = (s: Source): string => `var(--color-source-${s})`;

/**
 * bySourceModel: total normalized spend + token volume, plus one breakdown row per `(source, model)`
 * in scope. Each row emits the RAW pico-USD cost the oracle reads and shows the same figure. Carriers
 * unchanged — restyled to the shared card/stat-tile system.
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
    <PanelShell
      panelKey="bySourceModel"
      titleId="by-source-model-title"
      eyebrow="Normalized spend · by source & model"
      title="By Source & Model"
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

      <ul className="flex flex-col gap-2.5" aria-label="Spend by source and model">
        {model.rows.map((r) => {
          const barPct = max > 0n ? Number((r.costPico * 100n) / max) : 0;
          return (
            <li key={r.key} className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: sourceColour(r.source) }}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="truncate text-sm">
                    <span className="text-muted-foreground">{sourceName(r.source)}</span>
                    <span className="text-foreground"> · {r.model}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                    <span
                      data-testid="breakdown-row"
                      data-row-key={r.key}
                      data-row-value={r.costPico.toString()}
                      data-value-kind="cost"
                      className="text-sm font-semibold text-foreground"
                    >
                      {formatUsdFromPico(r.costPico)}
                    </span>
                    <span className="w-14 text-right text-xs text-muted-foreground">{formatTokensCompact(r.totalTokens)}</span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: sourceColour(r.source) }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}
