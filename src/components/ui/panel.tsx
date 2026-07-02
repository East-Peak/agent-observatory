import type { ReactNode } from 'react';
import { ScopeBar } from '@/app/ScopeBar';
import { formatMonthDay } from '@/ui/format';
import { Card, CardEyebrow, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The shared panel envelope: a Card carrying the frozen `data-panel-root`, the house-style header
 * (eyebrow / title / provenance), a scope chip (or a custom `aside`), and the shared ScopeBar. Every
 * panel renders one, so the shell is one system.
 */
export function PanelShell({
  panelKey,
  titleId,
  eyebrow,
  title,
  asOf,
  from,
  to,
  scopeLabel,
  aside,
  children,
}: {
  readonly panelKey: string;
  readonly titleId: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly scopeLabel?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card data-panel-root={panelKey} aria-labelledby={titleId} className="gap-4">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardEyebrow>{eyebrow}</CardEyebrow>
          <CardTitle id={titleId}>{title}</CardTitle>
          <p className="text-xs text-muted-foreground">
            As of {asOf} · {formatMonthDay(from)} – {formatMonthDay(to)}
          </p>
        </div>
        {aside ?? (
          <div className="shrink-0 rounded-md bg-muted/50 px-2 py-1 text-xs text-secondary-foreground">{scopeLabel}</div>
        )}
      </CardHeader>
      <ScopeBar />
      {children}
    </Card>
  );
}
