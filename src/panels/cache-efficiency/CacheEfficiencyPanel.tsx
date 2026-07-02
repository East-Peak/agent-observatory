import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { formatUsdFromPico, formatTokensCompact } from '@/ui/format';
import { PanelShell } from '@/components/ui/panel';
import { StatTile } from '@/components/ui/stat';
import { selectCacheEfficiency } from './cacheEfficiencyModel';

/**
 * cacheEfficiency: scoped cache-read / cache-creation / fresh-input token volume plus the pico-USD a
 * panel of caching saved. `saved-cost` flows through the injected rate card (scales under coupling);
 * the token metrics stay invariant. Carriers unchanged — restyled to the shared card/stat-tile system.
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
    <PanelShell
      panelKey="cacheEfficiency"
      titleId="cache-efficiency-title"
      eyebrow="Prompt caching · token economics"
      title="Cache Efficiency"
      asOf={snapshot.asOf}
      from={model.from}
      to={model.to}
      scopeLabel={`${rangeLabel} · ${sourceLabel}`}
    >
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <StatTile label="Saved by Caching" metricKey="saved-cost" kind="cost" raw={model.savedPico.toString()} size="lg">
          {formatUsdFromPico(model.savedPico)}
        </StatTile>
        <StatTile label="Cache Reads" metricKey="cache-read-tokens" kind="tokens" raw={model.cacheReadTokens.toString()}>
          {formatTokensCompact(model.cacheReadTokens)}
        </StatTile>
        <StatTile label="Cache Writes" metricKey="cache-creation-tokens" kind="tokens" raw={model.cacheCreationTokens.toString()}>
          {formatTokensCompact(model.cacheCreationTokens)}
        </StatTile>
        <StatTile label="Fresh Input" metricKey="fresh-input-tokens" kind="tokens" raw={model.freshInputTokens.toString()}>
          {formatTokensCompact(model.freshInputTokens)}
        </StatTile>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-[var(--color-source-codex)]" style={{ width: `${hitRate}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {hitRate}% of read input served from cache · saved {formatUsdFromPico(model.savedPico)} vs. uncached input
        </p>
      </div>
    </PanelShell>
  );
}
