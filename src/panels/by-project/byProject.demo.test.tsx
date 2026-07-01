import { describeLivePanel } from '@/test-support/observatoryPanelSmoke';
import { PanelProviders } from '@/app/PanelProviders';
import { ByProjectPanel } from './ByProjectPanel';

// Verifier-owned demo-readiness suite for the LIVE byProject panel: rendered through the real default
// FixturesDataSource, proven populated + provenance-stamped, with the time-range control genuinely
// re-filtering the raw values. Source is NOT exercised here: the project grid is Claude-only (Codex /
// OpenClaw are tool sentinels, excluded), so `All` and `Claude Code` yield the SAME leaderboard — the
// oracle's own scope matrix proves source scoping (Codex → the empty state) independently.
describeLivePanel({
  name: 'byProject',
  route: '/by-project',
  Component: ByProjectPanel,
  Provider: PanelProviders,
  provenance: /As of 2026-06-27/,
  controls: { range: true, source: false },
});
