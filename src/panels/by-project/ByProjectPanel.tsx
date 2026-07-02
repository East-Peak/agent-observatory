import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { Card, CardEyebrow, CardHeader, CardTitle } from '@/components/ui/card';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { metaForKey, UNATTRIBUTED } from '@/domain/projects';
import { formatUsdFromPico, formatTokensCompact, formatPercent, formatMonthDay } from '@/ui/format';
import { selectByProject } from './byProjectModel';

/**
 * byProject: the per-project usage-allocation leaderboard — total normalized spend over the repo +
 * `__unattributed__` grid (tools excluded), then one ranked row per project with its cost, token
 * volume, and token share of the grid (a bar). The row's carrier emits the RAW cost / tokens / share
 * the frozen oracle reads and shows the same figures, so value + visible-text checks hold.
 */
export function ByProjectPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectByProject(snapshot, card, scope.range, scope.source);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';
  const maxShareBp = model.rows.reduce((m, r) => (r.tokenShareBp > m ? r.tokenShareBp : m), 0);

  return (
    <Card data-panel-root="byProject" aria-labelledby="by-project-title" className="gap-4">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardEyebrow>Usage allocation · by project</CardEyebrow>
          <CardTitle id="by-project-title">By Project</CardTitle>
          <p className="text-xs text-muted-foreground">
            As of {snapshot.asOf} · {formatMonthDay(model.from)} – {formatMonthDay(model.to)}
          </p>
        </div>
        <div className="shrink-0 rounded-md bg-muted/50 px-2 py-1 text-xs text-secondary-foreground">
          {rangeLabel} · {sourceLabel}
        </div>
      </CardHeader>

      <ScopeBar />

      {model.isEmpty ? (
        <p
          className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
          data-testid="byproject-empty"
          data-empty-section="project"
          data-empty-reason="No repository or unattributed usage in this scope"
        >
          No repository or unattributed usage in this scope — Codex and OpenClaw run as tools, so switch the
          source to Claude Code or All to see the project leaderboard.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Total spend · projects</span>
            <span
              className="text-3xl font-semibold tracking-tight"
              data-testid="panel-metric"
              data-metric-key="total-cost"
              data-metric-value={model.totalCostPico.toString()}
              data-value-kind="cost"
            >
              {formatUsdFromPico(model.totalCostPico)}
            </span>
          </div>

          <ol className="flex flex-col gap-2.5" aria-label="Usage by project">
            {model.rows.map((r, i) => {
              const barPct = maxShareBp > 0 ? (r.tokenShareBp * 100) / maxShareBp : 0;
              const isUnattributed = r.projectKey === UNATTRIBUTED;
              return (
                <li key={r.projectKey} className="flex items-center gap-3">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <span
                        className={`truncate text-sm font-medium ${isUnattributed ? 'text-muted-foreground italic' : 'text-foreground'}`}
                      >
                        {metaForKey(r.projectKey).label}
                      </span>
                      <span
                        data-testid="breakdown-row"
                        data-row-key={r.projectKey}
                        data-row-value={r.costPico.toString()}
                        data-value-kind="cost"
                        data-row-tokens={String(r.totalTokens)}
                        data-row-share={String(r.tokenShareBp)}
                        data-share-kind="percent"
                        data-row-index={String(i)}
                        className="flex shrink-0 items-baseline gap-3 tabular-nums"
                      >
                        <span className="text-sm font-semibold text-foreground">{formatUsdFromPico(r.costPico)}</span>
                        <span className="w-14 text-right text-xs text-muted-foreground">{formatTokensCompact(r.totalTokens)}</span>
                        <span className="w-12 text-right text-xs text-secondary-foreground">{formatPercent(r.tokenShareBp)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div
                        className={`h-full rounded-full ${isUnattributed ? 'bg-muted-foreground/50' : 'bg-[var(--color-source-claude)]'}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Card>
  );
}
