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

## Per-project attribution (read this if everything shows as *Unattributed*)

Attribution follows the directory a session is **launched** from — `ccusage --instances` reports usage per
session working directory, and the resolver forward-matches that directory against known git roots
(discovered under `~/projects` and `~/.openclaw/workspace`; see `scripts/ingest.mjs`). A directory *inside*
a repo attributes to the enclosing repo (longest match wins); no match fails closed to `__unattributed__`.

Two practical consequences:

- **Launch the agent from inside the repo you're working on.** A session started from your home directory
  lands in *Unattributed* even if it spends the whole time working on repos — `cd`-ing around after launch
  doesn't change the session's attribution.
- Codex and OpenClaw report no working directory, so they appear as **tool rows** (the heatmap's Tools
  strip), never in the project grid — a "project share" always means repo + unattributed, tools excluded.

The By Project panel calls this out automatically when the unattributed share exceeds 50%.

## Stack

Vite · React · TypeScript (strict) · **Tailwind v4 + shadcn/ui** (dark, on a validated dataviz palette) ·
vitest/jsdom · ESLint flat config (`--max-warnings 0`). Money math is `BigInt` integer-string pico-USD
throughout; per-project attribution resolves each record's cwd to its git-toplevel repo (nested cwds roll
up; unresolved → `__unattributed__`).

## Scripts

| Script | Purpose |
| --- | --- |
| `dev` / `build` | Vite dev server / production build |
| `test` · `test:run` | Watch / single-run vitest |
| `lint` · `format` | ESLint (zero warnings) · Prettier |
| `data:generate` | Regenerate the deterministic synthetic snapshot |
| `verify:step` · `verify:demo-ready` | The fail-closed verifier (fast gates · full bar + panel oracle) |
