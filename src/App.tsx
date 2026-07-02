import type { ReactNode } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { DataSourceProvider } from '@/data/DataSourceContext';
import type { DataSource } from '@/data/DataSource';
import { ScopeProvider, type Scope } from '@/app/ScopeProvider';
import { SpendOverviewPanel } from '@/panels/spend-overview/SpendOverviewPanel';
import { BySourceModelPanel } from '@/panels/by-source-model/BySourceModelPanel';
import { CacheEfficiencyPanel } from '@/panels/cache-efficiency/CacheEfficiencyPanel';
import { ActivityFeedPanel } from '@/panels/activity-feed/ActivityFeedPanel';
import { ByProjectPanel } from '@/panels/by-project/ByProjectPanel';
import { ContributionHeatmapPanel } from '@/panels/contribution-heatmap/ContributionHeatmapPanel';
import { cn } from '@/lib/utils';

/**
 * The live panels wired into the shell. Promoting a panel to `live` adds its row here AND a
 * matching `<Route>` in {@link AppRoutes}. The route paths MUST match `config/panels.json`
 * (`config.panels[key].route`) — the frozen panel oracle renders each live panel by navigating
 * the REAL `<AppShell>` route table to that path, so a mis-wired or unreachable route FAILs the
 * oracle (it finds no panel / no nav link).
 */
const NAV = [
  { to: '/', label: 'Spend Overview' },
  { to: '/by-source-model', label: 'By Source & Model' },
  { to: '/cache-efficiency', label: 'Cache Efficiency' },
  { to: '/activity-feed', label: 'Activity Feed' },
  { to: '/by-project', label: 'By Project' },
  { to: '/contribution', label: 'Contribution Heatmap' },
] as const;

/** The REAL route table (router-agnostic). Shared by production `<App>` and the frozen oracle. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SpendOverviewPanel />} />
      <Route path="/by-source-model" element={<BySourceModelPanel />} />
      <Route path="/cache-efficiency" element={<CacheEfficiencyPanel />} />
      <Route path="/activity-feed" element={<ActivityFeedPanel />} />
      <Route path="/by-project" element={<ByProjectPanel />} />
      <Route path="/contribution" element={<ContributionHeatmapPanel />} />
    </Routes>
  );
}

/** The app chrome (brand + shared nav + routed main). Mounted inside whatever Router wraps it. */
export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <div className="flex items-center gap-2">
            <span
              className="h-4 w-4 shrink-0 rounded-[4px] bg-gradient-to-br from-[var(--color-source-claude)] to-[var(--color-heat-4)]"
              aria-hidden="true"
            />
            <h1 className="text-sm font-semibold tracking-tight">Agent Observatory</h1>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              local-first · normalized agent cost &amp; activity
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Panels">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 transition-colors',
                    isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        <AppRoutes />
      </main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-muted-foreground">
        Estimated, normalized from one rate card · tokens are the universal unit · subscription marginal cost ≠ billed
      </footer>
    </div>
  );
}

/**
 * The shared provider envelope (data source + scope) that sits ABOVE the router, so the selected
 * scope persists across navigation. `dataSource` / `initialScope` are the verifier-owned seams:
 * the frozen panel oracle injects a scaled rate card (`dataSource`) and pins a deterministic
 * `initialScope` to prove value-equality + rate-card coupling on the REAL route. Production passes
 * neither, so the app runs on the default `FixturesDataSource` + default scope.
 */
export function AppProviders({
  children,
  dataSource,
  initialScope,
}: {
  readonly children: ReactNode;
  readonly dataSource?: DataSource;
  readonly initialScope?: Scope;
}) {
  return (
    <DataSourceProvider {...(dataSource ? { source: dataSource } : {})}>
      <ScopeProvider {...(initialScope ? { initialScope } : {})}>{children}</ScopeProvider>
    </DataSourceProvider>
  );
}

/**
 * The app shell: shared scope + data source above the router, so scope persists across panels.
 * Production (`main.tsx`) passes the ingested real `dataSource`; with none, it defaults to the
 * committed fixtures (the oracle/demo path injects its own source via {@link AppProviders}).
 */
export default function App({ dataSource }: { readonly dataSource?: DataSource } = {}) {
  return (
    <AppProviders {...(dataSource ? { dataSource } : {})}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AppProviders>
  );
}
