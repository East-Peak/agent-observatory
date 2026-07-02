import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// shadcn/ui Card — surface primitive. Props (incl. data-* like data-panel-root) flow through.
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-card text-card-foreground flex flex-col gap-5 rounded-xl border border-border p-5 shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex items-start justify-between gap-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
}

export function CardEyebrow({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-eyebrow"
      className={cn('text-[0.7rem] font-medium uppercase tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('flex flex-col gap-4', className)} {...props} />;
}
