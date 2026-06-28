import type { ReactNode } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { DataSourceProvider } from '@/data/DataSourceContext';
import type { DataSource } from '@/data/DataSource';
import { ScopeProvider, type Scope } from '@/app/ScopeProvider';
import { SpendOverviewPanel } from '@/panels/spend-overview/SpendOverviewPanel';

/**
 * The live panels wired into the shell. Promoting a panel to `live` adds its row here AND a
 * matching `<Route>` in {@link AppRoutes}. The route paths MUST match `config/panels.json`
 * (`config.panels[key].route`) — the frozen panel oracle renders each live panel by navigating
 * the REAL `<AppShell>` route table to that path, so a mis-wired or unreachable route FAILs the
 * oracle (it finds no panel / no nav link).
 */
const NAV = [{ to: '/', label: 'Spend Overview' }] as const;

/** The REAL route table (router-agnostic). Shared by production `<App>` and the frozen oracle. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SpendOverviewPanel />} />
    </Routes>
  );
}

/** The app chrome (brand + shared nav + routed main). Mounted inside whatever Router wraps it. */
export function AppShell() {
  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__brand">
          <span className="app__mark" aria-hidden="true" />
          <h1 className="app__name">Agent Observatory</h1>
          <span className="app__tag">local-first · normalized agent cost &amp; activity</span>
        </div>
        <nav className="app__nav" aria-label="Panels">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => (isActive ? 'app__navlink app__navlink--active' : 'app__navlink')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app__main">
        <AppRoutes />
      </main>
      <footer className="app__foot">
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

/** The app shell: shared scope + data source above the router, so scope persists across panels. */
export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AppProviders>
  );
}
