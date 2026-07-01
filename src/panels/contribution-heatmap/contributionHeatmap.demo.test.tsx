import { describeLivePanel } from '@/test-support/observatoryPanelSmoke';
import { PanelProviders } from '@/app/PanelProviders';
import { ContributionHeatmapPanel } from './ContributionHeatmapPanel';

// Verifier-owned demo-readiness suite for the LIVE contributionHeatmap: rendered through the real
// default FixturesDataSource, proven populated (its coloured cells carry the raw values) + provenance-
// stamped, with BOTH scope controls genuinely re-filtering — narrowing the source to Claude Code drops
// the Tools strip, so the raw signature changes.
describeLivePanel({
  name: 'contributionHeatmap',
  route: '/contribution',
  Component: ContributionHeatmapPanel,
  Provider: PanelProviders,
  provenance: /As of 2026-06-27/,
  controls: { range: true, source: true },
});
