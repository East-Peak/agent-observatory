import type { ReactNode } from 'react';
import { DataSourceProvider } from '@/data/DataSourceContext';
import { ScopeProvider } from './ScopeProvider';

/**
 * The default context envelope a panel needs to run standalone: the real default
 * `FixturesDataSource` (NO injected value) plus a fresh shared-scope store. The frozen
 * `describeLivePanel` smoke renders `<PanelProviders><Panel/></PanelProviders>`, so a panel is
 * judged exactly as it runs in the app — on real synthetic data, with live controls.
 */
export function PanelProviders({ children }: { readonly children: ReactNode }) {
  return (
    <DataSourceProvider>
      <ScopeProvider>{children}</ScopeProvider>
    </DataSourceProvider>
  );
}
