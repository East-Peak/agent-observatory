import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { metaForKey } from '@/domain/projects';
import { formatUsdFromPico, formatTokensCompact, formatPercent, formatMonthDay } from '@/ui/format';
import { selectByProject } from './byProjectModel';

/**
 * byProject: the per-project usage-allocation leaderboard. Total normalized spend over the repo +
 * `__unattributed__` grid (tools excluded), then one ranked row per project showing its cost, token
 * volume, and token share of the grid. Each row's carrier emits the RAW pico-USD cost + token count +
 * share basis points the frozen oracle reads, and renders the SAME figures formatted so the visible
 * text stays consistent. Cost flows the injected rate card through `normalizeCost` (coupled); tokens +
 * share are card-invariant. A tool-only source scope (empty grid) renders the frozen empty state.
 */
export function ByProjectPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectByProject(snapshot, card, scope.range, scope.source);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';
  const maxTokens = model.rows.reduce((m, r) => (r.totalTokens > m ? r.totalTokens : m), 0);

  return (
    <section className="panel panel--breakdown" aria-labelledby="by-project-title" data-panel-root="byProject">
      <header className="panel__head">
        <div className="panel__titleblock">
          <p className="panel__eyebrow">Usage allocation · by project</p>
          <h2 id="by-project-title" className="panel__title">
            By Project
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

      {model.isEmpty ? (
        <p
          className="panel__empty"
          data-testid="byproject-empty"
          data-empty-section="project"
          data-empty-reason="No repository or unattributed usage in this scope"
        >
          No repository or unattributed usage in this scope — Codex and OpenClaw run as tools, so switch the
          source to Claude Code or All to see the project leaderboard.
        </p>
      ) : (
        <>
          <div className="panel__metrics">
            <div className="metric metric--lg">
              <span className="metric__label">Total Spend · projects</span>
              <span
                className="metric__value"
                data-testid="panel-metric"
                data-metric-key="total-cost"
                data-metric-value={model.totalCostPico.toString()}
                data-value-kind="cost"
              >
                {formatUsdFromPico(model.totalCostPico)}
              </span>
            </div>
          </div>

          <ol className="breakdown breakdown--ranked" aria-label="Usage by project">
            {model.rows.map((r, i) => {
              const pct = maxTokens > 0 ? Math.round((r.totalTokens * 100) / maxTokens) : 0;
              return (
                <li key={r.projectKey} className="breakdown__row">
                  <span
                    className="breakdown__project"
                    data-testid="breakdown-row"
                    data-row-key={r.projectKey}
                    data-row-value={r.costPico.toString()}
                    data-value-kind="cost"
                    data-row-tokens={String(r.totalTokens)}
                    data-row-share={String(r.tokenShareBp)}
                    data-share-kind="percent"
                    data-row-index={String(i)}
                  >
                    <span className="breakdown__rank" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="breakdown__label">{metaForKey(r.projectKey).label}</span>
                    <span className="breakdown__bar" aria-hidden="true">
                      <span className="breakdown__fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="breakdown__cost">{formatUsdFromPico(r.costPico)}</span>
                    <span className="breakdown__tokens">{formatTokensCompact(r.totalTokens)}</span>
                    <span className="breakdown__share">{formatPercent(r.tokenShareBp)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
