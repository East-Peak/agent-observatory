export type Source = 'claude' | 'codex' | 'openclaw';

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly reasoning: number;
}

export interface BillableUsage {
  readonly source: Source;
  /** UTC billing date, YYYY-MM-DD. */
  readonly date: string;
  readonly model: string;
  readonly usage: TokenUsage;
}

/** One effective-dated price band for a model, in integer pico-USD per token. */
export interface RateBand {
  /** YYYY-MM-DD, inclusive lower bound. */
  readonly effectiveFrom: string;
  /** YYYY-MM-DD, exclusive upper bound; `null` = open/current band. */
  readonly effectiveTo: string | null;
  readonly input: string;
  readonly output: string;
  readonly cacheCreation: string;
  readonly cacheRead: string;
  /** Reasoning tokens are billed at the output rate for models that expose them. */
  readonly reasoning: string;
}

export interface RateCard {
  readonly version: string;
  readonly asOf: string;
  readonly unit: 'picoUsdPerToken';
  readonly rates: Readonly<Record<string, readonly RateBand[]>>;
}

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

  const band = bands.find((b) => b.effectiveFrom <= date && (b.effectiveTo === null || date < b.effectiveTo));
  if (!band) {
    throw new RateCardError(`no rate band for model "${model}" on ${date} (rate card ${card.version})`);
  }
  return band;
}

/** Cost of one billable usage row in pico-USD (BigInt): Σ tokens_i * rate_i, exact. */
export function normalizeCost(record: BillableUsage, card: RateCard): bigint {
  const band = selectBand(card, record.model, record.date);
  const { usage } = record;
  return (
    BigInt(usage.input) * BigInt(band.input) +
    BigInt(usage.output) * BigInt(band.output) +
    BigInt(usage.cacheCreation) * BigInt(band.cacheCreation) +
    BigInt(usage.cacheRead) * BigInt(band.cacheRead) +
    BigInt(usage.reasoning) * BigInt(band.reasoning)
  );
}
