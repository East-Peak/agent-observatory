import { createContext, useContext, type ReactNode } from 'react';
import type { DataSource } from './DataSource';
import { fixturesDataSource } from './FixturesDataSource';

const DataSourceContext = createContext<DataSource | null>(null);

/**
 * Provides the {@link DataSource} the app reads through. With no `source` prop it supplies the
 * default `FixturesDataSource`; passing `source` is the `value`-injection seam tests use (the
 * `pipeline-coupling` proof injects a fixtures source built with a scaled rate card).
 */
export function DataSourceProvider({
  children,
  source,
}: {
  readonly children: ReactNode;
  readonly source?: DataSource;
}) {
  return (
    <DataSourceContext.Provider value={source ?? fixturesDataSource}>{children}</DataSourceContext.Provider>
  );
}

export function useDataSource(): DataSource {
  const ctx = useContext(DataSourceContext);
  if (!ctx) {
    throw new Error('useDataSource must be used within a <DataSourceProvider>');
  }
  return ctx;
}
