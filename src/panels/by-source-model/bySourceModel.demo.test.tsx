import { describeLivePanel } from '@/test-support/observatoryPanelSmoke';
import { PanelProviders } from '@/app/PanelProviders';
import { BySourceModelPanel } from './BySourceModelPanel';

// Verifier-owned demo-readiness suite for the LIVE bySourceModel panel: rendered through the real
// default FixturesDataSource, proven populated + provenance-stamped, with BOTH scope controls
// genuinely re-filtering the raw house-style values.
describeLivePanel({
  name: 'bySourceModel',
  route: '/by-source-model',
  Component: BySourceModelPanel,
  Provider: PanelProviders,
  provenance: /As of 2026-06-27/,
  controls: { range: true, source: true },
});
