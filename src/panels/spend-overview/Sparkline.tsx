import { useId } from 'react';
import type { SpendPoint } from './spendOverviewModel';

const W = 720;
const H = 96;
const PAD = 6;

/**
 * The daily-spend sparkline. Plots normalized cost per day as an area + trend line with a
 * highlighted latest point. Each day is also emitted as a house-style `series-point` carrying
 * the RAW pico-USD `data-point-value` (`data-value-kind="cost"`) — so the verifier reads exact
 * integers off the chart, never the rendered pixels. Plotting itself uses floats (display only).
 */
export function Sparkline({ series, color }: { readonly series: readonly SpendPoint[]; readonly color: string }) {
  const gradientId = useId();
  const values = series.map((p) => Number(p.costPico));
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const span = max - min || 1;
  const stepX = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;

  const xy = (i: number, v: number): readonly [number, number] => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
    return [x, y];
  };

  const line = series.map((p, i) => xy(i, Number(p.costPico)).join(',')).join(' ');
  const area =
    series.length > 0
      ? `${PAD},${H - PAD} ${line} ${PAD + (series.length - 1) * stepX},${H - PAD}`
      : '';
  const lastIdx = series.length - 1;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Daily normalized spend"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {series.length > 0 && <polygon className="sparkline__area" points={area} fill={`url(#${gradientId})`} />}
      {series.length > 1 && <polyline className="sparkline__line" points={line} fill="none" stroke={color} />}
      {series.map((p, i) => {
        const [x, y] = xy(i, Number(p.costPico));
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
            className={isLast ? 'sparkline__dot sparkline__dot--last' : 'sparkline__dot'}
            style={isLast ? { fill: color } : undefined}
          />
        );
      })}
    </svg>
  );
}
