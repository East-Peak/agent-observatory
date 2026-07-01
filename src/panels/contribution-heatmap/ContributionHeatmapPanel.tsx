import { useState } from 'react';
import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { metaForKey } from '@/domain/projects';
import { formatUsdFromPico, formatTokensCompact, formatMonthDay } from '@/ui/format';
import {
  selectContributionHeatmap,
  selectCellBreakdown,
  type Bucket,
  type Metric,
} from './contributionHeatmapModel';

// GitHub-style 5-level ramp (bin 0 = empty → bin 4 = most). Concrete hex so jsdom resolves it to a
// distinct rgb() per bin (the frozen oracle reads the INLINE colour and requires distinct bins).
const RAMP = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'] as const;
const rampColour = (bin: number): string => RAMP[Math.max(0, Math.min(RAMP.length - 1, bin))] ?? RAMP[0];

const BUCKETS: ReadonlyArray<{ readonly key: Bucket; readonly label: string }> = [
  { key: 'day', label: 'Daily' },
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
];
const METRICS: ReadonlyArray<{ readonly key: Metric; readonly label: string }> = [
  { key: 'tokens', label: 'Tokens' },
  { key: 'cost', label: '$' },
];

const EMPTY_PROSE: Record<'project' | 'tool', string> = {
  project: 'No repository or unattributed usage in this scope — switch the source to Claude Code or All to see the project grid.',
  tool: 'No tool (Codex / OpenClaw) usage in this scope — the Tools strip appears under the All or a tool source.',
};

function Segmented<T extends string>({
  filterId,
  optionId,
  options,
  active,
  onSelect,
  label,
}: {
  readonly filterId: string;
  readonly optionId: string;
  readonly options: ReadonlyArray<{ readonly key: T; readonly label: string }>;
  readonly active: T;
  readonly onSelect: (key: T) => void;
  readonly label: string;
}) {
  return (
    <div className="scopebar__group" data-testid={filterId} role="group" aria-label={label}>
      <span className="scopebar__label">{label}</span>
      <div className="segmented">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className="segmented__option"
            data-testid={optionId}
            aria-current={active === opt.key ? 'true' : undefined}
            onClick={() => onSelect(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * contributionHeatmap: a dense project × time contribution grid (a project section — repos +
 * Unattributed — over a Tools strip), with Daily/Weekly/Monthly and Tokens/$ mode toggles on top of
 * the shared range/source scope. Each cell is a coloured, keyboard-operable button carrying the RAW
 * value + its per-section quantile intensity bin; focusing one reveals the (source, model) breakdown
 * for that cell. Cells render in row-major DOM order; the inline colour is a pure function of
 * (section, bin), distinct across bins. Everything derives from the frozen engine (aggregateByProjectPeriod
 * + quantileScale), so it matches the frozen panel oracle exactly.
 */
export function ContributionHeatmapPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const [bucket, setBucket] = useState<Bucket>('day');
  const [metric, setMetric] = useState<Metric>('tokens');
  const [focused, setFocused] = useState<{ readonly project: string; readonly bucketId: string } | null>(null);

  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectContributionHeatmap(snapshot, card, scope.range, scope.source, bucket, metric);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';
  const kind = metric === 'tokens' ? 'tokens' : 'cost';
  const cellFigure = (value: bigint): string =>
    metric === 'tokens' ? `${formatTokensCompact(Number(value))} tokens` : formatUsdFromPico(value);

  const toggleFocus = (project: string, bucketId: string): void =>
    setFocused((cur) => (cur && cur.project === project && cur.bucketId === bucketId ? null : { project, bucketId }));

  const breakdown = focused
    ? selectCellBreakdown(snapshot, card, scope.range, scope.source, bucket, metric, focused.project, focused.bucketId)
    : [];

  return (
    <section
      className="panel panel--heatmap"
      aria-labelledby="contribution-heatmap-title"
      data-panel-root="contributionHeatmap"
    >
      <header className="panel__head">
        <div className="panel__titleblock">
          <p className="panel__eyebrow">Usage allocation · contribution grid</p>
          <h2 id="contribution-heatmap-title" className="panel__title">
            Contribution Heatmap
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

      <div className="heatmap__modes">
        <Segmented filterId="bucket-filter" optionId="bucket-option" options={BUCKETS} active={bucket} onSelect={setBucket} label="Bucket" />
        <Segmented filterId="metric-filter" optionId="metric-option" options={METRICS} active={metric} onSelect={setMetric} label="Metric" />
      </div>

      <div className="heatmap__grid">
        {model.sections.map((sec) =>
          sec.isEmpty ? (
            <p
              key={sec.section}
              className="heatmap__empty"
              data-testid="heatmap-empty"
              data-empty-section={sec.section}
              data-empty-reason={EMPTY_PROSE[sec.section]}
            >
              {EMPTY_PROSE[sec.section]}
            </p>
          ) : (
            <div className="heatsection" key={sec.section} data-section={sec.section}>
              <h3 className="heatsection__title">{sec.section === 'project' ? 'Projects' : 'Tools'}</h3>
              <div className="heatsection__rows">
                {sec.rows.map((row) => (
                  <div className="heatrow" key={row.projectKey}>
                    <span className="heatrow__label">{row.label}</span>
                    <div className="heatrow__cells">
                      {row.cells.map((cell) => {
                        const isFocused = focused?.project === cell.projectKey && focused?.bucketId === cell.bucketId;
                        return (
                          <button
                            key={cell.bucketId}
                            type="button"
                            className={`heatcell${isFocused ? ' heatcell--focused' : ''}`}
                            data-testid="heatmap-cell"
                            data-cell-row={cell.projectKey}
                            data-cell-bucket={cell.bucketId}
                            data-cell-section={cell.section}
                            data-cell-value={cell.value.toString()}
                            data-value-kind={kind}
                            data-intensity={String(cell.intensity)}
                            data-cell-row-index={String(cell.rowIndex)}
                            data-cell-col-index={String(cell.colIndex)}
                            style={{ backgroundColor: rampColour(cell.intensity) }}
                            aria-label={`${row.label} · ${cell.bucketId} · ${cellFigure(cell.value)}`}
                            aria-pressed={isFocused}
                            onClick={() => toggleFocus(cell.projectKey, cell.bucketId)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ),
        )}
      </div>

      {focused ? (
        <div className="heatmap__breakdown" data-testid="heatmap-breakdown">
          <h3 className="heatmap__breakdown-title">
            {metaForKey(focused.project).label} · {focused.bucketId}
          </h3>
          {breakdown.length === 0 ? (
            <p className="heatmap__breakdown-empty">No usage in this cell.</p>
          ) : (
            <ul className="breakdown" aria-label="Breakdown by source and model">
              {breakdown.map((r) => (
                <li key={r.key} className="breakdown__row">
                  <span
                    className="breakdown__value"
                    data-testid="breakdown-row"
                    data-row-key={r.key}
                    data-row-value={r.value.toString()}
                    data-value-kind={kind}
                  >
                    <span className="breakdown__label">{r.key}</span>
                    <span className="breakdown__figure">{cellFigure(r.value)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="heatmap__hint">Select a cell to see its source · model breakdown.</p>
      )}
    </section>
  );
}
