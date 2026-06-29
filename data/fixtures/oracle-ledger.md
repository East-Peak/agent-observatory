# Oracle Ledger — frozen, independently-derived pricing provenance

**FROZEN** (part of the verifier baseline). This is the human-auditable derivation behind `rateCard.json`
and (later) the normalization golden — written independently of the app's pricing code so a wrong rate can't
hide. Updating prices is a deliberate re-baseline: edit here + `rateCard.json`, re-derive the golden, re-tag.

## Model: point-in-time, effective-dated (SCD Type 2)

Cost is a **point-in-time fact**. Each record is priced by the band whose `[effectiveFrom, effectiveTo)`
window contains its `date`. A price change **appends** a band (close the open band's `effectiveTo`, open a
new one) — it never overwrites, so history never re-prices. All v1 bands use floor `effectiveFrom = 2026-01-01`
(before the earliest log, 2026-02-19) with `effectiveTo = null` (open). The forward monthly cron appends.

## Conversion rule

`picoUsdPerToken = USD_per_Mtok × 1,000,000` (1 pico-USD = 1e-12 USD; 1 Mtok = 1e6 tokens; so
USD/Mtok × 1e12 / 1e6 = USD/Mtok × 1e6). All published prices here have ≤3 decimal places, so the pico value
is always an exact integer.

## Cache + reasoning conventions

- **Anthropic**: `cacheCreation` (5-minute write) = **1.25 × input**; `cacheRead` = **0.10 × input** (Anthropic's
  documented standard multipliers).
- **OpenAI/Codex**: no separate cache-write charge → `cacheCreation` = **input** (and is ~always 0 tokens in the
  data); `cacheRead` = **0.10 × input** (OpenAI's standard cached-input discount; the exact Codex cache rate
  isn't separately published — flagged `est` below).
- `reasoning` = **output** rate for every model (only Codex carries reasoning tokens; 0 elsewhere, so the value
  is inert for Anthropic).

## Rate table (USD per Mtok → pico-USD per token, matching rateCard.json v1)

| model | in $ | out $ | cacheCreate $ | cacheRead $ | → in pico | out pico | cc pico | cr pico | source |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| claude-opus-4-8 | 5 | 25 | 6.25 | 0.50 | 5000000 | 25000000 | 6250000 | 500000 | A |
| claude-opus-4-8-fast | 10 | 50 | 12.50 | 1.00 | 10000000 | 50000000 | 12500000 | 1000000 | B |
| claude-opus-4-7 | 5 | 25 | 6.25 | 0.50 | 5000000 | 25000000 | 6250000 | 500000 | A |
| claude-opus-4-7-fast | 30 | 150 | 37.50 | 3.00 | 30000000 | 150000000 | 37500000 | 3000000 | B |
| claude-opus-4-6 | 5 | 25 | 6.25 | 0.50 | 5000000 | 25000000 | 6250000 | 500000 | A |
| claude-sonnet-4-6 | 3 | 15 | 3.75 | 0.30 | 3000000 | 15000000 | 3750000 | 300000 | A |
| claude-haiku-4-5-20251001 | 1 | 5 | 1.25 | 0.10 | 1000000 | 5000000 | 1250000 | 100000 | A |
| claude-fable-5 | 10 | 50 | 12.50 | 1.00 | 10000000 | 50000000 | 12500000 | 1000000 | A |
| gpt-5.3-codex | 1.75 | 14 | 1.75 | 0.175 `est` | 1750000 | 14000000 | 1750000 | 175000 | C |
| gpt-5.4 | 2.50 | 15 | 2.50 | 0.25 `est` | 2500000 | 15000000 | 2500000 | 250000 | C |
| gpt-5.4-mini | 0.25 `est` | 2.00 `est` | 0.25 `est` | 0.025 `est` | 250000 | 2000000 | 250000 | 25000 | D |
| gpt-5.5 | 5 | 30 | 5 | 0.50 `est` | 5000000 | 30000000 | 5000000 | 500000 | C |

`est` = estimate (verify in Phase 2 tie-out against ccusage). reasoning pico = output pico for every model.

## Sources

- **A — Anthropic API list pricing** (input/output): claude-api reference / `platform.claude.com/docs/en/about-claude/pricing`.
  Cache + reasoning derived via the documented multipliers above.
- **B — Anthropic fast-mode pricing**: opus-4-8-fast $10/$50 and opus-4-7-fast $30/$150 (the 4.7→4.8 "3× cheaper
  fast mode" change). Sources: anthropic.com/news/claude-opus-4-8, VentureBeat, Neowin (2026-05).
- **C — OpenAI list pricing**: gpt-5.5 $5/$30 (LiteLLM dataset `model_prices_and_context_window.json` +
  developers.openai.com/api/docs/pricing), gpt-5.4 $2.50/$15, gpt-5.3-codex $1.75/$14
  (developers.openai.com/codex/pricing). Codex `cacheRead` uses the standard 10% cached-input discount (`est`).
- **D — gpt-5.4-mini ESTIMATE**: not present in the LiteLLM dataset or vendor pages; typical mini-tier estimate.
  Appears in the logs for **one day only** (2026-04-12), so blast radius is negligible. Verify in Phase 2.

## Golden derivation — normalization-input.json → expected-normalized.json

Hand-computed `Σ tokensᵢ × pico_rateᵢ` (exact integer pico-USD) using the v1 bands above. Independent of the
app's `normalizeCost`; the `normalization-golden` test then asserts the code reproduces these.

**Row 1 — claude-sonnet-4-6 @ 2026-06-01** (in 3e6 / out 15e6 / cc 3.75e6 / cr 0.3e6):
- input    1000 × 3,000,000  =  3,000,000,000
- output    500 × 15,000,000 =  7,500,000,000
- cacheCreate 200 × 3,750,000 =    750,000,000
- cacheRead 5000 × 300,000   =  1,500,000,000
- reasoning   0              =              0
- **= 12,750,000,000**

**Row 2 — gpt-5.5 @ 2026-06-15** (in 5e6 / out 30e6 / cc 5e6 / cr 0.5e6 / reasoning=out 30e6):
- input    2000 × 5,000,000  = 10,000,000,000
- output   1000 × 30,000,000 = 30,000,000,000
- cacheCreate 0              =              0
- cacheRead 8000 × 500,000   =  4,000,000,000
- reasoning 300 × 30,000,000 =  9,000,000,000
- **= 53,000,000,000**

**Row 3 — claude-opus-4-8-fast @ 2026-06-02** (in 10e6 / out 50e6 / cc 12.5e6 / cr 1e6):
- input    100 × 10,000,000  =  1,000,000,000
- output    50 × 50,000,000  =  2,500,000,000
- cacheCreate 10 × 12,500,000 =   125,000,000
- cacheRead 200 × 1,000,000  =    200,000,000
- reasoning  0               =              0
- **= 3,825,000,000**

**Row 4 — gpt-5.3-codex @ 2026-03-01** (in 1.75e6 / out 14e6 / cc 1.75e6 / cr 0.175e6 / reasoning=out 14e6):
- input    500 × 1,750,000   =    875,000,000
- output   300 × 14,000,000  =  4,200,000,000
- cacheCreate 0              =              0
- cacheRead 1000 × 175,000   =    175,000,000
- reasoning 100 × 14,000,000 =  1,400,000,000
- **= 6,650,000,000**

**Total** = 12,750,000,000 + 53,000,000,000 + 3,825,000,000 + 6,650,000,000 = **76,225,000,000** pico-USD
(= $0.076225).

## Panel golden derivation — synthetic-snapshot.json → panel-golden.json (spendOverview)

`panel-golden.json` freezes the expected RAW house-style DOM values for the `spendOverview` panel at
named `(range, source)` states, anchored to `snapshot.asOf = 2026-06-27`. It locks the panel's wiring —
range windowing, source filtering, delta-vs-prior windowing, and DOM emission — to the verified cost
pipeline. The cost primitives (`normalizeCost` / `aggregateByDay`) are already proven exact by
`normalization-golden` above; this golden adds the windowing + aggregation + emission layer on top.

**Independence.** The golden was derived **without the panel component**: window bounds were recomputed
with a second, independent implementation (native UTC `Date` ordinals, not the app's pure-integer Hinnant
math in `src/domain/dateRange.ts`), filtering was inlined, and only the cost primitives were reused. So a
windowing bug in the app surfaces as a golden mismatch rather than hiding. The
`tests/panels/spendOverview.golden.test.tsx` test then renders the live panel for each state and asserts
the RAW `data-metric-value` / `data-point-value` integers (and `data-value-kind`) equal this file exactly.

**Window rules** (asOf = 2026-06-27; `current = [from, to]`; `prior` = equal-length window immediately
before `current`; for `All Time`, `from` = earliest in-scope day so `prior` is empty → delta = total):

| range | current `[from, to]` |
|---|---|
| Last 7 Days | `[2026-06-21, 2026-06-27]` |
| Last 30 Days | `[2026-05-29, 2026-06-27]` |
| This Month | `[2026-06-01, 2026-06-27]` |
| All Time | `[<earliest in-scope>, 2026-06-27]` |

**Metrics per state**: `total-cost` (cost, Σ pico-USD), `total-tokens` (tokens, Σ of all 5 token types),
`active-days` (count, distinct days), `delta-cost` (cost, `total − prior`, signed), `delta-pct` (percent,
basis points = `(delta × 10000) ÷ prior` integer-divided, `0` when no prior baseline). `series` = per-day
`costPico` in date order (the sparkline). Coupling note: `cost`-kind values scale linearly with the rate
card; `tokens` / `count` / `percent` stay invariant — `scale-factors.json` + the coupling test enforce this.

**Derived state totals** (pico-USD; reproduced by re-running the documented derivation):

| range / source | window | total-cost | tokens | active-days | delta-cost | delta-bp | points |
|---|---|--:|--:|--:|--:|--:|--:|
| all / all | 2026-05-19..2026-06-27 | 696496510350000 | 953620556 | 40 | 696496510350000 | 0 | 40 |
| last7 / all | 2026-06-21..2026-06-27 | 131393658800000 | 158361185 | 7 | 33240678550000 | 3386 | 7 |
| thisMonth / all | 2026-06-01..2026-06-27 | 473702740650000 | 685098244 | 27 | 250908970950000 | 11261 | 27 |
| last30 / claude | 2026-05-29..2026-06-27 | 338703163850000 | 439350339 | 30 | 234454078750000 | 22489 | 30 |
| all / codex | 2026-05-19..2026-06-27 | 172675456500000 | 246451984 | 32 | 172675456500000 | 0 | 32 |
| all / openclaw | 2026-05-19..2026-06-27 | 80868804900000 | 160274685 | 25 | 80868804900000 | 0 | 25 |

*(Re-derived 2026-06-29 for the v2 project-aware snapshot — 164 records, `project` dimension added. Windows
are unchanged (same `asOf` + span); only per-day token/cost distribution shifted as claude records spread
across the repo projects. Cross-checked: this native-Date derivation == the app's `dateRange.ts` recompute
== the live panel DOM, all three independent.)*
