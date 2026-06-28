# Agent Observatory — build runbook (read EVERY iteration)

This is the authoritative per-iteration runbook for the autonomous `/goal` run. Re-read it at the
start of every iteration. Each iteration: pick the **lowest unchecked step NOT in Blocked / Skipped**,
implement it TDD (red → green), reach `npm run verify:step` green, **commit + push**, then run
`npm run verify:demo-ready` (it gates only currently-`live` panels and checks git clean/pushed, so it
only passes after pushing). Tick a box **only** on a green demo-ready.

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
  `data-feed-key="<source>|<date>|<model>"`, `data-feed-cost-pico`(cost), `data-feed-date`, `data-feed-source`.

At ≥2 live panels the oracle also navigates the REAL nav between EVERY ordered pair of live routes
and asserts the selected range is SHARED — so each new panel needs a reachable nav link + the shared
scope (it reads `useScope()`, never local state). `normalization-property` additionally checks
`normalizeCost` against an independent formula over hundreds of random records, so it cannot
special-case the public golden rows.

## Panel checklist (required for completion — may NEVER be parked)

The 4 required panels are tracked in `config/panels.json` (`"status": "live"` promotes a panel). A panel
goes live only when its `*.demo.test.tsx` (calling `describeLivePanel`) + `panel-golden` +
`pipeline-coupling` gates pass. ZERO are live at the baseline.

- [x] **spendOverview** — normalized $ + tokens, daily series + sparkline + delta (Phase-0 dry-fit:
      live; `panel-golden` + `pipeline-coupling` + frozen smoke green)
- [ ] **bySourceModel** — split by source & model, breakdown rows
- [ ] **cacheEfficiency** — cache-read vs fresh-input token mix + implied $ saved
- [ ] **activityFeed** — sessions over time + recent-runs list

## Supporting steps

- [x] DataSource seam (FixturesDataSource default + rate-card injection seam) + UTC clock provider
- [x] Shared scope bar (time-range + source) persisted across navigation (`describeScopePersistence`
      lands with the 2nd live panel; `scope-persistence` is n/a below 2 live panels)
- [ ] `scripts/ingest.mjs` (+ `--from-fixture` + fake-ccusage binary) — enables `ingest-fixture` /
      `ingest-argv` (currently report PENDING; not built)

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
