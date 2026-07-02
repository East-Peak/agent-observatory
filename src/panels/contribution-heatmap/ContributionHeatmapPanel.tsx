import { useState } from 'react';
import { useDataSource } from '@/data/DataSourceContext';
import { useScope } from '@/app/ScopeProvider';
import { ScopeBar } from '@/app/ScopeBar';
import { Card, CardEyebrow, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { metaForKey } from '@/domain/projects';
import { formatUsdFromPico, formatTokensCompact, formatMonthDay } from '@/ui/format';
import {
  selectContributionHeatmap,
  selectCellBreakdown,
  type Bucket,
  type Metric,
  type HeatmapCell,
} from './contributionHeatmapModel';

// GitHub-dark contribution ramp, bins 0..4 (near-surface → brightest). CONCRETE hex, applied INLINE —
// the frozen oracle reads style.backgroundColor and requires a distinct, resolvable colour per bin, so
// this must never become a CSS variable or utility class.
const RAMP = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'] as const;
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
  project:
    'No repository or unattributed usage in this scope — switch the source to Claude Code or All to see the project grid.',
  tool: 'No tool (Codex / OpenClaw) usage in this scope — the Tools strip appears under the All or a tool source.',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (bucketId: string): string => MONTHS[Number(bucketId.slice(5, 7)) - 1] ?? '';

/** shadcn-style segmented control. Keeps the frozen testid/aria-current contract the smoke + oracle drive. */
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
    <div className="flex items-center gap-2" data-testid={filterId} role="group" aria-label={label}>
      <span className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {options.map((opt) => {
          const isActive = active === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              data-testid={optionId}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelect(opt.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ContributionHeatmapPanel() {
  const dataSource = useDataSource();
  const { scope } = useScope();
  const [bucket, setBucket] = useState<Bucket>('day');
  const [metric, setMetric] = useState<Metric>('tokens');
  const [focused, setFocused] = useState<{ readonly project: string; readonly bucketId: string } | null>(null);
  const [hovered, setHovered] = useState<HeatmapCell | null>(null);

  const snapshot = dataSource.getSnapshot();
  const card = dataSource.getRateCard();
  const model = selectContributionHeatmap(snapshot, card, scope.range, scope.source, bucket, metric);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === scope.range)?.label ?? '';
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.key === scope.source)?.label ?? '';
  const kind = metric === 'tokens' ? 'tokens' : 'cost';
  const figure = (value: bigint): string =>
    metric === 'tokens' ? `${formatTokensCompact(Number(value))} tokens` : formatUsdFromPico(value);

  const toggleFocus = (project: string, bucketId: string): void =>
    setFocused((cur) => (cur && cur.project === project && cur.bucketId === bucketId ? null : { project, bucketId }));

  const breakdown = focused
    ? selectCellBreakdown(snapshot, card, scope.range, scope.source, bucket, metric, focused.project, focused.bucketId)
    : [];

  // GitHub-style sparse month axis: label each month at its first column, but ONLY if it spans enough
  // columns to hold the label — so a lone boundary day (e.g. May 31 before a full June) doesn't collide.
  const monthFirstCol = new Map<string, number>();
  const monthSpan = new Map<string, number>();
  model.buckets.forEach((b, i) => {
    const m = b.slice(0, 7);
    if (!monthFirstCol.has(m)) monthFirstCol.set(m, i);
    monthSpan.set(m, (monthSpan.get(m) ?? 0) + 1);
  });
  const monthTicks = model.buckets.map((b, i) => {
    const m = b.slice(0, 7);
    return monthFirstCol.get(m) === i && (monthSpan.get(m) ?? 0) >= 3 ? monthOf(b) : '';
  });

  return (
    <Card
      data-panel-root="contributionHeatmap"
      aria-labelledby="contribution-heatmap-title"
      className="gap-4"
    >
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardEyebrow>Usage allocation · contribution grid</CardEyebrow>
          <CardTitle id="contribution-heatmap-title">Contribution Heatmap</CardTitle>
          <p className="text-xs text-muted-foreground">
            As of {snapshot.asOf} · {formatMonthDay(model.from)} – {formatMonthDay(model.to)}
          </p>
        </div>
        <div className="shrink-0 rounded-md bg-muted/50 px-2 py-1 text-xs text-secondary-foreground">
          {rangeLabel} · {sourceLabel}
        </div>
      </CardHeader>

      <ScopeBar />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <Segmented filterId="bucket-filter" optionId="bucket-option" options={BUCKETS} active={bucket} onSelect={setBucket} label="Bucket" />
          <Segmented filterId="metric-filter" optionId="metric-option" options={METRICS} active={metric} onSelect={setMetric} label="Metric" />
        </div>
        <div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
          <span>Less</span>
          {RAMP.map((c, i) => (
            <span key={i} className="h-3 w-3 rounded-[3px] ring-1 ring-inset ring-white/5" style={{ backgroundColor: c }} />
          ))}
          <span>More</span>
        </div>
      </div>

      {/* Hover / focus readout — the per-cell detail (dataviz hover intent), kept as a stable line. */}
      <p className="min-h-[1.25rem] text-xs text-secondary-foreground" aria-live="polite">
        {hovered
          ? `${metaForKey(hovered.projectKey).label} · ${hovered.bucketId} · ${figure(hovered.value)}`
          : 'Hover a cell for its total · click to break it down by source and model.'}
      </p>

      <div className="flex flex-col gap-5 overflow-x-auto">
        {model.sections.map((sec) =>
          sec.isEmpty ? (
            <p
              key={sec.section}
              className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground"
              data-testid="heatmap-empty"
              data-empty-section={sec.section}
              data-empty-reason={EMPTY_PROSE[sec.section]}
            >
              {EMPTY_PROSE[sec.section]}
            </p>
          ) : (
            <section key={sec.section} data-section={sec.section} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {sec.section === 'project' ? 'Projects' : 'Tools'}
              </h3>
              {/* Sparse month axis, aligned to the cell columns via the same 15px track. */}
              <div className="flex pl-[8.5rem] text-[0.65rem] text-muted-foreground">
                {monthTicks.map((m, i) => (
                  <span key={i} className="w-[15px] shrink-0 overflow-visible whitespace-nowrap">
                    {m}
                  </span>
                ))}
              </div>
              {sec.rows.map((row) => (
                <div key={row.projectKey} className="flex items-center gap-1">
                  <span
                    className="w-[8rem] shrink-0 truncate pr-2 text-right text-xs text-secondary-foreground"
                    title={row.label}
                  >
                    {row.label}
                  </span>
                  <div className="flex gap-[3px]">
                    {row.cells.map((cell) => {
                      const isFocused = focused?.project === cell.projectKey && focused?.bucketId === cell.bucketId;
                      return (
                        <button
                          key={cell.bucketId}
                          type="button"
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
                          className={cn(
                            'h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-white/5 transition-[outline]',
                            'hover:outline hover:outline-1 hover:outline-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                            isFocused && 'outline outline-2 outline-white',
                          )}
                          aria-label={`${row.label} · ${cell.bucketId} · ${figure(cell.value)}`}
                          aria-pressed={isFocused}
                          onMouseEnter={() => setHovered(cell)}
                          onMouseLeave={() => setHovered((h) => (h === cell ? null : h))}
                          onClick={() => toggleFocus(cell.projectKey, cell.bucketId)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ),
        )}
      </div>

      {focused ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4" data-testid="heatmap-breakdown">
          <h3 className="text-sm font-semibold">
            {metaForKey(focused.project).label} · {focused.bucketId}
          </h3>
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage in this cell.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {breakdown.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-4 text-sm">
                  <span
                    data-testid="breakdown-row"
                    data-row-key={r.key}
                    data-row-value={r.value.toString()}
                    data-value-kind={kind}
                    className="flex w-full items-center justify-between gap-4"
                  >
                    <span className="text-secondary-foreground">{r.key}</span>
                    <span className="tabular-nums text-foreground">{figure(r.value)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  );
}
