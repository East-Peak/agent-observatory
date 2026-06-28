import { describeLivePanel } from '@/test-support/observatoryPanelSmoke';
import { PanelProviders } from '@/app/PanelProviders';
import { CacheEfficiencyPanel } from './CacheEfficiencyPanel';

// Verifier-owned demo-readiness suite for the LIVE cacheEfficiency panel: rendered through the real
// default FixturesDataSource, proven populated + provenance-stamped, BOTH scope controls re-filtering.
describeLivePanel({
  name: 'cacheEfficiency',
  route: '/cache-efficiency',
  Component: CacheEfficiencyPanel,
  Provider: PanelProviders,
  provenance: /As of 2026-06-27/,
  controls: { range: true, source: true },
});
