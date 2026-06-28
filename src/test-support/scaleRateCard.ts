import type { RateCard, RateBand } from '@/domain/normalizeCost';

/**
 * VERIFIER-OWNED rate-card injection seam.
 *
 * Returns a copy of `card` with every per-token rate multiplied by the integer `factor`,
 * using exact BigInt string math (rates are base-10 integer strings, so `k × rate` stays an
 * integer string — no float ever enters). The `pipeline-coupling` proof injects this scaled
 * card through the `DataSource` value seam and asserts cost/rate-kind DOM values scale by `k`
 * while token/count/ratio/percent/date/label values stay invariant. Cost is `Σ tokensᵢ × rateᵢ`,
 * so scaling the card by `k` scales every cost by exactly `k` — a hardcoded or card-blind panel
 * cannot reproduce that.
 */
export function scaleRateCard(card: RateCard, factor: number): RateCard {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`scaleRateCard: factor must be a positive integer (got ${factor})`);
  }
  const k = BigInt(factor);
  const scaleRate = (v: string): string => (BigInt(v) * k).toString();
  const scaleBand = (b: RateBand): RateBand => ({
    effectiveFrom: b.effectiveFrom,
    effectiveTo: b.effectiveTo,
    input: scaleRate(b.input),
    output: scaleRate(b.output),
    cacheCreation: scaleRate(b.cacheCreation),
    cacheRead: scaleRate(b.cacheRead),
    reasoning: scaleRate(b.reasoning),
  });
  const rates: Record<string, readonly RateBand[]> = {};
  for (const [model, bands] of Object.entries(card.rates)) {
    rates[model] = bands.map(scaleBand);
  }
  return { version: card.version, asOf: card.asOf, unit: card.unit, rates };
}
