# Agent Observatory

A local-first dashboard that turns coding-agent usage into one **normalized cost + activity** surface —
apples-to-apples spend, token volume, and **per-project allocation** across **Claude Code, Codex, and
OpenClaw**. Claude project attribution comes from a local activity-derived ledger; Codex/OpenClaw remain
tool-level daily rows from [`ccusage`](https://github.com/ryoppippi/ccusage) until their transcript adapters
exist. Runs entirely on your machine; no data leaves it.

**Six panels:** Spend Overview (daily spend + sparkline), By Source & Model, Cache Efficiency, Activity
Feed, a GitHub-style **Contribution Heatmap** (project × time), and a **By Project** leaderboard (token
share of the grid). All share one time-range + source scope.

## Run it on your machine

Prereqs: Node `>=23.6.0`, npm, git, and Claude Code installed and used at least once so local transcripts
exist under `~/.claude/projects/`.

```sh
git clone https://github.com/East-Peak/agent-observatory.git
cd agent-observatory
npm ci
npm run ledger:init -- --projects-root "$HOME/projects"
npm run ledger:backfill -- --once
npm run ingest
npm run trust:sidecar
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open <http://127.0.0.1:4173>. If your repos live somewhere else, change `--projects-root`. For the detailed
setup, project-map schema, launchd/cron automation, and troubleshooting, see [docs/setup.md](docs/setup.md).

Data stays local. The app reads Claude Code transcripts plus the project map you configure; it does **not**
read your notes, memories, docs, email, browser data, or repo contents. See the [privacy contract](docs/privacy.md).

## Why it's interesting

The dashboard is the easy part. The engineering worth a look is underneath it:

- **Exact-money pricing engine.** Cost is computed in **integer pico-USD with `BigInt`** end-to-end — no
  floats, no per-row rounding, ever. Each record is priced by a **point-in-time (SCD Type 2) effective-dated
  rate card**, so a price change _appends_ a band and history never re-prices.
- **A frozen verifier harness.** The panels were built by an autonomous agent loop running _behind_ a
  fail-closed verifier it could not edit or fool. A **panel oracle** independently recomputes every expected
  value from a frozen synthetic dataset and asserts it against the **real rendered app** — value equality,
  pipeline-coupling (cost scales with the rate card; token counts don't), and visible-text/visibility — backed
  by anti-gaming gates (frozen-file integrity, import boundary, no-egress, toolchain integrity).
- **Deterministic by construction.** A seeded synthetic snapshot + a hand-derived golden ledger make every
  number reproducible and reviewable.

## Architecture

```
Claude transcripts ──▶ activity ledger ──▶ ledger projection ─┐
ccusage daily ─────────▶ tool decoders ────────────────────────┴─▶ canonical UsageRecord[] ──▶ aggregation ──▶ snapshot ──▶ SPA
  local/private          Codex/OpenClaw sentinels                  source·project·model·day      exact cost      static     React panels
                                                                   ledger rows carry costPico
```

Each layer is a small, independently testable unit; money stays exact until it's formatted to USD at the very
last render step.

## Per-project attribution

Claude project attribution now comes from `packages/ledger`: raw Claude Code transcripts are adapted into
stable turns, classified by the breadcrumbs each turn leaves (file activity, explicit Bash targets, and
per-turn cwd), allocated into a local durable ledger, then projected into the dashboard snapshot. Project cost
therefore follows the work that actually happened rather than the terminal's starting directory.

Ledger-projected records carry exact allocated `costPico` from the durable row, so per-project spend does not
drift by re-pricing split token vectors. Codex and OpenClaw remain tool rows in the heatmap's Tools strip until
their own transcript adapters exist; the By Project grid means ledger projects + unattributed Claude work with
tool rows excluded.

## Stack

Vite · React · TypeScript (strict) · **Tailwind v4 + shadcn/ui** (dark, on a validated dataviz palette) ·
vitest/jsdom · ESLint flat config (`--max-warnings 0`). Money math is `BigInt` integer-string pico-USD
throughout; ledger-projected rows preserve exact allocated cost, while token-native rows derive cost from the
effective-dated rate card.

## Scripts

| Script                              | Purpose                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| `dev` / `build`                     | Vite dev server / production build                              |
| `test` · `test:run`                 | Watch / single-run vitest                                       |
| `lint` · `format`                   | ESLint (zero warnings) · Prettier                               |
| `data:generate`                     | Regenerate the deterministic synthetic snapshot                 |
| `ledger:init`                       | Discover local git roots and write the private project map      |
| `ledger:backfill`                   | Build/update the private durable ledger from Claude transcripts |
| `ledger:ops:install` / `:uninstall` | Install/remove local launchd wrapper files for backfill/backup  |
| `ingest` · `trust:sidecar`          | Project ledger data into gitignored dashboard artifacts         |
| `verify:step` · `verify:demo-ready` | The fail-closed verifier (fast gates · full bar + panel oracle) |
