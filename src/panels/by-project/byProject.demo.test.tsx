import { describeLivePanel } from '@/test-support/observatoryPanelSmoke';
import { PanelProviders } from '@/app/PanelProviders';
import { ByProjectPanel } from './ByProjectPanel';

// Verifier-owned demo-readiness suite for the LIVE byProject panel: rendered through the real default
// FixturesDataSource, proven populated + provenance-stamped, with BOTH scope controls genuinely applying.
// The project grid is Claude-only (Codex / OpenClaw are tool sentinels, excluded), so `All` and
// `Claude Code` yield the SAME leaderboard — the source control is proven instead by narrowing to Codex,
// which empties the grid to the frozen `byproject-empty` state (the smoke accepts this alternative proof).
describeLivePanel({
  name: 'byProject',
  route: '/by-project',
  Component: ByProjectPanel,
  Provider: PanelProviders,
  provenance: /As of 2026-06-27/,
  controls: { range: true, source: true },
});
