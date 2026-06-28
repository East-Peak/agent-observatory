/**
 * VERIFIER-OWNED demo-readiness smoke for `live` Observatory panels.
 *
 * Do NOT weaken, edit, or bypass this file. It is FROZEN for the /goal run — the
 * `verifier-integrity` check in scripts/verify.mjs FAILs if it changes against the
 * `observatory-verifier-baseline` tag. Promoting a panel to `live` in
 * config/panels.json REQUIRES a `*.demo.test.tsx` next to its component that calls
 * `describeLivePanel(...)` (the `panels-have-demo` + `demo-tests-use-harness` checks
 * enforce that), and `npm run verify:demo-ready` runs every such file via
 * vitest.demo.config.ts — so a panel cannot go live on an empty screen or a dead control.
 *
 * This harness is PANEL-AGNOSTIC and imports NO app modules: the panel's Component and
 * its data Provider (the real default FixturesDataSource — NO injected value) are passed
 * in via the config, so the frozen file type-checks at the zero-panel baseline and works
 * for any future panel. `describeLivePanel` proves, reading the RAW house-style values
 * (never the rounded display text):
 *   1. POPULATED   — >=1 `[data-testid="panel-metric"]` of a numeric `data-value-kind`
 *                    whose RAW `data-metric-value` parses (BigInt) to a non-zero integer;
 *   2. PROVENANCE  — a real generated label the caller names actually renders;
 *   3. CLEAN COPY  — no stub / placeholder / off-house-style text;
 *   4. TIME-RANGE  — the range filter exposes Last 7 Days / Last 30 Days / This Month /
 *                    All Time; each renders populated; and a wide vs. narrow window yield
 *                    DIFFERENT raw signatures (a genuine re-filter, not a static panel);
 *   5. SOURCE      — the source filter exposes All / Claude Code / Codex / OpenClaw, and
 *                    narrowing the source changes the raw data AND keeps it populated.
 *
 * Every control assertion uses the mandatory async-settle pattern: after a click it
 * `waitFor`s until the option is ACTIVE (`aria-current="true"`) AND the panel is populated
 * AND (for re-filter proofs) the raw signature has CHANGED from the prior value — so a
 * panel that re-filters via an async effect/query is judged only after its data lands,
 * never on the stale pre-click DOM.
 *
 * `describeScopePersistence` renders the REAL app shell/router, navigates between two live
 * panels, and proves the selected time-range is SHARED (not per-panel state).
 *
 * House-style testid contract a panel must satisfy (see PROGRESS.md / design §4):
 *   - headline metric VALUE -> data-testid="panel-metric" + data-metric-value + data-value-kind;
 *   - breakdown row -> data-testid="breakdown-row" + data-row-key + data-row-value + data-value-kind;
 *   - series point -> data-testid="series-point" + data-point-value + data-value-kind;
 *   - activity item -> data-testid="feed-item" + data-feed-key/-date/-source/-project/
 *     -cost-pico (cost-kind) /-session;
 *   - time-range control -> data-testid="range-filter"; each option -> data-testid="range-option"
 *     with text one of Last 7 Days / Last 30 Days / This Month / All Time; the ACTIVE one
 *     carries aria-current="true";
 *   - source control -> data-testid="source-filter"; each option -> data-testid="source-option"
 *     with text one of All / Claude Code / Codex / OpenClaw; ACTIVE one aria-current="true".
 */
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const REQUIRED_RANGE_LABELS = ['Last 7 Days', 'Last 30 Days', 'This Month', 'All Time'] as const;
const REQUIRED_SOURCE_LABELS = ['All', 'Claude Code', 'Codex', 'OpenClaw'] as const;

/** Raw value-kinds that carry a base-10 integer the populated check can read. */
const NUMERIC_KINDS = new Set(['cost', 'rate', 'ratio', 'percent', 'tokens', 'count']);

/** Default off-house-style / stub copy that must NEVER appear on a live panel. */
const DEFAULT_FORBIDDEN: readonly RegExp[] = [
  /coming soon|under construction/i,
  /lorem ipsum/i,
  /placeholder/i,
  /\bTODO\b/,
];

export interface LivePanelConfig {
  /** Human label used in the test name. */
  readonly name: string;
  /** Route the panel mounts at (real route wiring is proven by describeScopePersistence). */
  readonly route: string;
  /** The panel component, rendered with no props through the default datasource. */
  readonly Component: ComponentType;
  /** The real default data Provider (e.g. the FixturesDataSource provider) with NO injected
   *  value. Omit only if the panel needs no provider. */
  readonly Provider?: ComponentType<{ readonly children: ReactNode }>;
  /** A real generated name/label the populated panel MUST render (provenance). */
  readonly provenance: RegExp | string;
  /** Which controls this panel exposes; each declared one is exercised. */
  readonly controls?: { readonly range?: boolean; readonly source?: boolean };
  /** Extra off-house-style copy to forbid, on top of DEFAULT_FORBIDDEN. */
  readonly forbidden?: readonly RegExp[];
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** RAW integer values behind numeric-kind headline metrics (NOT the rounded text). */
function numericMetricValues(): bigint[] {
  return screen
    .queryAllByTestId('panel-metric')
    .filter((n) => NUMERIC_KINDS.has(n.getAttribute('data-value-kind') ?? ''))
    .map((n) => n.getAttribute('data-metric-value'))
    .filter((v): v is string => v !== null && /^-?\d+$/.test(v))
    .map((v) => BigInt(v));
}

/**
 * Stable raw signature in DOM order over every raw value carrier (metrics, breakdown
 * rows, series points, and feed cost) — so a real re-filter is never masked by formatting.
 */
function rawSignature(): string {
  const parts: string[] = [];
  for (const n of screen.queryAllByTestId('panel-metric')) {
    parts.push(`m:${n.getAttribute('data-metric-value') ?? '∅'}`);
  }
  for (const n of screen.queryAllByTestId('breakdown-row')) {
    parts.push(`r:${n.getAttribute('data-row-key') ?? ''}=${n.getAttribute('data-row-value') ?? '∅'}`);
  }
  for (const n of screen.queryAllByTestId('series-point')) {
    parts.push(`s:${n.getAttribute('data-point-value') ?? '∅'}`);
  }
  for (const n of screen.queryAllByTestId('feed-item')) {
    parts.push(`f:${n.getAttribute('data-feed-key') ?? ''}=${n.getAttribute('data-feed-cost-pico') ?? '∅'}`);
  }
  return parts.join('|');
}

function expectPopulated(where: string): void {
  const vals = numericMetricValues();
  if (vals.length === 0) {
    throw new Error(`${where}: no panel-metric carries a numeric data-metric-value`);
  }
  if (!vals.some((v) => v !== 0n)) {
    throw new Error(`${where}: every panel-metric value is zero — empty screen`);
  }
}

function findOption(filterTestId: string, optionTestId: string, label: string): HTMLElement | null {
  const control = screen.queryByTestId(filterTestId);
  if (!control) return null;
  const opts = within(control).queryAllByTestId(optionTestId);
  return opts.find((o) => norm(o.textContent ?? '').includes(norm(label))) ?? null;
}

function activeLabel(filterTestId: string, optionTestId: string): string | null {
  const control = screen.queryByTestId(filterTestId);
  if (!control) return null;
  const active = within(control)
    .queryAllByTestId(optionTestId)
    .find((o) => o.getAttribute('aria-current') === 'true' || o.getAttribute('data-active') === 'true');
  return active ? norm(active.textContent ?? '') : null;
}

function renderPanel(cfg: LivePanelConfig): void {
  const Page = cfg.Component;
  const Wrap = cfg.Provider;
  const inner: ReactElement = Wrap ? (
    <Wrap>
      <Page />
    </Wrap>
  ) : (
    <Page />
  );
  render(<MemoryRouter initialEntries={[cfg.route]}>{inner}</MemoryRouter>);
}

async function expectPopulatedAndClean(cfg: LivePanelConfig): Promise<void> {
  await screen.findAllByTestId('panel-metric');
  expectPopulated('initial render');
  // Provenance: a real generated name/label flowed through the default datasource.
  expect((await screen.findAllByText(cfg.provenance)).length).toBeGreaterThan(0);
  // No stub / placeholder / off-house-style copy.
  for (const re of [...DEFAULT_FORBIDDEN, ...(cfg.forbidden ?? [])]) {
    expect(screen.queryByText(re)).toBeNull();
  }
}

// Click an option and WAIT until it becomes active AND the panel is populated — so an
// async re-filter is judged only after its data lands, never on the stale pre-click DOM.
async function selectAndSettle(
  filterTestId: string,
  optionTestId: string,
  label: string,
): Promise<string> {
  const opt = findOption(filterTestId, optionTestId, label);
  if (!opt) throw new Error(`"${label}" option not found in ${filterTestId}`);
  fireEvent.click(opt);
  await waitFor(
    () => {
      const active = activeLabel(filterTestId, optionTestId);
      expect(active !== null && active.includes(norm(label))).toBe(true);
      expect(numericMetricValues().some((v) => v !== 0n)).toBe(true);
    },
    { timeout: 2000 },
  );
  return rawSignature();
}

// Like selectAndSettle, but also waits until the signature LEAVES `prevSig` — so it only
// returns once the new scope's data has landed, proving the filter genuinely re-filtered.
async function selectAndSettleDifferentFrom(
  filterTestId: string,
  optionTestId: string,
  label: string,
  prevSig: string,
): Promise<string> {
  const opt = findOption(filterTestId, optionTestId, label);
  if (!opt) throw new Error(`"${label}" option not found in ${filterTestId}`);
  fireEvent.click(opt);
  await waitFor(
    () => {
      const active = activeLabel(filterTestId, optionTestId);
      expect(active !== null && active.includes(norm(label))).toBe(true);
      expect(numericMetricValues().some((v) => v !== 0n)).toBe(true);
      expect(rawSignature()).not.toBe(prevSig);
    },
    { timeout: 2000 },
  );
  return rawSignature();
}

async function expectRangeFilterWorks(): Promise<void> {
  const control = await screen.findByTestId('range-filter');
  expect(within(control).queryAllByTestId('range-option').length).toBeGreaterThanOrEqual(4);
  for (const label of REQUIRED_RANGE_LABELS) {
    if (!findOption('range-filter', 'range-option', label)) {
      throw new Error(`time-range filter is missing the "${label}" option`);
    }
  }
  // Each named window renders populated...
  await selectAndSettle('range-filter', 'range-option', 'Last 30 Days');
  await selectAndSettle('range-filter', 'range-option', 'This Month');
  const wideSig = await selectAndSettle('range-filter', 'range-option', 'All Time');
  // ...and a wide window (All Time) vs. a narrow one (Last 7 Days) over a real multi-day
  // series MUST yield different raw data. Waiting for the signature to leave wideSig also
  // guarantees the new window's data landed before we judge it (robust to async recompute).
  await selectAndSettleDifferentFrom('range-filter', 'range-option', 'Last 7 Days', wideSig);
  // Leave the panel on a fully-populated default so the source test starts clean.
  await selectAndSettle('range-filter', 'range-option', 'Last 30 Days');
}

async function expectSourceFilterWorks(): Promise<void> {
  const control = await screen.findByTestId('source-filter');
  expect(within(control).queryAllByTestId('source-option').length).toBeGreaterThanOrEqual(4);
  for (const label of REQUIRED_SOURCE_LABELS) {
    if (!findOption('source-filter', 'source-option', label)) {
      throw new Error(`source filter is missing the "${label}" option`);
    }
  }
  const allSig = await selectAndSettle('source-filter', 'source-option', 'All');
  // Narrowing to a single source (Claude Code) must change the data away from All.
  await selectAndSettleDifferentFrom('source-filter', 'source-option', 'Claude Code', allSig);
  // Leave it on All so a subsequent control test starts from the full scope.
  await selectAndSettle('source-filter', 'source-option', 'All');
}

/**
 * Registers the verifier-owned demo-readiness suite for one `live` panel.
 * Call at the top level of `<Panel>.demo.test.tsx`.
 */
export function describeLivePanel(cfg: LivePanelConfig): void {
  describe(`${cfg.name} — demo readiness (verifier-owned)`, () => {
    it('renders populated, real synthetic data with working range + source controls', async () => {
      renderPanel(cfg);
      await expectPopulatedAndClean(cfg);
      if (cfg.controls?.range) await expectRangeFilterWorks();
      if (cfg.controls?.source) await expectSourceFilterWorks();
    });
  });
}

export interface ScopePersistenceConfig {
  /** Human label used in the test name. */
  readonly name: string;
  /** Render the REAL app shell/router (so navigation + shared scope are exercised). */
  readonly renderApp: () => void;
  /** Accessible text of the nav link to a DIFFERENT live panel. */
  readonly toNav: RegExp | string;
  /** Text unique to the destination panel — proves navigation actually happened. */
  readonly toRouteText: RegExp | string;
}

/**
 * Proves the time-range selection is SHARED across REAL navigation — not per-panel state —
 * and that the destination route renders. The shared scope-bar demo test calls this with
 * the real app routes.
 */
export function describeScopePersistence(cfg: ScopePersistenceConfig): void {
  describe(`${cfg.name} — shared scope persists across navigation (verifier-owned)`, () => {
    it('keeps the selected time-range when navigating to another panel', async () => {
      cfg.renderApp();
      // Wait for the shared scope bar to mount (the app may load fixtures async).
      await screen.findByTestId('range-filter');
      // Select a non-default range on the first screen.
      const probe =
        findOption('range-filter', 'range-option', 'All Time') ??
        findOption('range-filter', 'range-option', 'This Month');
      if (!probe) throw new Error('no range filter on the initial screen');
      fireEvent.click(probe);
      const activeBefore = activeLabel('range-filter', 'range-option');
      expect(activeBefore).not.toBeNull();
      // Navigate via the REAL nav link.
      fireEvent.click(await screen.findByText(cfg.toNav));
      // Navigation actually happened to the destination panel.
      expect((await screen.findAllByText(cfg.toRouteText)).length).toBeGreaterThan(0);
      // The shared scope bar is present there with the SAME range still active.
      await screen.findByTestId('range-filter');
      await waitFor(() => {
        expect(activeLabel('range-filter', 'range-option')).toBe(activeBefore);
      });
    });
  });
}
