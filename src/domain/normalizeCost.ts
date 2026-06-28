import type { UsageRecord } from './types';

/** One effective-dated price band for a model, in **integer pico-USD per token**
 * (base-10 integer strings — never JS numbers). Choosing pico-USD-per-token makes
 * cost a pure exact BigInt multiply-sum: no division, no per-row rounding, ever. */
export interface RateBand {
  /** YYYY-MM-DD, inclusive lower bound. */
  readonly effectiveFrom: string;
  /** YYYY-MM-DD, **exclusive** upper bound; `null` = open/current band. */
  readonly effectiveTo: string | null;
  readonly input: string;
  readonly output: string;
  readonly cacheCreation: string;
  readonly cacheRead: string;
  /** Codex reasoning tokens (billed at the output rate); 0-token for other sources. */
  readonly reasoning: string;
}

export interface RateCard {
  readonly version: string;
  readonly asOf: string;
  readonly unit: 'picoUsdPerToken';
  /**
   * Per model, a list of effective-dated price bands. **Point-in-time pricing**:
   * a record is priced by the band whose `[effectiveFrom, effectiveTo)` window
   * contains its date, so history never re-prices when prices change going forward
   * (a price change appends a band, never overwrites — SCD Type 2).
   */
  readonly rates: Readonly<Record<string, readonly RateBand[]>>;
}

/** Thrown when a record's model has no rate, or no band covers its date (fail
 * closed — never silently mis-price). */
export class RateCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateCardError';
  }
}

/** The price band in effect for `model` on `date` (point-in-time). Fails closed. */
export function selectBand(card: RateCard, model: string, date: string): RateBand {
  const bands = card.rates[model];
  if (!bands) {
    throw new RateCardError(`no rate for model "${model}" in rate card ${card.version}`);
  }
  // YYYY-MM-DD compares lexicographically = chronologically (no Date, deterministic).
  const band = bands.find(
    (b) => b.effectiveFrom <= date && (b.effectiveTo === null || date < b.effectiveTo),
  );
  if (!band) {
    throw new RateCardError(`no rate band for model "${model}" on ${date} (rate card ${card.version})`);
  }
  return band;
}

/** Cost of one usage record in **pico-USD (BigInt)**, priced at the band in effect
 * on the record's date: Σ tokensᵢ × rateᵢ, exact. */
export function normalizeCost(record: UsageRecord, card: RateCard): bigint {
  const band = selectBand(card, record.model, record.date);
  return (
    BigInt(record.inputTokens) * BigInt(band.input) +
    BigInt(record.outputTokens) * BigInt(band.output) +
    BigInt(record.cacheCreationTokens) * BigInt(band.cacheCreation) +
    BigInt(record.cacheReadTokens) * BigInt(band.cacheRead) +
    BigInt(record.reasoningTokens) * BigInt(band.reasoning)
  );
}
