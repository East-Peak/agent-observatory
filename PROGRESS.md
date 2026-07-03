# Agent Observatory — historical v2 panel build runbook

The v2 panel loop is complete. All six panels are live in `config/panels.json`, and
`certify:complete --expected-baseline-sha 3e58ef21198b5b8e961a65fb3e06fd9573d2361b` prints
`OBSERVATORY-V2-COMPLETE` on the current clean tree. Keep this file as the verifier/DOM contract reference
for future UI work, not as the current project checklist.

Historical loop rule: each iteration picked the lowest unchecked step, implemented it TDD (red → green),
reached `npm run verify:step`, committed + pushed, then ran `npm run verify:demo-ready`.

If a gate fails, **fix the app or data** — never edit a frozen file, the rate-card, any golden, or
weaken a gate (`verifier-integrity` FAILs). If the baseline tag or any frozen/golden fixture is missing
or differs from the pinned SHA, **STOP and report BLOCKED** — do not create, regenerate, or re-tag them.
If the same required gate fails 3× identically (`livelock-guard` prints `===BLOCKED===`), STOP and report
BLOCKED with the log. Never fabricate data.

## House-style testid contract (the frozen smoke reads RAW values)

- headline metric → `data-testid="panel-metric"` + `data-metric-value` + `data-value-kind`
- breakdown row → `data-testid="breakdown-row"` + `data-row-key` + `data-row-value` + `data-value-kind`
- series point → `data-testid="series-point"` + `data-point-value` + `data-value-kind`
- activity item → `data-testid="feed-item"` + `data-feed-key` + `data-feed-date` + `data-feed-source` +
  `data-feed-project` + `data-feed-cost-pico` (`data-value-kind="cost"`) + `data-feed-session`
- time-range control → `range-filter` / `range-option` (active `aria-current="true"`):
  `Last 7 Days` / `Last 30 Days` / `This Month` / `All Time`
- source control → `source-filter` / `source-option` (active `aria-current="true"`):
  `All` / `Claude Code` / `Codex` / `OpenClaw`
- **heatmap cell** → `data-testid="heatmap-cell"` + `data-cell-row` (projectKey) + `data-cell-bucket`
  (bucketId) + `data-cell-section` (`project` | `tool`) + `data-cell-value` + `data-value-kind`
  (`tokens` | `cost`) + `data-intensity` (bin `0`–`4`) + `data-cell-row-index` (GLOBAL — project-section
  rows first, then the Tools strip) + `data-cell-col-index` (bucket order) **AND an INLINE background
  colour** (`style="background-color: …"` or SVG `fill`) that is a **concrete rgb/hex/hsl** jsdom resolves
  to `rgb()` — NOT a CSS class, named colour, `var(--…)`, `currentColor`, `oklch()`, or `color-mix()` —
  non-blank, a pure function of `(section, bin)` (same section+bin ⇒ same colour), and **distinct across
  bins** within a section. Cells render in **row-major DOM order** (matching the two `-index` attrs).
- **byProject row** → the `breakdown-row` carrier above PLUS `data-row-tokens` (token volume) +
  `data-row-share` (basis points, integer) + `data-share-kind="percent"` + `data-row-index` (rank; DOM
  order non-decreasing by rank)
- **bucket control** → `bucket-filter` / `bucket-option` (active `aria-current="true"`):
  `Daily` / `Weekly` / `Monthly`
- **metric control** → `metric-filter` / `metric-option` (active `aria-current="true"`): `Tokens` / `$`
- **per-section empty state** → `data-testid="heatmap-empty"` (section `project` or `tool`) /
  `"byproject-empty"` + `data-empty-section` + non-blank `data-empty-reason` **AND visible prose** (the
  reason must be SHOWN, not only carried on the attribute)

All numeric raw values are base-10 integer strings (BigInt-parsed), never JS numbers. `cost` and `rate`
kinds scale with the rate card; `ratio` / `percent` / `tokens` / `count` / `date` / `label` are invariant.

## Per-panel DOM contract (the FROZEN panel oracle enforces these EXACTLY)

The `panel-golden` + `pipeline-coupling` gates run the verifier-owned **frozen panel oracle**
(`tests/oracle/panelOracle.test.tsx`, run via `vitest.oracle.config.ts`). For every `live` panel it
renders the REAL `<AppShell>` route at `config.panels[key].route`, then asserts the raw house-style
DOM values EQUAL an independent recompute from the frozen snapshot (and, where present, the
hand-derived `panel-golden.json`). Build each panel to emit **exactly** these testids/keys (all
cost values are pico-USD `BigInt` strings; the panel must derive them by flowing the injected
`dataSource.getRateCard()` through `normalizeCost` — a hardcoded or card-blind panel FAILs coupling).
Every panel applies the SAME shared `(range, source)` scope and renders the shared `<ScopeBar>`.

- **spendOverview** (`/`): metrics `total-cost`(cost) `total-tokens`(tokens) `active-days`(count)
  `delta-cost`(cost) `delta-pct`(percent); one `series-point`(cost) per active day (`data-point-date`).
- **bySourceModel** (`/by-source-model`): metric `total-cost`(cost); one `breakdown-row`(cost) per
  `(source, model)` in scope, `data-row-key="<source>|<model>"`, `data-row-value`=Σ pico cost.
- **cacheEfficiency** (`/cache-efficiency`): metrics `cache-read-tokens`(tokens)
  `cache-creation-tokens`(tokens) `fresh-input-tokens`(tokens) `saved-cost`(cost). `saved-cost` =
  Σ cacheReadTokens × (input rate − cacheRead rate) at each record's point-in-time band.
- **activityFeed** (`/activity-feed`): metric `total-cost`(cost); one `feed-item` per scoped record,
  `data-feed-key="<source>|<date>|<model>|<projectKey>"`, `data-feed-cost-pico`(cost), `data-feed-date`, `data-feed-source`.

The four panels above are the v1 set. The two below are the v2 panels, now live as well. Their recompute is
the frozen `recomputeContributionHeatmap` / `recomputeByProject` in the oracle — match it EXACTLY for any
future panel edits.

- **contributionHeatmap** (`/contribution`): a dense **project × time** grid in two sections. **Project
  grid** rows = repos + `__unattributed__` (kind `repo`/`unattributed`), ordered by effort **desc** with
  **Unattributed last**; **Tools strip** rows = whichever of `__codex__` / `__openclaw__` are present, in
  that fixed order. Columns = **every** bucket in the current window (DENSE — materialize zero cells too),
  per the `bucket` toggle (`Daily`→ISO date, `Weekly`→ISO-Monday, `Monthly`→`YYYY-MM`). Each `heatmap-cell`
  `data-cell-value` = the `metric` toggle: `Tokens` = Σ token totals; `$` = Σ `normalizeCost` (pico). Its
  `data-intensity` is the **frozen `quantileScale`** bin computed **per section** (`0` for a zero cell;
  distinct nonzero values spread over bins `1`–`4`; the Tokens and `$` ramps are independent) — and the
  inline cell colour is bound to that bin (see the carrier contract). Default view is **Daily × Tokens**;
  the `bucket`/`metric` toggles switch mode; the shared `range`/`source` scope filters records first. **$**
  cells scale with the rate card; **token** cells are invariant. **Focus/expand** a nonzero cell (it must
  be a real tab stop — native `<button>`, or `role="button"` + non-negative `tabindex` — activatable by
  **click AND Enter/Space**) reveals `breakdown-row`s keyed `"<source>|<model>"` recomputed from THAT
  cell's records (`data-row-value` = Σ value in the active metric; visible). A section with no rows in
  scope renders `heatmap-empty` for that section (`project` under a tool-only source; `tool` under
  `source=Claude Code`).
- **byProject** (`/by-project`): metric `total-cost`(cost) = Σ cost over the **repo + `__unattributed__`
  grid** (tools EXCLUDED). One `breakdown-row` per repo + Unattributed: `data-row-key`=projectKey,
  `data-row-value`=Σ pico cost(cost), `data-row-tokens`=Σ tokens, `data-row-share`=token share **of the
  grid** in basis points (denominator = repo+unattributed grid tokens; tools excluded)(`percent`),
  `data-row-index`=rank (repos effort-**desc**, then Unattributed **last**). A tool-only scope (grid empty)
  renders `byproject-empty` (not a zero-row table).

At ≥2 live panels the oracle also navigates the REAL nav between EVERY ordered pair of live routes
and asserts the selected range is SHARED — so each new panel needs a reachable nav link + the shared
scope (it reads `useScope()`, never local state). `normalization-property` additionally checks
`normalizeCost` against an independent formula over hundreds of random records, so it cannot
special-case the public golden rows.

## Panel checklist (required for completion — may NEVER be parked)

The **6** required panels are tracked in `config/panels.json` (`"status": "live"` promotes a panel). A
panel goes live only when its `*.demo.test.tsx` (calling `describeLivePanel`) + `panel-golden` +
`pipeline-coupling` gates pass. All six panels are live; future panel changes must preserve those gates.

- [x] **spendOverview** — normalized $ + tokens, daily series + sparkline + delta (v1, live)
- [x] **bySourceModel** — split by source & model, breakdown rows (v1, live)
- [x] **cacheEfficiency** — cache-read vs fresh-input token mix + implied $ saved (v1, live)
- [x] **activityFeed** — sessions over time + recent-runs list (v1, live)
- [x] **contributionHeatmap** — project × time colour grid (project rows + Tools strip; Daily/Weekly/
      Monthly × Tokens/$ toggles; per-section intensity; focus→(source,model) breakdown)
- [x] **byProject** — repo-grid leaderboard: cost + token share of the grid (repos desc, Unattributed last)

## Supporting steps

- [x] DataSource seam (FixturesDataSource default + rate-card injection seam) + UTC clock provider
- [x] Shared scope bar (time-range + source) persisted across navigation (`describeScopePersistence`)
- [x] `scripts/ingest.mjs` (+ `--from-fixture` + fake-ccusage binary) — `ingest-fixture` / `ingest-argv`
      green; the v2 project ingest (`--instances` decoder + resolver) is built + frozen (`project-ingest-contract`)
- [x] Per-project engine (`projectIdentity` / `buckets` / `intensity` / `aggregateByProjectPeriod` /
      `aggregateByProject`) + snapshot `projects` registry — all built + frozen; panels render these, they
      do not re-implement them

## Blocked / Skipped

No item is blocked or skipped. (Required panels/steps may NEVER appear here — `progress-consistency`
FAILs if any required panel name does.)

| item | reason | since |
|------|--------|-------|
| _(none)_ | | |

## Operator assumptions (pre-launch)

- **Toolchain installed from the frozen lockfile.** `package-lock.json` is FROZEN (in `FROZEN_FILES`),
  and the `toolchain-integrity` gate pins `vitest`/`tsx`/`vite` to their locked versions by running each
  resolved `node_modules/.bin/<tool> --version` and requiring an exact match, plus `npm ls … --depth=0`
  clean. `node_modules` is gitignored, so a tampered local binary is invisible to `git-clean`; this gate
  is what makes a fake local Vitest (that could echo `ORACLE_RUN_NONCE` and forge the oracle result)
  fail closed. The operator MUST install deps with `npm ci` (from the frozen lockfile) before launch and
  must NOT mutate `node_modules` mid-run; the gate verifies that assumption rather than reinstalling each
  iteration (too slow/fragile for the loop).

## Failure history

`scripts/verify.mjs --demo-ready` appends each run's failing app-logic gates to
`.verify-logs/failure-history.json` (gitignored). `scripts/livelock-guard.mjs` reads it: 3 identical
consecutive failures of the same required gate → terminal `===BLOCKED===`.
