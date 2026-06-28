import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RangeKey } from '@/domain/dateRange';
import type { SourceKey } from '@/domain/sources';

/** The dashboard-wide scope: a time-range and a source filter, shared across every panel. */
export interface Scope {
  readonly range: RangeKey;
  readonly source: SourceKey;
}

export interface ScopeContextValue {
  readonly scope: Scope;
  setRange(range: RangeKey): void;
  setSource(source: SourceKey): void;
}

const DEFAULT_SCOPE: Scope = { range: 'last30', source: 'all' };

const ScopeContext = createContext<ScopeContextValue | null>(null);

/**
 * Holds the shared scope. A single instance lives above the router in the app shell, so the
 * selection persists across navigation (each panel renders its own `<ScopeBar>` but reads and
 * writes this one state — that is what `describeScopePersistence` proves). `initialScope` lets
 * tests pin a deterministic (range, source) starting point.
 */
export function ScopeProvider({
  children,
  initialScope,
}: {
  readonly children: ReactNode;
  readonly initialScope?: Scope;
}) {
  const [scope, setScope] = useState<Scope>(initialScope ?? DEFAULT_SCOPE);
  const value = useMemo<ScopeContextValue>(
    () => ({
      scope,
      setRange: (range) => setScope((s) => ({ ...s, range })),
      setSource: (source) => setScope((s) => ({ ...s, source })),
    }),
    [scope],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) {
    throw new Error('useScope must be used within a <ScopeProvider>');
  }
  return ctx;
}
