# Agent Observatory

A local-first dashboard that turns coding-agent usage into one **normalized cost + activity** surface —
apples-to-apples spend, token volume, and **per-project allocation** across **Claude Code, Codex, and
OpenClaw**, derived from [`ccusage`](https://github.com/ryoppippi/ccusage). Runs entirely on your machine;
no data leaves it.

**Six panels:** Spend Overview (daily spend + sparkline), By Source & Model, Cache Efficiency, Activity
Feed, a GitHub-style **Contribution Heatmap** (project × time), and a **By Project** leaderboard (token
share of the grid). All share one time-range + source scope.

## Why it's interesting

The dashboard is the easy part. The engineering worth a look is underneath it:

- **Exact-money pricing engine.** Cost is computed in **integer pico-USD with `BigInt`** end-to-end — no
  floats, no per-row rounding, ever. Each record is priced by a **point-in-time (SCD Type 2) effective-dated
  rate card**, so a price change *appends* a band and history never re-prices.
- **A frozen verifier harness.** The panels were built by an autonomous agent loop running *behind* a
  fail-closed verifier it could not edit or fool. A **panel oracle** independently recomputes every expected
  value from a frozen synthetic dataset and asserts it against the **real rendered app** — value equality,
  pipeline-coupling (cost scales with the rate card; token counts don't), and visible-text/visibility — backed
  by anti-gaming gates (frozen-file integrity, import boundary, no-egress, toolchain integrity).
- **Deterministic by construction.** A seeded synthetic snapshot + a hand-derived golden ledger make every
  number reproducible and reviewable.

## Architecture

```
ccusage (pinned) ──▶ decoders + resolver ──▶ canonical UsageRecord[] ──▶ pricing + aggregation ──▶ snapshot ──▶ SPA
   per-source          field-by-field         (source·project·model·day)  BigInt pico-USD           static     React panels
   --instances JSON    git-root attribution                                point-in-time bands
```

Each layer is a small, independently testable unit; money stays exact until it's formatted to USD at the very
last render step.

## Per-project attribution

The shipped dashboard currently shows the legacy `ccusage --instances` view: Claude usage is grouped by the
directory a session was **launched** from, then forward-matched against known git roots (see
`scripts/ingest.mjs`). That explains today's *Unattributed* rows, but it is not the long-term accounting
model and should not train a launch ritual.

The active ledger work lives in `packages/ledger`: raw agent transcripts are adapted into stable turns,
classified by the breadcrumbs each turn leaves (file activity, per-turn cwd, and later Bash targets), and
allocated into a first-class local session ledger. Once that projection replaces the legacy dashboard input,
project cost follows the work that actually happened rather than the terminal's starting directory.

Until that projection lands, Codex and OpenClaw remain tool rows in the heatmap's Tools strip, and the
By Project grid means repo + unattributed Claude work with tool rows excluded.

## Stack

Vite · React · TypeScript (strict) · **Tailwind v4 + shadcn/ui** (dark, on a validated dataviz palette) ·
vitest/jsdom · ESLint flat config (`--max-warnings 0`). Money math is `BigInt` integer-string pico-USD
throughout; the current dashboard resolves each `ccusage` instance cwd to its git-toplevel repo, while the
ledger package is the replacement path for activity-derived attribution.

## Scripts

| Script | Purpose |
| --- | --- |
| `dev` / `build` | Vite dev server / production build |
| `test` · `test:run` | Watch / single-run vitest |
| `lint` · `format` | ESLint (zero warnings) · Prettier |
| `data:generate` | Regenerate the deterministic synthetic snapshot |
| `verify:step` · `verify:demo-ready` | The fail-closed verifier (fast gates · full bar + panel oracle) |
