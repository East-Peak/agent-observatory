import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A headline stat tile: the visible figure over its label, carrying the RAW base-10 integer the frozen
 * oracle reads (data-testid="panel-metric" + data-metric-key/-value + data-value-kind). The house-style
 * metric contract, in the new type scale.
 */
export function StatTile({
  label,
  metricKey,
  kind,
  raw,
  children,
  size = 'md',
  className,
}: {
  readonly label: string;
  readonly metricKey: string;
  readonly kind: 'cost' | 'tokens' | 'count' | 'percent' | 'ratio';
  readonly raw: string;
  readonly children: ReactNode;
  readonly size?: 'md' | 'lg';
  readonly className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        data-testid="panel-metric"
        data-metric-key={metricKey}
        data-metric-value={raw}
        data-value-kind={kind}
        className={cn('font-semibold tracking-tight tabular-nums', size === 'lg' ? 'text-3xl' : 'text-xl')}
      >
        {children}
      </span>
    </div>
  );
}
