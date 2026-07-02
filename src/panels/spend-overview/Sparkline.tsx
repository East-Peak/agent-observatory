import { useId, useState } from 'react';
import type { SpendPoint } from './spendOverviewModel';
import { formatUsdFromPico, formatMonthDay } from '@/ui/format';

const W = 720;
const H = 96;
const PAD = 6;

/** The largest "nice" gridline step (1 / 2 / 5 × 10^k) that yields at most `maxLines` lines up to `max`. */
function niceStep(max: number, maxLines: number): number {
  if (max <= 0) return 0;
  const rough = max / maxLines;
  const pow = 10 ** Math.floor(Math.log10(rough));
  for (const m of [1, 2, 5, 10]) if (m * pow >= rough) return m * pow;
  return 10 * pow;
}

const fmtAxis = (dollars: number): string =>
  dollars >= 1000 ? `$${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(dollars)}`;

/**
 * The daily-spend area chart. Plots normalized cost per day (zero-baselined) as an area + trend line,
 * with the two layers a primary time-series chart owes the reader:
 *   - a HOVER layer — full-height per-day hit columns (bigger than the marks), a crosshair, an
 *     emphasized dot, and a date · exact-$ tooltip; hit columns are focusable so keyboard users get
 *     the same figures via focus + aria-label;
 *   - a RECESSIVE y-scale — up to three hairline gridlines at nice dollar steps with muted labels.
 * Each day still emits the house-style `series-point` carrying the RAW pico-USD `data-point-value`
 * (`data-value-kind="cost"`) — the verifier reads exact integers off the chart, never pixels. The
 * hover/grid layers carry NO house testids, so the frozen oracle contract is untouched.
 */
export function Sparkline({ series, color }: { readonly series: readonly SpendPoint[]; readonly color: string }) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  // Micro-USD numbers for geometry only (display); raw pico-USD BigInts stay on the carriers.
  const values = series.map((p) => Number(p.costPico / 1_000_000n));
  const max = values.length ? Math.max(...values) : 0;
  // An AREA chart's fill encodes magnitude from the baseline, so the y-scale anchors at ZERO — a
  // min-truncated baseline would exaggerate day-to-day variation into cliffs.
  const span = max || 1;
  const stepX = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;

  const yOf = (v: number): number => H - PAD - (v / span) * (H - PAD * 2);
  const xy = (i: number, v: number): readonly [number, number] => [PAD + i * stepX, yOf(v)];

  const line = series.map((_, i) => xy(i, values[i] ?? 0).join(',')).join(' ');
  const area =
    series.length > 0 ? `${PAD},${H - PAD} ${line} ${PAD + (series.length - 1) * stepX},${H - PAD}` : '';
  const lastIdx = series.length - 1;

  // Recessive y-gridlines at nice dollar steps (≤ 3 lines; none when the series is empty/zero).
  const maxDollars = max / 1_000_000;
  const stepDollars = niceStep(maxDollars, 3);
  const gridDollars: number[] = [];
  for (let d = stepDollars; stepDollars > 0 && d <= maxDollars; d += stepDollars) gridDollars.push(d);

  const hoveredPoint = hovered !== null ? series[hovered] : undefined;
  const hoverX = hovered !== null ? PAD + hovered * stepX : 0;
  const hoverLeftPct = (hoverX / W) * 100;

  return (
    <div className="relative">
      <svg
        className="block h-24 w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily normalized spend"
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridDollars.map((d) => (
          <line
            key={d}
            x1={PAD}
            x2={W - PAD}
            y1={yOf(d * 1_000_000)}
            y2={yOf(d * 1_000_000)}
            stroke="var(--color-gridline)"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {series.length > 0 && <polygon points={area} fill={`url(#${gradientId})`} />}
        {series.length > 1 && (
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {hovered !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={PAD}
            y2={H - PAD}
            stroke="#52514e"
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        )}

        {series.map((p, i) => {
          const [x, y] = xy(i, values[i] ?? 0);
          const isLast = i === lastIdx;
          return (
            <circle
              key={p.date}
              data-testid="series-point"
              data-point-value={p.costPico.toString()}
              data-point-date={p.date}
              data-value-kind="cost"
              cx={x}
              cy={y}
              r={isLast ? 3.5 : 1.5}
              style={{ fill: color, fillOpacity: isLast ? 1 : 0.55 }}
            />
          );
        })}

        {/* Emphasis ring over the hovered day's dot (a separate mark — never mutates the carriers). */}
        {hovered !== null && (
          <circle
            cx={hoverX}
            cy={yOf(values[hovered] ?? 0)}
            r={4.5}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        )}

        {/* Full-height per-day hit columns — hover targets bigger than the marks, focusable for
            keyboard parity. No house testids: invisible to the frozen oracle. */}
        {series.map((p, i) => {
          const width = series.length > 1 ? stepX : W - PAD * 2;
          const left = series.length > 1 ? Math.max(0, PAD + i * stepX - stepX / 2) : PAD;
          return (
            <rect
              key={p.date}
              x={left}
              y={0}
              width={Math.min(width, W - left)}
              height={H}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${formatMonthDay(p.date)} · ${formatUsdFromPico(p.costPico)}`}
              className="cursor-crosshair focus:outline-none"
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered((h) => (h === i ? null : h))}
            />
          );
        })}
      </svg>

      {/* Muted axis labels sit just above their gridline (HTML overlay — SVG text would stretch). */}
      {gridDollars.map((d) => (
        <span
          key={d}
          className="pointer-events-none absolute left-1 -translate-y-full rounded-sm bg-card/70 px-0.5 text-[0.6rem] leading-tight tabular-nums text-muted-foreground"
          style={{ top: `${(yOf(d * 1_000_000) / H) * 100}%` }}
          aria-hidden="true"
        >
          {fmtAxis(d)}
        </span>
      ))}

      {hoveredPoint && (
        <div
          className="pointer-events-none absolute top-1 z-10 flex items-baseline gap-2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md"
          style={
            hoverLeftPct > 65
              ? { right: `${100 - hoverLeftPct}%`, marginRight: 8 }
              : { left: `${hoverLeftPct}%`, marginLeft: 8 }
          }
          aria-hidden="true"
        >
          <span className="text-muted-foreground">{formatMonthDay(hoveredPoint.date)}</span>
          <span className="font-semibold tabular-nums text-foreground">{formatUsdFromPico(hoveredPoint.costPico)}</span>
        </div>
      )}
    </div>
  );
}
