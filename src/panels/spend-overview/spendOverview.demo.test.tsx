import { describeLivePanel } from '@/test-support/observatoryPanelSmoke';
import { PanelProviders } from '@/app/PanelProviders';
import { SpendOverviewPanel } from './SpendOverviewPanel';

// Verifier-owned demo-readiness suite for the LIVE spendOverview panel. The frozen
// describeLivePanel renders this through the real default FixturesDataSource and proves it is
// populated with real synthetic data, provenance-stamped, clean, and that BOTH controls
// genuinely re-filter (async-settled on the RAW house-style values).
describeLivePanel({
  name: 'spendOverview',
  route: '/',
  Component: SpendOverviewPanel,
  Provider: PanelProviders,
  // A snapshot-derived label the populated panel must render (proves real data flowed).
  provenance: /As of 2026-06-27/,
  controls: { range: true, source: true },
});
