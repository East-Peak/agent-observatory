/**
 * FROZEN verifier-owned PANEL ORACLE. Do NOT weaken, edit, or bypass.
 *
 * This file is FROZEN for the /goal run — `verifier-integrity` in scripts/verify.mjs FAILs if it
 * changes against the `observatory-verifier-baseline` tag. It is the thing the `panel-golden`,
 * `pipeline-coupling`, and `scope-persistence` gates TRUST. The loop-authored `*.demo.test.tsx`
 * (run by `panel-smoke`) remain for dev speed, but they are NOT load-bearing for correctness.
 *
 * WHY a frozen vitest oracle (not the tsx emitter used for normalization-golden): rendering the
 * real `<App>` route tree needs jsdom + the `@/*` path alias + React act() — which vitest already
 * provides and a raw tsx node script does not. scripts/verify.mjs runs THIS file via the frozen
 * vitest.oracle.config.ts and reads the machine-readable result it writes to
 * `.verify-logs/panel-oracle-result.json`. PROVENANCE: verify.mjs injects a fresh per-run nonce
 * via `ORACLE_RUN_NONCE`; this file echoes it into the result, and verify.mjs accepts the result
 * ONLY if the vitest process exited 0 AND the echoed nonce matches — so a forged/stale result file
 * (or a non-zero oracle run) can never green the gate (Codex r2 blocker #1).
 *
 * For EVERY `live` panel (config/panels.json → status:"live"), the oracle proves three things:
 *
 *   1. VALUE-EQUALITY — renders the panel through the REAL `<AppShell>` route table at the panel's
 *      FROZEN route (taken from this file's REGISTRY, and asserted to match config — a route can't
 *      be re-pointed to a different component), requires exactly ONE VISIBLE `data-panel-root="<key>"`
 *      element, and reads the RAW `data-*-value` carriers ONLY within that root — each carrier
 *      element ITSELF asserted visible (so a mutable shell can satisfy the gate with neither
 *      hidden/extra carriers elsewhere in the document — Codex r2 blocker #2 — nor the exact
 *      verifier carriers hidden inside the root — Codex r3 blocker). The read values must EQUAL
 *      values recomputed here, from the FROZEN synthetic
 *      snapshot, by an INDEPENDENT pipeline: UTC calendar windowing implemented in THIS file
 *      (native-Date ordinals — NOT the app's `dateRange`) + the anchored `normalizeCost` (golden +
 *      property gates) + an INDEPENDENT inline band selection (this file's `selectBandInline`, NOT
 *      the app's `selectBand` — Codex r2 major #3). Comparison is a counted MULTISET, so a duplicated
 *      metric/row/series/feed carrier violates the "one per" contract and FAILs (Codex r2 major #5).
 *      So a hardcoded, mis-windowed, or pipeline-bypassing panel mismatches and FAILs. For panels
 *      that also have a hand-derived entry in the frozen `panel-golden.json` (spendOverview), the
 *      recompute is additionally triangulated against those human-audited values.
 *
 *   2. PIPELINE-COUPLING — re-renders the same route with the rate card scaled by each frozen
 *      `scale-factors.json` factor `k` (injected through the DataSource seam) and asserts every
 *      `cost`/`rate`-kind raw value scales by exactly `k` while `tokens`/`count`/`ratio`/`percent`/
 *      `date`/`label`-kind values stay invariant. A panel that hardcodes cost or ignores the card
 *      cannot reproduce that.
 *
 *   3. SCOPE-PERSISTENCE MATRIX — at >=2 live panels, for every ordered pair it navigates the REAL
 *      nav between the two routes and asserts BOTH the selected time-range AND a NON-DEFAULT source
 *      filter are SHARED (not per-panel) AND the destination renders populated within its own
 *      `data-panel-root` AND is reachable via a real nav link. Asserting the source dimension too
 *      means a shell that resets the source on navigation FAILs (Codex r2 major #4).
 *
 * The per-panel DOM contract (frozen here) — the loop must build each panel to emit exactly these
 * house-style testids/values; an unknown live panel with no spec is an automatic FAIL:
 *   - spendOverview  (route /):                 metrics total-cost(cost) total-tokens(tokens)
 *                                               active-days(count) delta-cost(cost) delta-pct(percent);
 *                                               one series-point(cost) per active day (data-point-date).
 *   - bySourceModel  (route /by-source-model):  metric total-cost(cost); one breakdown-row(cost) per
 *                                               (source,model) keyed `source|model` (data-row-value).
 *   - cacheEfficiency(route /cache-efficiency): metrics cache-read-tokens(tokens)
 *                                               cache-creation-tokens(tokens) fresh-input-tokens(tokens)
 *                                               saved-cost(cost).
 *   - activityFeed   (route /activity-feed):    metric total-cost(cost); one feed-item per scoped
 *                                               record keyed `source|date|model` carrying
 *                                               data-feed-cost-pico(cost) + data-feed-date + data-feed-source.
 * Every live panel additionally renders the shared ScopeBar (range-filter + source-filter) — the
 * recompute applies the SAME (range, source) scope to all panels.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AppProviders, AppShell } from '@/App';
import { createFixturesDataSource } from '@/data/FixturesDataSource';
import type { DataSource } from '@/data/DataSource';
import { normalizeCost, type RateBand, type RateCard } from '@/domain/normalizeCost';
// quantileScale is FROZEN (src/domain/intensity.ts) + anchored by intensity.test, so the oracle TRUSTS
// it (as it trusts normalizeCost) — the panel feeds it the same scale, so dom-vs-recompute verifies the
// panel computed the right per-section cell values + applied the bins, not the (frozen) quantile itself.
import { quantileScale } from '@/domain/intensity';
import type { Snapshot, UsageRecord } from '@/domain/types';
import type { RangeKey } from '@/domain/dateRange';
import type { SourceKey } from '@/domain/sources';
import type { Scope } from '@/app/ScopeProvider';

import panelsJson from '../../config/panels.json';
import snapshotJson from '../../data/fixtures/synthetic-snapshot.json';
import rateCardJson from '../../rateCard.json';
import scaleFactorsJson from '../../data/fixtures/scale-factors.json';
import panelGoldenJson from '../../data/fixtures/panel-golden.json';

// ---- frozen inputs ----------------------------------------------------------------------

const SNAPSHOT = snapshotJson as unknown as { asOf: string; records: UsageRecord[] };
const RECORDS: readonly UsageRecord[] = SNAPSHOT.records;
const ASOF = SNAPSHOT.asOf;
const RATE_CARD = rateCardJson as unknown as RateCard;
const FACTORS = (scaleFactorsJson as unknown as { factors: number[] }).factors;

interface PanelsConfig {
  readonly panels: Record<string, { readonly status: string; readonly dir: string; readonly route: string }>;
}
const PANELS_CONFIG = panelsJson as unknown as PanelsConfig;

interface GoldenMetric {
  readonly value: string;
  readonly kind: string;
}
interface GoldenState {
  readonly range: string;
  readonly source: string;
  readonly metrics: Record<string, GoldenMetric>;
  readonly series: ReadonlyArray<{ readonly date: string; readonly value: string; readonly kind: string }>;
}
const PANEL_GOLDEN = panelGoldenJson as unknown as {
  panels: Record<string, { states: GoldenState[] } | undefined>;
};

// ---- independent UTC calendar windowing (NOT the app's dateRange) ------------------------

interface DateWindow {
  readonly from: string;
  readonly to: string;
}
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function toOrd(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86400000);
}
function fromOrd(n: number): string {
  const dt = new Date(n * 86400000);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function addDays(iso: string, n: number): string {
  return fromOrd(toOrd(iso) + n);
}
function currentWindow(range: RangeKey, asOf: string, earliest: string): DateWindow {
  if (range === 'last7') return { from: addDays(asOf, -6), to: asOf };
  if (range === 'last30') return { from: addDays(asOf, -29), to: asOf };
  if (range === 'thisMonth') return { from: `${asOf.slice(0, 7)}-01`, to: asOf };
  return { from: earliest, to: asOf }; // 'all'
}
function priorWindow(cur: DateWindow): DateWindow {
  const length = toOrd(cur.to) - toOrd(cur.from) + 1;
  return { from: addDays(cur.from, -length), to: addDays(cur.from, -1) };
}
function inWindow(date: string, w: DateWindow): boolean {
  return date >= w.from && date <= w.to;
}

// ---- recompute (independent of the panel; uses only anchored normalizeCost/selectBand) ---

type Carrier = 'metric' | 'row' | 'series' | 'feed' | 'empty' | 'heatmap';

// Reserved project sentinels (frozen constants — mirror src/domain/projects.ts). The byProject grid +
// the heatmap project section sum over repo + unattributed; the tool sentinels are excluded.
const TOOL_PROJECTS = new Set(['__codex__', '__openclaw__']);
const UNATTRIBUTED_KEY = '__unattributed__';
interface Cell {
  readonly carrier: Carrier;
  readonly key: string;
  readonly value: string;
  readonly kind: string;
  readonly extra?: Record<string, string>;
}

function tokenTotal(r: UsageRecord): number {
  return r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;
}
function earliestOf(records: readonly UsageRecord[], fallback: string): string {
  let min: string | null = null;
  for (const r of records) if (min === null || r.date < min) min = r.date;
  return min ?? fallback;
}
function scopeFilter(
  records: readonly UsageRecord[],
  source: SourceKey,
): UsageRecord[] {
  return source === 'all' ? records.slice() : records.filter((r) => r.source === source);
}
function scopeWindowed(
  records: readonly UsageRecord[],
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): UsageRecord[] {
  const scoped = scopeFilter(records, source);
  const cur = currentWindow(range, asOf, earliestOf(scoped, asOf));
  return scoped.filter((r) => inWindow(r.date, cur));
}

// INDEPENDENT point-in-time band selection — does NOT import the app's `selectBand`, so the
// cacheEfficiency `saved-cost` recompute cannot mirror a broken mutable helper (Codex r2 major #3).
// (`normalizeCost`, used by the other recomputes, is itself anchored band-and-all by the
// normalization golden + property gates, which price against their own inline band find.)
function selectBandInline(card: RateCard, model: string, date: string): RateBand {
  const bands = card.rates[model];
  if (!bands) throw new Error(`oracle: no rate for model "${model}" in card ${card.version}`);
  const band = bands.find(
    (b) => b.effectiveFrom <= date && (b.effectiveTo === null || date < b.effectiveTo),
  );
  if (!band) throw new Error(`oracle: no rate band for model "${model}" on ${date}`);
  return band;
}

interface PanelSpec {
  /** The FROZEN route this panel is reachable at. The live route in config/panels.json is
   *  asserted to equal this, so the loop cannot re-point a key at a different component. */
  readonly route: string;
  readonly recompute: (
    records: readonly UsageRecord[],
    card: RateCard,
    asOf: string,
    range: RangeKey,
    source: SourceKey,
  ) => Cell[];
}

function recomputeSpendOverview(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): Cell[] {
  const scoped = scopeFilter(records, source);
  const cur = currentWindow(range, asOf, earliestOf(scoped, asOf));
  const inCur = scoped.filter((r) => inWindow(r.date, cur));
  const byDay = new Map<string, { cost: bigint; tokens: number }>();
  for (const r of inCur) {
    const acc = byDay.get(r.date) ?? { cost: 0n, tokens: 0 };
    acc.cost += normalizeCost(r, card);
    acc.tokens += tokenTotal(r);
    byDay.set(r.date, acc);
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const total = days.reduce((s, [, v]) => s + v.cost, 0n);
  const tokens = days.reduce((s, [, v]) => s + v.tokens, 0);
  const prior = priorWindow(cur);
  const priorCost = scoped
    .filter((r) => inWindow(r.date, prior))
    .reduce((s, r) => s + normalizeCost(r, card), 0n);
  const delta = total - priorCost;
  const bp = priorCost === 0n ? 0 : Number((delta * 10000n) / priorCost);
  const cells: Cell[] = [
    { carrier: 'metric', key: 'total-cost', value: total.toString(), kind: 'cost' },
    { carrier: 'metric', key: 'total-tokens', value: tokens.toString(), kind: 'tokens' },
    { carrier: 'metric', key: 'active-days', value: String(days.length), kind: 'count' },
    { carrier: 'metric', key: 'delta-cost', value: delta.toString(), kind: 'cost' },
    { carrier: 'metric', key: 'delta-pct', value: String(bp), kind: 'percent' },
  ];
  for (const [date, v] of days) {
    cells.push({ carrier: 'series', key: date, value: v.cost.toString(), kind: 'cost' });
  }
  return cells;
}

function recomputeBySourceModel(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): Cell[] {
  const inScope = scopeWindowed(records, asOf, range, source);
  const by = new Map<string, bigint>();
  let total = 0n;
  for (const r of inScope) {
    const c = normalizeCost(r, card);
    total += c;
    const key = `${r.source}|${r.model}`;
    by.set(key, (by.get(key) ?? 0n) + c);
  }
  const cells: Cell[] = [
    { carrier: 'metric', key: 'total-cost', value: total.toString(), kind: 'cost' },
    { carrier: 'metric', key: 'total-tokens', value: String(inScope.reduce((s, r) => s + tokenTotal(r), 0)), kind: 'tokens' },
  ];
  for (const [key, c] of by) cells.push({ carrier: 'row', key, value: c.toString(), kind: 'cost' });
  return cells;
}

function recomputeCacheEfficiency(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): Cell[] {
  const inScope = scopeWindowed(records, asOf, range, source);
  let cacheRead = 0;
  let cacheCreation = 0;
  let freshInput = 0;
  let saved = 0n;
  for (const r of inScope) {
    const band = selectBandInline(card, r.model, r.date);
    cacheRead += r.cacheReadTokens;
    cacheCreation += r.cacheCreationTokens;
    freshInput += r.inputTokens;
    saved += BigInt(r.cacheReadTokens) * (BigInt(band.input) - BigInt(band.cacheRead));
  }
  return [
    { carrier: 'metric', key: 'cache-read-tokens', value: String(cacheRead), kind: 'tokens' },
    { carrier: 'metric', key: 'cache-creation-tokens', value: String(cacheCreation), kind: 'tokens' },
    { carrier: 'metric', key: 'fresh-input-tokens', value: String(freshInput), kind: 'tokens' },
    { carrier: 'metric', key: 'saved-cost', value: saved.toString(), kind: 'cost' },
  ];
}

function recomputeActivityFeed(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): Cell[] {
  const inScope = scopeWindowed(records, asOf, range, source);
  let total = 0n;
  const cells: Cell[] = [];
  for (const r of inScope) {
    const c = normalizeCost(r, card);
    total += c;
    cells.push({
      carrier: 'feed',
      // Project enters the feed key (matches activityFeedModel) so per-project records sharing a
      // (source, date, model) triple stay distinct rows rather than colliding in the multiset.
      key: `${r.source}|${r.date}|${r.model}|${r.project}`,
      value: c.toString(),
      kind: 'cost',
      extra: { date: r.date, source: r.source },
    });
  }
  cells.unshift({ carrier: 'metric', key: 'total-tokens', value: String(inScope.reduce((s, r) => s + tokenTotal(r), 0)), kind: 'tokens' });
  cells.unshift({ carrier: 'metric', key: 'total-cost', value: total.toString(), kind: 'cost' });
  return cells;
}

// byProject: the project leaderboard over the GRID (repo + unattributed; tool rows excluded from totals
// AND the share denominator). Reimplemented INLINE (independent of src/domain/aggregate.ts, so an
// aggregateByProject bug surfaces as dom-vs-recompute). Each row carries three carriers on one visible
// row — cost (scales with the card), token volume + token-share-of-grid (both invariant). Under a
// tool-only source scope the grid is empty -> the frozen empty state (section "project").
function recomputeByProject(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): Cell[] {
  const grid = scopeWindowed(records, asOf, range, source).filter((r) => !TOOL_PROJECTS.has(r.project));
  const by = new Map<string, { cost: bigint; tokens: number }>();
  let gridTokens = 0;
  let totalCost = 0n;
  for (const r of grid) {
    const acc = by.get(r.project) ?? { cost: 0n, tokens: 0 };
    const c = normalizeCost(r, card);
    acc.cost += c;
    acc.tokens += tokenTotal(r);
    by.set(r.project, acc);
    gridTokens += tokenTotal(r);
    totalCost += c;
  }
  if (by.size === 0 || gridTokens === 0) {
    // The project leaderboard's only empty state: the grid (repo + unattributed) is empty (tool-only
    // scope). Section "project"; the reader keys it `byproject:project`.
    return [{ carrier: 'empty', key: 'byproject:project', value: 'project', kind: 'empty' }];
  }
  const rows = [...by.entries()]
    .map(([projectKey, v]) => ({
      projectKey,
      cost: v.cost,
      tokens: v.tokens,
      shareBp: Number((BigInt(v.tokens) * 10000n) / BigInt(gridTokens)),
    }))
    .sort((a, b) => {
      const au = a.projectKey === UNATTRIBUTED_KEY;
      const bu = b.projectKey === UNATTRIBUTED_KEY;
      if (au !== bu) return au ? 1 : -1; // Unattributed last
      if (a.tokens !== b.tokens) return b.tokens - a.tokens; // effort desc
      return a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0;
    });
  const cells: Cell[] = [{ carrier: 'metric', key: 'total-cost', value: totalCost.toString(), kind: 'cost' }];
  // The leaderboard ORDER (repos by effort desc, then Unattributed) is part of the contract, so pin
  // each row's rank via data-row-index — compareCells is an unordered multiset and would otherwise let
  // the panel render Unattributed first (Codex 0-E #5).
  rows.forEach((r, i) => {
    const idx = String(i);
    cells.push({ carrier: 'row', key: r.projectKey, value: r.cost.toString(), kind: 'cost', extra: { rowIndex: idx } });
    cells.push({ carrier: 'row', key: `${r.projectKey}#tokens`, value: String(r.tokens), kind: 'tokens', extra: { rowIndex: idx } });
    cells.push({ carrier: 'row', key: `${r.projectKey}#share`, value: String(r.shareBp), kind: 'percent', extra: { rowIndex: idx } });
  });
  return cells;
}

// ---- contributionHeatmap recompute (its own bucket/metric MODE on top of the shared range/source) ----
//
// Bucketing is reimplemented INLINE over the oracle's own UTC ordinals (independent of the unfrozen
// src/domain/dateRange.ts that src/domain/buckets.ts builds on), so a date-math bug surfaces as
// dom-vs-recompute. Cell VALUES + row ordering + per-section grouping are reimplemented inline too
// (independent of src/domain/aggregate.ts). Only the FROZEN quantileScale + normalizeCost are trusted.

type Bucket = 'day' | 'week' | 'month';
type Metric = 'tokens' | 'cost';

/** ISO date -> bucket id: day = the date; week = the ISO-8601 Monday (1970-01-05, ord 4, was a Monday);
 *  month = YYYY-MM. Mirrors src/domain/buckets.ts but on the oracle's independent ordinals. */
function bucketOfInline(iso: string, bucket: Bucket): string {
  if (bucket === 'day') return iso;
  if (bucket === 'month') return iso.slice(0, 7);
  const o = toOrd(iso);
  return fromOrd(o - (((o - 4) % 7) + 7) % 7);
}
/** Dense, ordered, de-duplicated bucket ids the inclusive [from,to] window touches. */
function bucketsInWindowInline(from: string, to: string, bucket: Bucket): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let o = toOrd(from); o <= toOrd(to); o++) {
    const id = bucketOfInline(fromOrd(o), bucket);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
const sectionOf = (project: string): 'project' | 'tool' => (TOOL_PROJECTS.has(project) ? 'tool' : 'project');

/**
 * The dense project × time grid (project section = repo + unattributed; Tools strip = the tool
 * sentinels), for one (range, source, bucket, metric) mode. Emits one `heatmap` cell per rows × buckets
 * (zeros materialized), value = token volume or normalized cost, plus its per-SECTION quantile
 * `data-intensity` (tokens and `$` ramps are independent because the scale is built from the active
 * metric's section values). A section with no rows under the scope (tool-only -> empty project grid;
 * source=claude -> empty tool strip) emits the frozen empty state instead.
 */
function recomputeContributionHeatmap(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
  bucket: Bucket,
  metric: Metric,
): Cell[] {
  const scoped = scopeFilter(records, source);
  const cur = currentWindow(range, asOf, earliestOf(scoped, asOf));
  const inCur = scoped.filter((r) => inWindow(r.date, cur));
  const buckets = bucketsInWindowInline(cur.from, cur.to, bucket);
  const valueOf = (r: UsageRecord): bigint => (metric === 'tokens' ? BigInt(tokenTotal(r)) : normalizeCost(r, card));

  const effort = new Map<string, number>(); // project -> total tokens (row ordering)
  const cellVal = new Map<string, bigint>(); // `${project}\u0000${bucketId}` -> value
  for (const r of inCur) {
    const ck = `${r.project}\u0000${bucketOfInline(r.date, bucket)}`;
    cellVal.set(ck, (cellVal.get(ck) ?? 0n) + valueOf(r));
    effort.set(r.project, (effort.get(r.project) ?? 0) + tokenTotal(r));
  }

  const projectRows = [...effort.keys()]
    .filter((p) => sectionOf(p) === 'project')
    .sort((a, b) => {
      const au = a === UNATTRIBUTED_KEY;
      const bu = b === UNATTRIBUTED_KEY;
      if (au !== bu) return au ? 1 : -1; // Unattributed last
      const ta = effort.get(a)!;
      const tb = effort.get(b)!;
      if (ta !== tb) return tb - ta; // effort desc
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const toolRows = ['__codex__', '__openclaw__'].filter((p) => effort.has(p)); // fixed order

  const kind = metric === 'tokens' ? 'tokens' : 'cost';
  const cells: Cell[] = [];
  // Global row rank across BOTH sections (project rows first, then the Tools strip) pins section order
  // + row order; colIndex pins the chronological bucket order. compareCells is unordered, so without
  // these a wrong visual order would pass (Codex 0-E #5); value + intensity + indices fix each cell's
  // figure, colour, and position.
  let rowIndex = 0;
  for (const { rows, section } of [
    { rows: projectRows, section: 'project' as const },
    { rows: toolRows, section: 'tool' as const },
  ]) {
    if (rows.length === 0) {
      cells.push({ carrier: 'empty', key: `heatmap:${section}`, value: section, kind: 'empty' });
      continue;
    }
    const sectionValues: bigint[] = [];
    for (const p of rows) for (const b of buckets) sectionValues.push(cellVal.get(`${p}\u0000${b}`) ?? 0n);
    const scale = quantileScale(sectionValues);
    for (const p of rows) {
      const rIdx = String(rowIndex++);
      buckets.forEach((b, colIdx) => {
        const v = cellVal.get(`${p}\u0000${b}`) ?? 0n;
        cells.push({
          carrier: 'heatmap',
          key: `${p}|${b}`,
          value: v.toString(),
          kind,
          extra: { section, intensity: String(scale.binOf(v)), rowIndex: rIdx, colIndex: String(colIdx) },
        });
      });
    }
  }
  return cells;
}

// The default mode the panel renders un-toggled: Daily × Tokens. The generic value/scope oracle covers
// this mode across the 16 (range, source) states; the dedicated heatmap test drives the other modes.
const HEATMAP_DEFAULT_BUCKET: Bucket = 'day';
const HEATMAP_DEFAULT_METRIC: Metric = 'tokens';
function recomputeContributionHeatmapDefault(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
): Cell[] {
  return recomputeContributionHeatmap(records, card, asOf, range, source, HEATMAP_DEFAULT_BUCKET, HEATMAP_DEFAULT_METRIC);
}

const REGISTRY: Record<string, PanelSpec | undefined> = {
  spendOverview: { route: '/', recompute: recomputeSpendOverview },
  bySourceModel: { route: '/by-source-model', recompute: recomputeBySourceModel },
  cacheEfficiency: { route: '/cache-efficiency', recompute: recomputeCacheEfficiency },
  activityFeed: { route: '/activity-feed', recompute: recomputeActivityFeed },
  byProject: { route: '/by-project', recompute: recomputeByProject },
  contributionHeatmap: { route: '/contribution', recompute: recomputeContributionHeatmapDefault },
};

// The (range, source) matrix exercised for value-equality — the FULL CARTESIAN product of every
// range key × every source filter (4 × 4 = 16 pairs), NOT each dimension swept independently. So a
// panel that mishandles ANY individual pair — e.g. ignores the source filter only for `last7`, or
// mis-windows only `thisMonth/codex` — mismatches that pair's recompute and FAILs, where a
// per-dimension matrix (every range with source=all + every source with one range) would miss it
// (Codex r4: the scope value oracle must be Cartesian). The six human-audited panel-golden states
// are a subset of this matrix and still triangulate the recompute wherever one exists.
const RANGE_KEYS: readonly RangeKey[] = ['last7', 'last30', 'thisMonth', 'all'];
const SOURCE_KEYS: readonly SourceKey[] = ['all', 'claude', 'codex', 'openclaw'];
const STATES: ReadonlyArray<{ label: string; range: RangeKey; source: SourceKey }> = RANGE_KEYS.flatMap(
  (range) => SOURCE_KEYS.map((source) => ({ label: `${range}/${source}`, range, source })),
);

// ---- frozen inline rate-card scaling (independent of src/test-support/scaleRateCard) ------

function scaleCardInline(card: RateCard, k: number): RateCard {
  const K = BigInt(k);
  const rates: Record<string, RateBand[]> = {};
  for (const [model, bands] of Object.entries(card.rates)) {
    rates[model] = bands.map((b) => ({
      effectiveFrom: b.effectiveFrom,
      effectiveTo: b.effectiveTo,
      input: (BigInt(b.input) * K).toString(),
      output: (BigInt(b.output) * K).toString(),
      cacheCreation: (BigInt(b.cacheCreation) * K).toString(),
      cacheRead: (BigInt(b.cacheRead) * K).toString(),
      reasoning: (BigInt(b.reasoning) * K).toString(),
    }));
  }
  return { version: card.version, asOf: card.asOf, unit: card.unit, rates };
}

// ---- DOM reading + comparison -----------------------------------------------------------

function attr(node: Element, name: string): string {
  return node.getAttribute(name) ?? '';
}
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
const COST_KINDS = new Set(['cost', 'rate']);

// The production stylesheet, injected ONCE into the oracle's jsdom <head> so getComputedStyle
// reflects the REAL class-based display/visibility/opacity a shipped panel carries — a carrier
// hidden by a stylesheet rule (the app's own, or a <style> the panel renders), not merely an inline
// style, is then caught too. jsdom 29 resolves class selectors for display/visibility/opacity and
// the off-screen recipe (position/size/overflow/clip-path) — verified — so this closes the
// class-hidden hole deterministically (no layout needed). Read off disk (NOT a CSS `import`) so it
// works without vite's css pipeline; a missing file degrades to inline/attribute checks, never a
// false pass.
let PROD_CSS = '';
try {
  PROD_CSS = readFileSync(resolve(process.cwd(), 'src/styles/observatory.css'), 'utf8');
} catch {
  PROD_CSS = '';
}
function ensureProdCssLoaded(): void {
  if (typeof document === 'undefined' || PROD_CSS === '') return;
  if (document.getElementById('oracle-prod-css')) return;
  const style = document.createElement('style');
  style.id = 'oracle-prod-css';
  style.textContent = PROD_CSS;
  document.head.appendChild(style);
}

// sr-only / visually-hidden utility class names (+ common spelling variants). A value parked in such
// a carrier is invisible to a sighted user even though it declares no display/visibility/opacity of
// its own, so the class itself is a hidden signal.
const SR_ONLY_CLASS_RE =
  /(?:^|[\s_-])(?:sr-only|sronly|sr_only|visually-?hidden|visually_hidden|screen-?reader(?:-only)?|a11y-?hidden|hidden-?visually|is-visually-hidden|u-hidden-visual)(?:$|[\s_-])/i;

/** `"1px"`/`"0"` -> number; `"auto"`/`""`/anything else -> NaN (so an auto size is never "tiny"). */
function cssLen(v: string): number {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim()) ?? /^(-?\d+(?:\.\d+)?)$/.exec(v.trim());
  return m ? Number(m[1]) : NaN;
}

/** display:none / visibility:hidden|collapse / opacity:0 from a declaration (inline OR computed). */
function declHides(display: string, visibility: string, opacity: string): boolean {
  const d = display.toLowerCase().trim();
  const v = visibility.toLowerCase().trim();
  const o = opacity.trim();
  if (d === 'none') return true;
  if (v === 'hidden' || v === 'collapse') return true;
  if (o !== '' && Number.isFinite(Number(o)) && Number(o) === 0) return true;
  return false;
}

/** The canonical "screen-reader only" recipe collapses the box to a clipped, overflow-hidden,
 *  absolutely-positioned 1px (or 0) point. jsdom resolves position/size/overflow/clip(-path) from
 *  the stylesheet (verified), so the pattern is detectable structurally — not only by class name. */
function isClippedAway(cs: CSSStyleDeclaration): boolean {
  const clipPath = (cs.clipPath || cs.getPropertyValue('clip-path') || '').toLowerCase();
  if (/inset\(\s*(?:[5-9]\d|100)(?:\.\d+)?%/.test(clipPath) || /circle\(\s*0(?:px|%)?\s*\)/.test(clipPath)) {
    return true;
  }
  const pos = (cs.position || '').toLowerCase();
  const offscreen = pos === 'absolute' || pos === 'fixed';
  const tiny = cssLen(cs.width || '') <= 1 && cssLen(cs.height || '') <= 1; // NaN compares false
  const overflowHidden = `${cs.overflow} ${cs.overflowX} ${cs.overflowY}`.toLowerCase().includes('hidden');
  const clip = (cs.clip || '').replace(/\s+/g, '').toLowerCase();
  const clipCollapsed = /^rect\((?:0(?:px)?|1px),(?:0(?:px)?|1px),(?:0(?:px)?|1px),(?:0(?:px)?|1px)\)$/.test(clip);
  if (offscreen && tiny && (overflowHidden || clipCollapsed)) return true;
  if (clipCollapsed && overflowHidden) return true;
  return false;
}

/** Far-off-canvas placement threshold (px). The "park it offscreen" recipe shoves a carrier ~9999px
 *  out — far beyond any real viewport — via `left/top/right/bottom:-9999px` on an absolutely/fixed-
 *  positioned node, or `transform: translate(-9999px, …)` on any node. Real layouts never offset by
 *  this much, so |offset| ≥ this is an unambiguous hide; kept conservatively large to never catch a
 *  legitimately-positioned element. */
const OFFSCREEN_PX = 4000;

/** Parse the x/y translation (px) out of a `transform`. Handles translate/translateX/translateY/
 *  translate3d and matrix()/matrix3d(); returns NaN for a component that is absent or expressed in a
 *  non-px unit (e.g. `%`, which jsdom leaves unresolved) — so a percentage translate (a legit layout
 *  trick that only shifts by the element's own size) is never mistaken for an off-canvas hide. jsdom
 *  returns the AUTHORED transform string (it does not collapse to a matrix), so the function-form
 *  branches carry the load; the matrix branches are belt-and-suspenders. */
function transformTranslatePx(transform: string): { tx: number; ty: number } {
  const t = (transform || '').trim();
  if (t === '' || t.toLowerCase() === 'none') return { tx: 0, ty: 0 };
  const mat = /matrix\(\s*([^)]+)\)/i.exec(t);
  if (mat?.[1]) {
    const p = mat[1].split(',').map((s) => Number(s.trim()));
    return { tx: p[4] ?? NaN, ty: p[5] ?? NaN };
  }
  const mat3d = /matrix3d\(\s*([^)]+)\)/i.exec(t);
  if (mat3d?.[1]) {
    const p = mat3d[1].split(',').map((s) => Number(s.trim()));
    return { tx: p[12] ?? NaN, ty: p[13] ?? NaN };
  }
  let tx = 0;
  let ty = 0;
  const both = /translate3?d?\(\s*(-?\d+(?:\.\d+)?)px\s*(?:,\s*(-?\d+(?:\.\d+)?)px)?/i.exec(t);
  if (both) {
    tx = Number(both[1]);
    if (both[2] !== undefined) ty = Number(both[2]);
  }
  const onlyX = /translateX\(\s*(-?\d+(?:\.\d+)?)px\s*\)/i.exec(t);
  if (onlyX) tx = Number(onlyX[1]);
  const onlyY = /translateY\(\s*(-?\d+(?:\.\d+)?)px\s*\)/i.exec(t);
  if (onlyY) ty = Number(onlyY[1]);
  return { tx, ty };
}

/** The "park it far off-canvas" hide that {@link isClippedAway} does NOT cover: an absolutely- or
 *  fixed-positioned node displaced via `left/top/right/bottom:-9999px` (any side), or ANY node
 *  displaced via `transform: translate(±≥OFFSCREEN_PX, …)`. A carrier shoved this far is invisible to
 *  the user even though its `data-*-value` attributes read correct, so it must FAIL closed (Codex r5
 *  blocker #1). `cssLen` returns NaN for `auto`/`%`/unitless, which compares false (never "off-canvas"). */
function isOffCanvas(cs: CSSStyleDeclaration): boolean {
  const pos = (cs.position || '').toLowerCase();
  if (pos === 'absolute' || pos === 'fixed') {
    for (const side of [cs.left, cs.top, cs.right, cs.bottom]) {
      const n = cssLen(side || '');
      if (Number.isFinite(n) && Math.abs(n) >= OFFSCREEN_PX) return true;
    }
  }
  const { tx, ty } = transformTranslatePx(cs.transform || cs.getPropertyValue('transform') || '');
  if (Number.isFinite(tx) && Math.abs(tx) >= OFFSCREEN_PX) return true;
  if (Number.isFinite(ty) && Math.abs(ty) >= OFFSCREEN_PX) return true;
  return false;
}

/** A single node is hidden if ANY of: the `hidden`/`inert`/`aria-hidden="true"` attribute, an
 *  sr-only/visually-hidden class, an inline OR computed (class-based) display:none /
 *  visibility:hidden|collapse / opacity:0, the clipped/tiny sr-only recipe, or far-off-canvas
 *  placement (`left:-9999px` / `transform: translateX(-9999px)` and kin). Covers exactly what the old
 *  checks missed (aria-hidden, inert, class-based hiding, computed opacity:0, sr-only/clipped, and now
 *  off-canvas parking — Codex r5 blocker #1). */
function nodeIsHidden(node: Element): boolean {
  if (node.getAttribute('aria-hidden') === 'true') return true;
  if (node.hasAttribute('inert')) return true;
  if (node.hasAttribute('hidden')) return true;
  if (SR_ONLY_CLASS_RE.test(node.getAttribute('class') ?? '')) return true;
  const inline = (node as Partial<{ style: CSSStyleDeclaration }>).style;
  if (inline && declHides(inline.display, inline.visibility, inline.opacity)) return true;
  // Catch an off-canvas inline transform/offset directly too (also covers the no-window path).
  if (inline && isOffCanvas(inline)) return true;
  if (typeof window !== 'undefined') {
    const cs = window.getComputedStyle(node);
    if (declHides(cs.display, cs.visibility, cs.opacity)) return true;
    if (isClippedAway(cs)) return true;
    if (isOffCanvas(cs)) return true;
  }
  return false;
}

/** Visible iff neither the element NOR ANY ancestor up through `<body>`/`<html>` is hidden — where
 *  "hidden" means any signal in {@link nodeIsHidden}: the `hidden`/`inert`/`aria-hidden="true"`
 *  attribute, a sr-only/visually-hidden class, an inline OR class-based (computed) `display:none` /
 *  `visibility:hidden|collapse` / `opacity:0`, the clipped/tiny sr-only recipe, or far-off-canvas
 *  placement. The walk runs ALL the way to the document root: a hidden ancestor ABOVE the panel root
 *  (a `display:none` route wrapper / `.app__main`) hides the whole panel even while its carriers
 *  "pass", so the `data-panel-root` is used ONLY for query scoping, never as a visibility stop (Codex
 *  r5 blocker #2 — previously the walk broke at the root and missed exactly this). Deterministic —
 *  jsdom resolves these from the injected production CSS + any panel-rendered <style>, needing no
 *  layout. */
function isVisible(el: Element): boolean {
  ensureProdCssLoaded();
  let node: Element | null = el;
  while (node) {
    if (nodeIsHidden(node)) return false;
    node = node.parentElement; // walk to <body>/<html>; do NOT stop at data-panel-root
  }
  return true;
}

/** The carrier's VISIBLE-ONLY text: the concatenation of text under descendants that are NOT hidden,
 *  using the SAME per-node {@link nodeIsHidden} signal the {@link isVisible} ancestor-walk uses (the
 *  `hidden`/`inert`/`aria-hidden` attribute, a sr-only/visually-hidden class, inline OR computed
 *  display:none / visibility:hidden|collapse / opacity:0, the clipped/tiny sr-only recipe, or far-off-
 *  canvas placement). A hidden descendant subtree contributes NO text — so a value parked in a hidden
 *  child (`<span hidden>$123.45</span>`, a `display:none`/sr-only child) is NOT counted, and a carrier
 *  that shows blank or wrong text to a sighted user can no longer pass on a hidden child's correct
 *  formatted value (Codex r6). The carrier element itself is already asserted visible by the caller, so
 *  the walk only needs to prune hidden DESCENDANTS. Only true text nodes count (comments/PIs excluded). */
function visibleTextOf(el: Element): string {
  ensureProdCssLoaded();
  let out = '';
  const walk = (node: Element): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child instanceof Element) {
        if (nodeIsHidden(child)) continue; // hidden subtree is invisible to the user — drop its text
        walk(child);
      } else if (child.nodeType === child.TEXT_NODE) {
        out += child.nodeValue ?? '';
      }
    }
  };
  walk(el);
  return out;
}

/** The single VISIBLE `data-panel-root="<key>"` element rendered at the panel's route. Throws if
 *  there is not exactly one, or it is hidden — so the routed component must declare a visible root,
 *  and the cell read is scoped strictly to it (Codex r2 blocker #2). */
function requirePanelRoot(key: string): HTMLElement {
  const roots = Array.from(document.querySelectorAll(`[data-panel-root="${key}"]`)).filter(
    (n): n is HTMLElement => n instanceof HTMLElement,
  );
  if (roots.length === 0) throw new Error(`no [data-panel-root="${key}"] rendered at its route`);
  if (roots.length > 1) throw new Error(`${roots.length} [data-panel-root="${key}"] roots (need exactly 1)`);
  const root = roots[0]!;
  if (!isVisible(root)) throw new Error(`[data-panel-root="${key}"] is not visible`);
  return root;
}

// ---- frozen VISIBLE-text / geometry consistency (Codex r5: attributes must match what the user SEES) ----
//
// readDomCells/compareCells check the `data-*-value` ATTRIBUTE against the independent recompute. That
// alone lets a carrier hold the correct attribute while rendering EMPTY or contradictory visible text
// (an empty `<span>`, or one whose figure says something else, or one whose correct figure lives only
// in a HIDDEN descendant — Codex r6). So for every TEXTUAL carrier we also assert its rendered
// VISIBLE-ONLY text (text under any hidden descendant subtree excluded, via {@link visibleTextOf} —
// reusing the same `nodeIsHidden` machinery as the visibility walk) is NON-EMPTY and consistent with
// the SAME node's raw attribute,
// formatted by an oracle-OWNED FROZEN formatter — we deliberately do NOT import the loop-editable
// `src/ui/format.ts` (a broken app formatter must not get to define its own correctness). Because
// compareCells separately binds attribute == recompute, "text consistent with attribute" transitively
// binds the VISIBLE text to the independently recomputed truth. For SVG GEOMETRY carriers (the sparkline
// points, which carry no text by construction) we instead assert defined, in-range plot coordinates +
// a positive radius. NOTE (out of scope, stated plainly): jsdom has NO layout engine, so true
// pixel/screenshot verification is impossible here; the textContent + frozen-formatter assertion is the
// realistic deterministic closure for the false-text hole (Codex r5 major #3).

const ORACLE_PICO_PER_CENT = 10_000_000_000n; // 1 cent = 1e10 pico-USD (mirrors the display boundary)
function frozenGroupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
/** Exact pico-USD MAGNITUDE -> "1,234.56" (rounded to the nearest cent). No sign/`$`: the sign lives in
 *  the verified attribute and is shown visually by an arrow, so the visible text need only carry the
 *  magnitude body (this is the value a user reads). */
function frozenUsdBody(pico: bigint): string {
  const mag = pico < 0n ? -pico : pico;
  const cents = (mag + ORACLE_PICO_PER_CENT / 2n) / ORACLE_PICO_PER_CENT;
  return `${frozenGroupThousands((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, '0')}`;
}
/** Token volume -> the compact form a panel shows ("12.3m"/"456.0k"/"789"), lowercased to match norm(). */
function frozenTokensCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return frozenGroupThousands(String(n));
}
/** Signed basis points -> the UNSIGNED percent magnitude a panel shows ("12.3"/"0.0"); the sign/`%` are
 *  matched loosely via substring containment so "+12.3%" / "-12.3%" both satisfy magnitude "12.3". */
function frozenPctMagnitude(basisPoints: number): string {
  return Math.abs(basisPoints / 100).toFixed(1);
}

const TEXTUAL_CARRIERS = new Set<Carrier>(['metric', 'row', 'feed']);

/** Assert the carrier's VISIBLE rendering is consistent with its raw attribute value, throwing (fails
 *  CLOSED, like the visibility check) on empty/contradictory text or undefined geometry. Textual
 *  carriers must show non-empty VISIBLE text (hidden descendant subtrees excluded — Codex r6) whose
 *  digits contain the frozen-formatted raw value; the SVG series-point (no text) must instead carry
 *  defined, non-negative, finite coords + a positive radius. */
function assertVisibleConsistent(carrier: Carrier, key: string, kind: string, raw: string, node: Element): void {
  if (!TEXTUAL_CARRIERS.has(carrier)) {
    // SVG geometry carrier (sparkline series-point): no textContent — require a real plotted point
    // (defined, non-negative, finite coords + positive radius), not a degenerate/undefined marker.
    const cx = Number(attr(node, 'cx'));
    const cy = Number(attr(node, 'cy'));
    const r = Number(attr(node, 'r'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx < 0 || cy < 0) {
      throw new Error(`${carrier} carrier "${key}" has undefined/off-range geometry (cx=${attr(node, 'cx') || '∅'}, cy=${attr(node, 'cy') || '∅'})`);
    }
    if (!Number.isFinite(r) || r <= 0) {
      throw new Error(`${carrier} carrier "${key}" has non-positive radius r=${attr(node, 'r') || '∅'}`);
    }
    return;
  }
  // VISIBLE-only text: text under any hidden descendant subtree is excluded, so a carrier cannot
  // satisfy this from a hidden child while showing blank/wrong text to the user (Codex r6). Both the
  // non-empty check AND the digit/formatted-value containment below read this visible-only text.
  const text = norm(visibleTextOf(node));
  if (text === '') {
    throw new Error(`${carrier} carrier "${key}" renders EMPTY visible text (raw ${kind || '∅'}=${raw}) — the value is not shown to the user`);
  }
  const flat = text.replace(/[\s,]/g, ''); // strip grouping/whitespace so "$1,234.56" -> "$1234.56"
  const inconsistent = (want: string): never => {
    throw new Error(`${carrier} carrier "${key}" visible "${text}" inconsistent with raw ${kind} ${raw} (expected to show ${want})`);
  };
  if (COST_KINDS.has(kind)) {
    if (!isIntString(raw)) inconsistent(`an integer ${kind}, got non-integer raw "${raw}"`);
    const body = frozenUsdBody(BigInt(raw));
    if (!flat.includes(body.replace(/,/g, ''))) inconsistent(body);
    return;
  }
  if (kind === 'tokens' || kind === 'count') {
    if (!isIntString(raw)) inconsistent(`an integer ${kind}, got non-integer raw "${raw}"`);
    const compact = frozenTokensCompact(Number(raw)).replace(/,/g, ''); // tokens may be compacted
    const plain = raw.replace('-', ''); // counts are shown verbatim
    if (!flat.includes(compact) && !flat.includes(plain)) inconsistent(`${compact} or ${plain}`);
    return;
  }
  if (kind === 'percent') {
    if (!isIntString(raw)) inconsistent(`an integer percent, got non-integer raw "${raw}"`);
    if (/\d/.test(text)) {
      const mag = frozenPctMagnitude(Number(raw));
      if (!flat.includes(mag)) inconsistent(`${mag}%`);
    } else if (BigInt(raw) !== 0n) {
      // A non-numeric token (e.g. "new") is legitimate ONLY when there is no prior baseline (bp == 0).
      inconsistent('a percent figure (a non-numeric label is allowed only when basis-points == 0)');
    }
    return;
  }
  // kinds with no canonical display (date/label/ratio): the non-empty requirement above already
  // closes the blank-carrier hole; we do not over-constrain their formatting.
}

/** Read every house-style raw value carrier WITHIN one panel root (never document-wide), so a
 *  hidden/extra carrier elsewhere can neither add nor mask a value. Each carrier element must
 *  ITSELF be visible (same visibility check as the root) AND — via {@link assertVisibleConsistent} —
 *  render VISIBLE text/geometry consistent with its raw attribute, so a value the user cannot see (a
 *  hidden subtree, or an empty/contradictory figure) cannot satisfy the gate; both FAIL CLOSED (Codex
 *  r3 blocker + r5 major #3). */
// A heatmap cell's applied colour, read from the DOM the honest way jsdom allows: an INLINE background
// (or SVG fill). A stylesheet class colour is invisible to jsdom, so the contract requires the colour
// inline; this returns '' when none is set (caught as a blank cell).
function cellColour(n: Element): string {
  const el = n as HTMLElement;
  const inline = (el.style?.backgroundColor || el.style?.getPropertyValue('background-color') || '').trim();
  return (inline || n.getAttribute('fill') || (el.style?.background ?? '')).trim();
}
const TRANSPARENT_COLOURS = new Set(['transparent', 'rgba(0,0,0,0)', 'rgb(0,0,0,0)']);
// The DOM DOCUMENT order (queryAllByTestId order) of ordered carriers must follow their declared indices,
// binding the indices (which compareCells pins to the recompute) to the order the user sees. jsdom has no
// computed layout, so document order is the honest proxy — a panel that stamps correct indices while
// emitting cells in a scrambled DOM order is caught here (Codex r2 #1).
function assertDomOrder(cells: Cell[]): void {
  // heatmap cells: STRICTLY increasing lexicographically by (rowIndex, colIndex) — i.e. exactly the
  // recompute's row-major order (project section first).
  let pr = -1;
  let pc = -1;
  for (const c of cells) {
    if (c.carrier !== 'heatmap') continue;
    const r = Number(c.extra?.rowIndex);
    const col = Number(c.extra?.colIndex);
    if (!Number.isInteger(r) || !Number.isInteger(col) || r < 0 || col < 0) {
      throw new Error(`heatmap-cell "${c.key}" missing integer data-cell-row-index/-col-index`);
    }
    if (r < pr || (r === pr && col <= pc)) {
      throw new Error(`heatmap DOM order not monotonic by (row,col): (${pr},${pc}) then (${r},${col}) at "${c.key}"`);
    }
    pr = r;
    pc = col;
  }
  // byProject rows: document order NON-decreasing by rowIndex (each row emits 3 cells sharing its rank).
  let prRow = -1;
  for (const c of cells) {
    if (c.carrier !== 'row' || c.extra?.rowIndex === undefined) continue;
    const r = Number(c.extra.rowIndex);
    if (!Number.isInteger(r) || r < 0) throw new Error(`breakdown-row "${c.key}" has a non-integer data-row-index`);
    if (r < prRow) throw new Error(`byProject DOM order not monotonic by row-index: ${prRow} then ${r} at "${c.key}"`);
    prRow = r;
  }
}
function readDomCells(root: HTMLElement): Cell[] {
  const scope = within(root);
  const out: Cell[] = [];
  const visible = (carrier: Carrier, key: string, n: Element): Element => {
    if (!isVisible(n)) {
      throw new Error(`hidden ${carrier} carrier "${key}" inside [data-panel-root] — every value carrier must be visible`);
    }
    return n;
  };
  for (const n of scope.queryAllByTestId('panel-metric')) {
    const key = attr(n, 'data-metric-key');
    const value = attr(n, 'data-metric-value');
    const kind = attr(n, 'data-value-kind');
    visible('metric', key, n);
    assertVisibleConsistent('metric', key, kind, value, n);
    out.push({ carrier: 'metric', key, value, kind });
  }
  for (const n of scope.queryAllByTestId('breakdown-row')) {
    const key = attr(n, 'data-row-key');
    const value = attr(n, 'data-row-value');
    const kind = attr(n, 'data-value-kind');
    visible('row', key, n);
    assertVisibleConsistent('row', key, kind, value, n);
    // A byProject row declares its rank via data-row-index (pins the leaderboard ORDER, which the
    // multiset compare can't). Absent on bySourceModel / heatmap-breakdown rows -> no rowIndex in the
    // recompute for those either, so this stays backward-compatible.
    const rowIndex = n.getAttribute('data-row-index');
    const rowExtra = rowIndex !== null ? { rowIndex } : undefined;
    out.push({ carrier: 'row', key, value, kind, ...(rowExtra ? { extra: rowExtra } : {}) });
    // A byProject row additionally carries token volume + token-share-of-grid on the SAME visible row.
    // Read each as its own keyed cell so the value oracle pins them and the coupling oracle proves them
    // invariant; each inherits the same rank.
    const tokens = n.getAttribute('data-row-tokens');
    if (tokens !== null) {
      assertVisibleConsistent('row', `${key}#tokens`, 'tokens', tokens, n);
      out.push({ carrier: 'row', key: `${key}#tokens`, value: tokens, kind: 'tokens', ...(rowExtra ? { extra: rowExtra } : {}) });
    }
    const share = n.getAttribute('data-row-share');
    if (share !== null) {
      const shareKind = attr(n, 'data-share-kind');
      assertVisibleConsistent('row', `${key}#share`, shareKind, share, n);
      out.push({ carrier: 'row', key: `${key}#share`, value: share, kind: shareKind, ...(rowExtra ? { extra: rowExtra } : {}) });
    }
  }
  for (const n of scope.queryAllByTestId('series-point')) {
    const key = attr(n, 'data-point-date');
    const value = attr(n, 'data-point-value');
    const kind = attr(n, 'data-value-kind');
    visible('series', key, n);
    assertVisibleConsistent('series', key, kind, value, n);
    out.push({ carrier: 'series', key, value, kind });
  }
  for (const n of scope.queryAllByTestId('feed-item')) {
    const key = attr(n, 'data-feed-key');
    const value = attr(n, 'data-feed-cost-pico');
    // Read the ACTUAL declared kind — never assume 'cost' — so a feed item that omits or
    // mis-sets data-value-kind FAILs the contract (Codex r2 minor #6).
    const kind = attr(n, 'data-value-kind');
    visible('feed', key, n);
    assertVisibleConsistent('feed', key, kind, value, n);
    out.push({
      carrier: 'feed',
      key,
      value,
      kind,
      extra: { date: attr(n, 'data-feed-date'), source: attr(n, 'data-feed-source') },
    });
  }
  // Heatmap cells carry NO text — the value the user reads is the COLOUR (data-intensity), with the
  // raw figure revealed on focus/expand. So we do NOT run assertVisibleConsistent (there is no figure
  // to read); the closure is value == recompute AND intensity-bin == recompute (the visible colour).
  const heatColourByBin = new Map<string, string>(); // `${section}:${bin}` -> colour (must be consistent)
  const heatColoursBySection = new Map<string, Map<string, string>>(); // section -> bin -> colour (distinct)
  for (const n of scope.queryAllByTestId('heatmap-cell')) {
    const key = `${attr(n, 'data-cell-row')}|${attr(n, 'data-cell-bucket')}`;
    visible('heatmap', key, n);
    const bin = attr(n, 'data-intensity');
    const section = attr(n, 'data-cell-section');
    // The VISIBLE colour IS the datum — so it must be an INLINE, data-driven style the oracle can read
    // (jsdom applies no stylesheets, so a class-only colour is invisible to it and unprovable), non-blank,
    // so a data-correct grid cannot certify while rendering blank/monochrome (Codex r3 #1). It must be a
    // pure function of (section, bin): same section+bin -> same colour (checked here), distinct bins ->
    // distinct colours (checked after the loop). NOTE: jsdom cannot verify actual pixels/contrast — this
    // pins the applied inline colour, the honest limit of a layout-free renderer.
    const colour = cellColour(n);
    if (colour === '' || TRANSPARENT_COLOURS.has(colour.replace(/\s+/g, ''))) {
      throw new Error(`heatmap-cell "${key}" (bin ${bin}) has no visible inline background colour — the grid would render blank`);
    }
    const ck = `${section}:${bin}`;
    const prevColour = heatColourByBin.get(ck);
    if (prevColour !== undefined && prevColour !== colour) {
      throw new Error(`heatmap-cell "${key}" colour "${colour}" != "${prevColour}" for the same section/bin (${ck}) — colour is not a function of the bin`);
    }
    heatColourByBin.set(ck, colour);
    let binMap = heatColoursBySection.get(section);
    if (!binMap) {
      binMap = new Map();
      heatColoursBySection.set(section, binMap);
    }
    binMap.set(bin, colour);
    out.push({
      carrier: 'heatmap',
      key,
      value: attr(n, 'data-cell-value'),
      kind: attr(n, 'data-value-kind'),
      extra: {
        section,
        intensity: bin,
        rowIndex: attr(n, 'data-cell-row-index'),
        colIndex: attr(n, 'data-cell-col-index'),
      },
    });
  }
  // Distinct bins within a section MUST render distinct colours (a monochrome ramp fails closed). Over a
  // rich scope (all/all) several bins co-occur, so this is a real ramp check; narrow scopes pass trivially.
  for (const [section, binMap] of heatColoursBySection) {
    const colours = [...binMap.values()];
    if (new Set(colours).size !== colours.length) {
      const detail = [...binMap.entries()].map(([b, c]) => `bin${b}=${c}`).join(', ');
      throw new Error(`heatmap section "${section}" renders non-distinct bin colours (${detail}) — the ramp is not distinguishable`);
    }
  }
  // Per-section empty state (byProject under a tool-only scope; the heatmap project grid / tool strip
  // under a one-sided scope). The carrier's identity is its section; a non-empty data-empty-reason is
  // required (a blank "empty" carrier that says nothing fails closed). assertVisibleConsistent is NOT
  // applied (an empty state shows prose, not a formatted figure).
  for (const [testid, key] of [
    ['byproject-empty', 'byproject'],
    ['heatmap-empty', 'heatmap'],
  ] as const) {
    for (const n of scope.queryAllByTestId(testid)) {
      visible('empty', key, n);
      const section = attr(n, 'data-empty-section');
      if (norm(attr(n, 'data-empty-reason')) === '') {
        throw new Error(`${testid} (section "${section}") has no data-empty-reason — an empty state must say why`);
      }
      // The empty state must also SHOW prose to the user, not just carry a hidden attribute (Codex 0-E
      // #12) — visible-only text (hidden descendants excluded), non-blank.
      if (norm(visibleTextOf(n)) === '') {
        throw new Error(`${testid} (section "${section}") renders no VISIBLE empty-state text — the reason is not shown`);
      }
      out.push({ carrier: 'empty', key: section ? `${key}:${section}` : key, value: section, kind: 'empty' });
    }
  }
  assertDomOrder(out);
  return out;
}

function keyOf(c: Cell): string {
  return `${c.carrier}:${c.key}`;
}
function countByKey(cells: Cell[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cells) m.set(keyOf(c), (m.get(keyOf(c)) ?? 0) + 1);
  return m;
}
/**
 * Counted-MULTISET comparison (NOT a key→cell map, which silently collapses duplicates — Codex r2
 * major #5). Every carrier key must appear EXACTLY as many times in `got` as in `expected` (the
 * "one per metric/row/series/feed" contract), and the value/kind/extra of present keys must match.
 */
function compareCells(label: string, expected: Cell[], got: Cell[], fails: string[]): void {
  const gotCounts = countByKey(got);
  const expCounts = countByKey(expected);
  for (const k of [...new Set([...gotCounts.keys(), ...expCounts.keys()])].sort()) {
    const g = gotCounts.get(k) ?? 0;
    const e = expCounts.get(k) ?? 0;
    if (g !== e) fails.push(`${label}: ${k} appears ${g}× (expected ${e}×)`);
  }
  // Value/kind/extra equality for keys present on both sides (first occurrence of each).
  const gotFirst = new Map<string, Cell>();
  for (const c of got) if (!gotFirst.has(keyOf(c))) gotFirst.set(keyOf(c), c);
  for (const e of expected) {
    const g = gotFirst.get(keyOf(e));
    if (!g) continue; // absence already reported by the count diff above
    if (g.value !== e.value) fails.push(`${label}: ${keyOf(e)} value ${g.value} != ${e.value}`);
    if (g.kind !== e.kind) fails.push(`${label}: ${keyOf(e)} kind ${g.kind} != ${e.kind}`);
    if (e.extra) {
      for (const [k, v] of Object.entries(e.extra)) {
        if (g.extra?.[k] !== v) fails.push(`${label}: ${keyOf(e)} ${k} ${g.extra?.[k] ?? '∅'} != ${v}`);
      }
    }
  }
  // The first-occurrence check above fully covers UNIQUE carrier keys. For a key that REPEATS, a wrong
  // value on a non-first cell would slip past it — so for any repeated key, additionally assert the full
  // (value, kind, extra) signature multisets match. Canonical records are unique by identity (enforced
  // by validateSnapshot), so this is a fail-closed backstop, not a normal path.
  const repeated = new Set(
    [...gotCounts.keys(), ...expCounts.keys()].filter((k) => (gotCounts.get(k) ?? 0) > 1 || (expCounts.get(k) ?? 0) > 1),
  );
  if (repeated.size > 0) {
    const sigOf = (c: Cell): string => `${keyOf(c)}|${c.value}|${c.kind}|${c.extra ? JSON.stringify(c.extra) : ''}`;
    const sigCounts = (cells: Cell[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const c of cells) if (repeated.has(keyOf(c))) m.set(sigOf(c), (m.get(sigOf(c)) ?? 0) + 1);
      return m;
    };
    const gotSig = sigCounts(got);
    const expSig = sigCounts(expected);
    for (const s of [...new Set([...gotSig.keys(), ...expSig.keys()])].sort()) {
      const g = gotSig.get(s) ?? 0;
      const e = expSig.get(s) ?? 0;
      if (g !== e) fails.push(`${label}: repeated-key cell [${s}] appears ${g}× (expected ${e}×)`);
    }
  }
}

function goldenCellsFor(key: string, range: string, source: string): Cell[] | null {
  const panel = PANEL_GOLDEN.panels[key];
  if (!panel) return null;
  const st = panel.states.find((s) => s.range === range && s.source === source);
  if (!st) return null;
  const cells: Cell[] = [];
  for (const [k, m] of Object.entries(st.metrics)) cells.push({ carrier: 'metric', key: k, value: m.value, kind: m.kind });
  for (const p of st.series) cells.push({ carrier: 'series', key: p.date, value: p.value, kind: p.kind });
  return cells;
}

// ---- rendering the REAL route ------------------------------------------------------------

function renderRoute(route: string, scope: Scope, dataSource?: DataSource): void {
  render(
    <AppProviders {...(dataSource ? { dataSource } : {})} initialScope={scope}>
      <MemoryRouter initialEntries={[route]}>
        <AppShell />
      </MemoryRouter>
    </AppProviders>,
  );
}

// ---- scope-matrix DOM helpers ------------------------------------------------------------

function findFilterOption(filterTestId: string, optionTestId: string, label: string): HTMLElement | null {
  const ctrl = screen.queryByTestId(filterTestId);
  if (!ctrl) return null;
  return (
    within(ctrl)
      .queryAllByTestId(optionTestId)
      .find((o) => norm(o.textContent ?? '').includes(norm(label))) ?? null
  );
}
function activeOptionLabel(filterTestId: string, optionTestId: string): string | null {
  const ctrl = screen.queryByTestId(filterTestId);
  if (!ctrl) return null;
  const a = within(ctrl)
    .queryAllByTestId(optionTestId)
    .find((o) => o.getAttribute('aria-current') === 'true');
  return a ? norm(a.textContent ?? '') : null;
}
function findNavLink(route: string): HTMLElement | null {
  return screen.queryAllByRole('link').find((a) => a.getAttribute('href') === route) ?? null;
}

// ---- the three oracle categories ---------------------------------------------------------

interface LivePanel {
  readonly key: string;
  /** The route declared in config/panels.json (asserted to equal the FROZEN REGISTRY route). */
  readonly configRoute: string;
}
const LIVE: LivePanel[] = Object.entries(PANELS_CONFIG.panels)
  .filter(([, p]) => p.status === 'live')
  .map(([key, p]) => ({ key, configRoute: p.route }));

/** Resolve a live panel to its FROZEN spec, failing CLOSED if the key is unknown or if the loop
 *  re-pointed its route in config away from the frozen one. Returns the spec on success. */
function resolveSpec(panel: LivePanel, fails: string[]): PanelSpec | null {
  const spec = REGISTRY[panel.key];
  if (!spec) {
    fails.push(`${panel.key}: no frozen oracle spec — cannot certify an unknown live panel`);
    return null;
  }
  if (panel.configRoute !== spec.route) {
    fails.push(`${panel.key}: config route "${panel.configRoute}" != frozen route "${spec.route}"`);
    return null;
  }
  return spec;
}

interface CategoryResult {
  ok: boolean;
  fails: string[];
  panelsChecked: string[];
}

function runValueOracle(live: LivePanel[]): CategoryResult {
  const fails: string[] = [];
  const checked: string[] = [];
  for (const panel of live) {
    const spec = resolveSpec(panel, fails);
    if (!spec) continue;
    checked.push(panel.key);
    for (const st of STATES) {
      const scope: Scope = { range: st.range, source: st.source };
      try {
        const expected = spec.recompute(RECORDS, RATE_CARD, ASOF, st.range, st.source);
        // Triangulate the recompute against the human-audited golden where one exists.
        const golden = goldenCellsFor(panel.key, st.range, st.source);
        if (golden) compareCells(`${panel.key} [${st.label}] recompute-vs-golden`, golden, expected, fails);
        renderRoute(spec.route, scope, createFixturesDataSource({ rateCard: RATE_CARD }));
        const root = requirePanelRoot(panel.key);
        compareCells(`${panel.key} [${st.label}] dom-vs-recompute`, expected, readDomCells(root), fails);
      } catch (e) {
        fails.push(`${panel.key} [${st.label}]: threw ${String((e as Error)?.message ?? e)}`);
      } finally {
        cleanup();
      }
    }
  }
  return { ok: fails.length === 0, fails: fails.slice(0, 16), panelsChecked: checked };
}

function isIntString(v: string): boolean {
  return /^-?\d+$/.test(v);
}

function runCouplingOracle(live: LivePanel[]): CategoryResult {
  const fails: string[] = [];
  const checked: string[] = [];
  const scope: Scope = { range: 'last30', source: 'all' };
  for (const panel of live) {
    const spec = resolveSpec(panel, fails);
    if (!spec) continue;
    // contributionHeatmap's DEFAULT mode is Tokens (no cost cell to scale here), so the generic
    // rate-card coupling can't apply; its $-mode scaling + the token-vector perturbation are proven by
    // the dedicated heatmap test (runHeatmapModeOracle) instead.
    if (panel.key === 'contributionHeatmap') continue;
    checked.push(panel.key);
    try {
      renderRoute(spec.route, scope, createFixturesDataSource({ rateCard: RATE_CARD }));
      const base = readDomCells(requirePanelRoot(panel.key));
      cleanup();
      if (!base.some((c) => COST_KINDS.has(c.kind) && isIntString(c.value) && BigInt(c.value) !== 0n)) {
        fails.push(`${panel.key}: no non-zero cost/rate cell to scale (panel not pipeline-bound?)`);
      }
      if (!base.some((c) => !COST_KINDS.has(c.kind))) {
        fails.push(`${panel.key}: no invariant (non cost/rate) cell present`);
      }
      const baseMap = new Map(base.map((c) => [keyOf(c), c]));
      for (const k of FACTORS) {
        renderRoute(spec.route, scope, createFixturesDataSource({ rateCard: scaleCardInline(RATE_CARD, k) }));
        const scaled = readDomCells(requirePanelRoot(panel.key));
        cleanup();
        if (scaled.length !== base.length) {
          fails.push(`${panel.key} x${k}: ${scaled.length} cells != base ${base.length}`);
        }
        for (const c of scaled) {
          const ref = baseMap.get(keyOf(c));
          if (!ref) {
            fails.push(`${panel.key} x${k}: unexpected ${keyOf(c)}`);
            continue;
          }
          if (c.kind !== ref.kind) {
            fails.push(`${panel.key} x${k}: ${keyOf(c)} kind ${c.kind} != ${ref.kind}`);
            continue;
          }
          if (COST_KINDS.has(c.kind)) {
            if (!isIntString(c.value) || !isIntString(ref.value) || BigInt(c.value) !== BigInt(ref.value) * BigInt(k)) {
              fails.push(`${panel.key} x${k}: ${keyOf(c)} ${c.value} != ${ref.value}*${k}`);
            }
          } else if (c.value !== ref.value) {
            fails.push(`${panel.key} x${k}: ${keyOf(c)} not invariant (${c.value} != ${ref.value})`);
          }
        }
      }
    } catch (e) {
      fails.push(`${panel.key}: coupling threw ${String((e as Error)?.message ?? e)}`);
      cleanup();
    }
  }
  return { ok: fails.length === 0, fails: fails.slice(0, 16), panelsChecked: checked };
}

async function runScopeMatrix(live: LivePanel[]): Promise<CategoryResult & { applicable: boolean }> {
  const checked = live.map((p) => p.key);
  if (live.length < 2) return { ok: true, fails: [], panelsChecked: checked, applicable: false };
  const fails: string[] = [];
  // Probe a NON-DEFAULT range AND a NON-DEFAULT source (default scope is last30/all) so that BOTH
  // dimensions of the shared scope must survive navigation — a shell that resets the source per
  // route FAILs here, not just one that resets the range (Codex r2 major #4).
  const RANGE_PROBE = 'All Time';
  const SOURCE_PROBE = 'Codex';
  for (const from of live) {
    for (const to of live) {
      if (from.key === to.key) continue;
      const toSpec = REGISTRY[to.key];
      const toRoute = toSpec?.route;
      if (!toSpec || toRoute === undefined) {
        fails.push(`${from.key}->${to.key}: no frozen spec/route for ${to.key}`);
        continue;
      }
      try {
        render(
          <AppProviders>
            <MemoryRouter initialEntries={[REGISTRY[from.key]?.route ?? from.configRoute]}>
              <AppShell />
            </MemoryRouter>
          </AppProviders>,
        );
        const rangeProbe = findFilterOption('range-filter', 'range-option', RANGE_PROBE);
        const sourceProbe = findFilterOption('source-filter', 'source-option', SOURCE_PROBE);
        if (!rangeProbe) {
          fails.push(`${from.key}->${to.key}: no "${RANGE_PROBE}" range option on ${from.key}`);
          continue;
        }
        if (!sourceProbe) {
          fails.push(`${from.key}->${to.key}: no "${SOURCE_PROBE}" source option on ${from.key}`);
          continue;
        }
        fireEvent.click(rangeProbe);
        fireEvent.click(sourceProbe);
        const probedRange = activeOptionLabel('range-filter', 'range-option');
        const probedSource = activeOptionLabel('source-filter', 'source-option');
        if (probedRange === null) {
          fails.push(`${from.key}->${to.key}: range did not activate on ${from.key}`);
          continue;
        }
        if (probedSource === null || !probedSource.includes(norm(SOURCE_PROBE))) {
          fails.push(`${from.key}->${to.key}: source did not activate to "${SOURCE_PROBE}" on ${from.key}`);
          continue;
        }
        const link = findNavLink(toRoute);
        if (!link) {
          fails.push(`${from.key}->${to.key}: ${to.key} unreachable (no nav link to ${toRoute})`);
          continue;
        }
        fireEvent.click(link);
        await waitFor(
          () => {
            // Destination RENDERED WITHIN its own panel root (not document-wide). Under the tool-only
            // SOURCE_PROBE (Codex) byProject is legitimately empty + the heatmap has no metric carrier,
            // so "rendered" = any recognized value carrier OR a valid per-section empty state — not
            // panel-metric specifically. Scope PERSISTENCE (the point of this matrix) is the two
            // activeOptionLabel assertions below.
            const root = requirePanelRoot(to.key);
            const rendered = ['panel-metric', 'heatmap-cell', 'breakdown-row', 'series-point', 'feed-item', 'byproject-empty', 'heatmap-empty'].some(
              (t) => within(root).queryAllByTestId(t).length > 0,
            );
            expect(rendered, `${to.key} rendered no recognized carrier/empty-state after nav`).toBe(true);
            // BOTH shared-scope dimensions survived the navigation.
            expect(activeOptionLabel('range-filter', 'range-option')).toBe(probedRange);
            expect(activeOptionLabel('source-filter', 'source-option')).toBe(probedSource);
          },
          { timeout: 2000 },
        );
        // Beyond persistence: the destination must render the CORRECT content for the shared scope —
        // compare its DOM to the recompute for (All Time, Codex). A nav-specific bug that renders an
        // empty/stale grid where data should exist (or the reverse) is caught, not waved through by a
        // mere "something rendered" check (Codex r2 #3). RANGE_PROBE/SOURCE_PROBE == 'all'/'codex'.
        const toSpec = resolveSpec(to, fails);
        if (toSpec) {
          compareCells(
            `scope-matrix ${from.key}->${to.key} @ all/codex`,
            toSpec.recompute(RECORDS, RATE_CARD, ASOF, 'all', 'codex'),
            readDomCells(requirePanelRoot(to.key)),
            fails,
          );
        }
      } catch (e) {
        fails.push(`${from.key}->${to.key}: ${String((e as Error)?.message ?? e)}`);
      } finally {
        cleanup();
      }
    }
  }
  return { ok: fails.length === 0, fails: fails.slice(0, 16), panelsChecked: checked, applicable: true };
}

// ---- contributionHeatmap mode oracle (the bucket/metric matrix the generic value oracle can't see) ----

const HEATMAP_MODES = [
  { bucket: 'day', bl: 'Daily', metric: 'tokens', ml: 'Tokens' },
  { bucket: 'week', bl: 'Weekly', metric: 'tokens', ml: 'Tokens' },
  { bucket: 'month', bl: 'Monthly', metric: 'tokens', ml: 'Tokens' },
  { bucket: 'day', bl: 'Daily', metric: 'cost', ml: '$' },
  { bucket: 'week', bl: 'Weekly', metric: 'cost', ml: '$' },
  { bucket: 'month', bl: 'Monthly', metric: 'cost', ml: '$' },
] as const;
/** Drive the heatmap to a (range, source, bucket, metric) mode through the REAL toggles + scope, and
 *  return its DOM cells (or push a fail and return null). */
function renderHeatmapMode(
  spec: PanelSpec,
  sc: { label: string; range: RangeKey; source: SourceKey },
  m: (typeof HEATMAP_MODES)[number],
  card: RateCard,
  fails: string[],
): Cell[] | null {
  renderRoute(spec.route, { range: sc.range, source: sc.source }, createFixturesDataSource({ rateCard: card }));
  const b = findFilterOption('bucket-filter', 'bucket-option', m.bl);
  const mt = findFilterOption('metric-filter', 'metric-option', m.ml);
  if (!b || !mt) {
    fails.push(`heatmap [${sc.label}]: missing ${!b ? `bucket "${m.bl}"` : `metric "${m.ml}"`} toggle option`);
    return null;
  }
  fireEvent.click(b);
  fireEvent.click(mt);
  const activeBucket = activeOptionLabel('bucket-filter', 'bucket-option');
  const activeMetric = activeOptionLabel('metric-filter', 'metric-option');
  if (activeBucket === null || !activeBucket.includes(norm(m.bl)) || activeMetric === null || !activeMetric.includes(norm(m.ml))) {
    fails.push(`heatmap [${sc.label}]: toggles did not activate to ${m.bl}/${m.ml}`);
    return null;
  }
  return readDomCells(requirePanelRoot('contributionHeatmap'));
}

function runHeatmapModeOracle(live: LivePanel[]): CategoryResult & { applicable: boolean } {
  const hm = live.find((p) => p.key === 'contributionHeatmap');
  if (!hm) return { ok: true, fails: [], panelsChecked: [], applicable: false };
  const fails: string[] = [];
  const spec = resolveSpec(hm, fails);
  if (!spec) return { ok: false, fails, panelsChecked: ['contributionHeatmap'], applicable: true };

  // Value-equality AND rate-card coupling over the FULL (range x source) matrix x every mode, via ONE
  // uniform check: DOM == recompute(card), for card in [base, ...scaled]. Base card = value equality; a
  // scaled card = coupling (cost cells x k, token cells invariant, intensity bins preserved since scaling
  // preserves rank, AND the cell SET unchanged — compareCells is total). $ modes sweep ALL frozen factors
  // over EVERY scope (full cost linearity, no unprobed scope — Codex r3 #2); token modes get base + one
  // scaled card everywhere (tokens must be INVARIANT to the card — one point proves it).
  const fullStates = RANGE_KEYS.flatMap((range) => SOURCE_KEYS.map((source) => ({ label: `${range}/${source}`, range, source })));
  for (const sc of fullStates) {
    for (const m of HEATMAP_MODES) {
      const factors = m.metric === 'cost' ? FACTORS : FACTORS.slice(0, 1);
      const cards: Array<{ card: RateCard; tag: string }> = [
        { card: RATE_CARD, tag: 'x1' },
        ...factors.map((k) => ({ card: scaleCardInline(RATE_CARD, k), tag: `x${k}` })),
      ];
      for (const { card, tag } of cards) {
        try {
          const dom = renderHeatmapMode(spec, sc, m, card, fails);
          cleanup();
          if (dom) {
            compareCells(
              `heatmap [${sc.label} ${m.bl}/${m.ml} ${tag}]`,
              recomputeContributionHeatmap(RECORDS, card, ASOF, sc.range, sc.source, m.bucket, m.metric),
              dom,
              fails,
            );
          }
        } catch (e) {
          fails.push(`heatmap [${sc.label} ${m.bl}/${m.ml} ${tag}]: threw ${String((e as Error)?.message ?? e)}`);
          cleanup();
        }
      }
    }
  }
  return { ok: fails.length === 0, fails: fails.slice(0, 16), panelsChecked: ['contributionHeatmap'], applicable: true };
}

// The (source, model) breakdown a focused cell must reveal: the cell's own records, grouped by
// source|model, summed in the active metric. Independent of the panel.
function recomputeCellBreakdown(
  records: readonly UsageRecord[],
  card: RateCard,
  asOf: string,
  range: RangeKey,
  source: SourceKey,
  bucket: Bucket,
  metric: Metric,
  cellProject: string,
  cellBucket: string,
): Cell[] {
  const scoped = scopeFilter(records, source);
  const cur = currentWindow(range, asOf, earliestOf(scoped, asOf));
  const cellRecs = scoped.filter(
    (r) => r.project === cellProject && inWindow(r.date, cur) && bucketOfInline(r.date, bucket) === cellBucket,
  );
  const by = new Map<string, bigint>();
  for (const r of cellRecs) {
    const k = `${r.source}|${r.model}`;
    by.set(k, (by.get(k) ?? 0n) + (metric === 'tokens' ? BigInt(tokenTotal(r)) : normalizeCost(r, card)));
  }
  return [...by.entries()].map(([key, v]) => ({ carrier: 'row' as Carrier, key, value: v.toString(), kind: metric === 'tokens' ? 'tokens' : 'cost' }));
}

// interaction oracle: focus/expand a nonzero REPO cell AND a nonzero TOOL cell, in Tokens AND $, and
// assert the revealed source|model breakdown is recomputed from the cell's own records (so the panel
// can neither omit the breakdown nor hardcode it).
function runHeatmapInteractionOracle(live: LivePanel[]): CategoryResult & { applicable: boolean } {
  const hm = live.find((p) => p.key === 'contributionHeatmap');
  if (!hm) return { ok: true, fails: [], panelsChecked: [], applicable: false };
  const fails: string[] = [];
  const spec = resolveSpec(hm, fails);
  if (!spec) return { ok: false, fails, panelsChecked: ['contributionHeatmap'], applicable: true };
  const modes = [
    { bucket: 'day', bl: 'Daily', metric: 'tokens', ml: 'Tokens' },
    { bucket: 'day', bl: 'Daily', metric: 'cost', ml: '$' },
  ] as const;
  // Read the EXPANDED breakdown rows, requiring each to be VISIBLE (Codex 0-E #9: a hidden breakdown
  // carrying correct attributes must not pass) and consistent, keyed source|model.
  const readBreakdown = (): Cell[] =>
    within(requirePanelRoot('contributionHeatmap'))
      .queryAllByTestId('breakdown-row')
      .map((n) => {
        if (!isVisible(n)) throw new Error('expanded heatmap breakdown-row is hidden — the breakdown is not shown to the user');
        const key = attr(n, 'data-row-key');
        const value = attr(n, 'data-row-value');
        const kind = attr(n, 'data-value-kind');
        assertVisibleConsistent('row', key, kind, value, n);
        return { carrier: 'row' as Carrier, key, value, kind };
      });
  // The runbook contract is "click OR Enter/Space". A NATIVE <button> is keyboard-accessible by spec
  // (the browser fires click on Enter/Space; jsdom does NOT synthesize that, so firing keydown at it
  // would false-reject a correct onClick button — Codex r2 #6). A role=button element must carry its
  // OWN key handler, so for it we require Enter AND Space to reveal the breakdown. Both must truly focus.
  for (const m of modes) {
    for (const wantSection of ['project', 'tool'] as const) {
      const base = `heatmap interaction [${m.ml}/${wantSection}]`;
      // First render: classify the cell (native button vs role=button) + assert it is a real tab stop.
      // An IIFE so the classification's own render is always cleaned up before the activation re-renders.
      const plan = ((): { project: string; bucket: string; methods: Array<[string, (c: Element) => void]> } | null => {
        try {
          if (!renderHeatmapMode(spec, { label: 'all/all', range: 'all', source: 'all' }, m, RATE_CARD, fails)) return null;
          const cell = within(requirePanelRoot('contributionHeatmap'))
            .queryAllByTestId('heatmap-cell')
            .find((c) => c.getAttribute('data-cell-section') === wantSection && isIntString(attr(c, 'data-cell-value')) && BigInt(attr(c, 'data-cell-value')) !== 0n);
          if (!cell) {
            fails.push(`${base}: no nonzero ${wantSection} cell to focus`);
            return null;
          }
          const tag = cell.tagName.toLowerCase();
          const role = cell.getAttribute('role');
          const tabindex = cell.getAttribute('tabindex');
          const isNativeButton = tag === 'button';
          // role=button needs an EXPLICIT non-negative tabindex (missing tabindex is NOT a tab stop —
          // Number(null) coercing to 0 must not slip through, Codex r2 #5).
          const isRoleButton = role === 'button' && tabindex !== null && /^\d+$/.test(tabindex.trim());
          if (!isNativeButton && !isRoleButton) {
            fails.push(`${base}: focused cell is not keyboard-operable (tag=${tag}, role=${role}, tabindex=${tabindex}) — needs <button> or role=button + tabindex>=0`);
            return null;
          }
          // It must actually TAKE focus — a real tab stop, not just the right attributes.
          (cell as HTMLElement).focus();
          if (cell.ownerDocument.activeElement !== cell) {
            fails.push(`${base}: cell did not receive focus on .focus() — not a real tab stop`);
            return null;
          }
          const methods: Array<[string, (c: Element) => void]> = [['click', (c) => fireEvent.click(c)]];
          if (isRoleButton) {
            // Fire the FULL key sequence (down + up) so an impl that activates on keyUp (a legitimate
            // ARIA pattern) is not false-rejected (Codex r3 #3).
            methods.push([
              'Enter',
              (c) => {
                fireEvent.keyDown(c, { key: 'Enter', code: 'Enter' });
                fireEvent.keyUp(c, { key: 'Enter', code: 'Enter' });
              },
            ]);
            methods.push([
              'Space',
              (c) => {
                fireEvent.keyDown(c, { key: ' ', code: 'Space' });
                fireEvent.keyUp(c, { key: ' ', code: 'Space' });
              },
            ]);
          }
          return { project: attr(cell, 'data-cell-row'), bucket: attr(cell, 'data-cell-bucket'), methods };
        } finally {
          cleanup();
        }
      })();
      if (!plan) continue;
      const p = plan;
      // Each activation on a FRESH render (activation toggles the expanded state).
      for (const [method, activate] of p.methods) {
        const label = `${base} via ${method}`;
        try {
          if (!renderHeatmapMode(spec, { label: 'all/all', range: 'all', source: 'all' }, m, RATE_CARD, fails)) {
            cleanup();
            continue;
          }
          const cell = within(requirePanelRoot('contributionHeatmap'))
            .queryAllByTestId('heatmap-cell')
            .find((c) => attr(c, 'data-cell-row') === p.project && attr(c, 'data-cell-bucket') === p.bucket);
          if (!cell) {
            fails.push(`${label}: target cell ${p.project}|${p.bucket} not found on re-render`);
            cleanup();
            continue;
          }
          activate(cell);
          const got = readBreakdown();
          const expected = recomputeCellBreakdown(RECORDS, RATE_CARD, ASOF, 'all', 'all', m.bucket, m.metric, p.project, p.bucket);
          if (expected.length === 0) fails.push(`${label}: focused a cell with no records`);
          compareCells(`${label} ${p.project}|${p.bucket}`, expected, got, fails);
        } catch (e) {
          fails.push(`${label}: threw ${String((e as Error)?.message ?? e)}`);
        } finally {
          cleanup();
        }
      }
    }
  }
  return { ok: fails.length === 0, fails: fails.slice(0, 16), panelsChecked: ['contributionHeatmap'], applicable: true };
}

// token-vector perturbation: bump ONE record's tokens by a known delta and assert that EXACTLY its
// (project, bucket) cell value moves by the delta — every other cell value is unchanged. Proves the
// token grid is computed from the data (not hardcoded) and attributed to the right cell. (Intensity
// bins legitimately re-quantile, so only VALUES are compared here; bins are pinned by the mode oracle.)
function runHeatmapPerturbationOracle(live: LivePanel[]): CategoryResult & { applicable: boolean } {
  const hm = live.find((p) => p.key === 'contributionHeatmap');
  if (!hm) return { ok: true, fails: [], panelsChecked: [], applicable: false };
  const fails: string[] = [];
  const spec = resolveSpec(hm, fails);
  if (!spec) return { ok: false, fails, panelsChecked: ['contributionHeatmap'], applicable: true };
  const DELTA = 73_137;
  const target = RECORDS.find((r) => sectionOf(r.project) === 'project' && r.date <= ASOF);
  if (!target) return { ok: true, fails: [], panelsChecked: ['contributionHeatmap'], applicable: true };
  const perturbedRecords = RECORDS.map((r) => (r === target ? { ...r, inputTokens: r.inputTokens + DELTA } : r));
  // SNAPSHOT carries `projects` at runtime (the cast at the top narrows it away); re-attach it so the
  // perturbed snapshot is a full, valid Snapshot the panel can render.
  const SNAP_FULL = SNAPSHOT as unknown as Snapshot;
  const dsFor = (records: readonly UsageRecord[]): DataSource => ({
    getSnapshot: () => ({ ...SNAP_FULL, records: records as UsageRecord[] }),
    getRateCard: () => RATE_CARD,
  });
  const targetKey = `${target.project}|${bucketOfInline(target.date, 'day')}`;
  try {
    // (1) The panel must MATCH the recompute over the PERTURBED data — values, intensity bins, AND
    // indices (so a panel can't recompute token values from changed data while hardcoding stale
    // colours/order). This is the value oracle over a DIFFERENT dataset -> proves the grid is data-derived.
    renderRoute(spec.route, { range: 'all', source: 'all' }, dsFor(perturbedRecords)); // default Daily x Tokens
    const perturbedDom = readDomCells(requirePanelRoot('contributionHeatmap'));
    cleanup();
    const perturbedExpected = recomputeContributionHeatmap(perturbedRecords, RATE_CARD, ASOF, 'all', 'all', 'day', 'tokens');
    compareCells('heatmap perturbation (dom == recompute over perturbed data)', perturbedExpected, perturbedDom, fails);
    // (2) Attribution property: bumping ONE record's tokens moves EXACTLY the target cell's VALUE by
    // DELTA — every other cell value unchanged (intensity legitimately re-quantiles, so only values).
    const baseExpected = recomputeContributionHeatmap(RECORDS, RATE_CARD, ASOF, 'all', 'all', 'day', 'tokens');
    const baseVals = new Map(baseExpected.filter((c) => c.carrier === 'heatmap').map((c) => [c.key, c.value]));
    let sawTarget = false;
    for (const c of perturbedExpected.filter((c) => c.carrier === 'heatmap')) {
      const bv = baseVals.get(c.key);
      if (bv === undefined) continue;
      if (c.key === targetKey) {
        sawTarget = true;
        if (BigInt(c.value) !== BigInt(bv) + BigInt(DELTA)) fails.push(`heatmap perturbation: target ${c.key} ${c.value} != ${bv}+${DELTA}`);
      } else if (c.value !== bv) {
        fails.push(`heatmap perturbation: unrelated cell ${c.key} moved (${bv} -> ${c.value})`);
      }
    }
    if (!sawTarget) fails.push(`heatmap perturbation: target cell ${targetKey} not found in the grid`);
  } catch (e) {
    fails.push(`heatmap perturbation: threw ${String((e as Error)?.message ?? e)}`);
    cleanup();
  }
  return { ok: fails.length === 0, fails: fails.slice(0, 16), panelsChecked: ['contributionHeatmap'], applicable: true };
}

// ---- result file ------------------------------------------------------------------------

interface OracleResult {
  /** Per-run provenance token injected by verify.mjs via ORACLE_RUN_NONCE and echoed here; the
   *  gate accepts this result ONLY if the vitest run exited 0 AND this matches (Codex r2 #1). */
  nonce: string | null;
  asOf: string;
  livePanels: string[];
  values: CategoryResult | null;
  coupling: CategoryResult | null;
  scopeMatrix: (CategoryResult & { applicable: boolean }) | null;
  heatmapModes: (CategoryResult & { applicable: boolean }) | null;
  heatmapInteraction: (CategoryResult & { applicable: boolean }) | null;
  heatmapPerturbation: (CategoryResult & { applicable: boolean }) | null;
}
const RESULT: OracleResult = {
  nonce: process.env.ORACLE_RUN_NONCE ?? null,
  asOf: ASOF,
  livePanels: LIVE.map((p) => p.key),
  values: null,
  coupling: null,
  scopeMatrix: null,
  heatmapModes: null,
  heatmapInteraction: null,
  heatmapPerturbation: null,
};
function writeResult(): void {
  // vitest runs with cwd = repo root; verify.mjs reads this exact path back.
  const dir = resolve(process.cwd(), '.verify-logs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'panel-oracle-result.json'), `${JSON.stringify(RESULT, null, 2)}\n`);
}

// ---- suite ------------------------------------------------------------------------------

describe('frozen panel oracle (verifier-owned — the trusted panel gate)', () => {
  afterAll(() => {
    writeResult();
  });

  it('value-equality: every live panel renders the snapshot recompute through the real route', () => {
    RESULT.values = runValueOracle(LIVE);
    expect(RESULT.values.fails).toEqual([]);
  });

  it('pipeline-coupling: cost/rate scale with the card, others invariant, on the real route', () => {
    RESULT.coupling = runCouplingOracle(LIVE);
    expect(RESULT.coupling.fails).toEqual([]);
  });

  it('scope-persistence: shared scope across the real nav matrix (>=2 live panels)', async () => {
    RESULT.scopeMatrix = await runScopeMatrix(LIVE);
    expect(RESULT.scopeMatrix.fails).toEqual([]);
  });

  // The heatmap blocks render the full (range x source) x mode x card matrix + the interaction sweep, so
  // they need a generous timeout (they are dormant/vacuous until the panel goes live).
  it('heatmap-modes: contributionHeatmap matches the recompute across day/week/month x tokens/$ (+ coupling)', () => {
    RESULT.heatmapModes = runHeatmapModeOracle(LIVE);
    expect(RESULT.heatmapModes.fails).toEqual([]);
  }, 180_000);

  it('heatmap-interaction: focus/expand reveals the source|model breakdown recomputed from the cell', () => {
    RESULT.heatmapInteraction = runHeatmapInteractionOracle(LIVE);
    expect(RESULT.heatmapInteraction.fails).toEqual([]);
  }, 60_000);

  it('heatmap-perturbation: a token bump moves exactly its own cell by the delta, no others', () => {
    RESULT.heatmapPerturbation = runHeatmapPerturbationOracle(LIVE);
    expect(RESULT.heatmapPerturbation.fails).toEqual([]);
  }, 60_000);
});
