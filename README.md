# Agent Observatory

A local-first dashboard that turns coding-agent usage into one **normalized cost + activity** surface —
apples-to-apples spend and token volume across **Claude Code, Codex, and OpenClaw**, derived from
[`ccusage`](https://github.com/ryoppippi/ccusage). Runs entirely on your machine; no data leaves it.

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
ccusage (pinned) ──▶ decoders ──▶ canonical UsageRecord[] ──▶ pricing + aggregation ──▶ snapshot ──▶ SPA
   per-source         field-by-field      (source·model·day)     BigInt pico-USD          static     React panels
   JSON envelopes     wire validation                            point-in-time bands
```

Each layer is a small, independently testable unit; money stays exact until it's formatted to USD at the very
last render step.

## Stack

Vite · React · TypeScript (strict) · vitest/jsdom · ESLint flat config (`--max-warnings 0`). Money math is
`BigInt` integer-string pico-USD throughout.

## Scripts

| Script | Purpose |
| --- | --- |
| `dev` / `build` | Vite dev server / production build |
| `test` · `test:run` | Watch / single-run vitest |
| `lint` · `format` | ESLint (zero warnings) · Prettier |
| `data:generate` | Regenerate the deterministic synthetic snapshot |
| `verify:step` · `verify:demo-ready` | The fail-closed verifier (fast gates · full bar + panel oracle) |
