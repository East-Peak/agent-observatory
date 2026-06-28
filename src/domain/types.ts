/** The three usage sources the Observatory unifies. */
export type Source = 'claude' | 'codex' | 'openclaw';

/**
 * One canonical raw usage record: a single (source, date, model) cell of token
 * counts. Decoders map each source's divergent ccusage envelope onto this shape.
 *
 * Token counts only — ccusage's own (float) cost is deliberately discarded; cost
 * is re-derived downstream from these tokens via the frozen rate-card (BigInt).
 * `reasoningTokens` is Codex-only and 0 for the other sources.
 */
export interface UsageRecord {
  readonly source: Source;
  /** ISO calendar day, YYYY-MM-DD. */
  readonly date: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokens: number;
}

/**
 * A canonical-records snapshot: what the SPA reads. `asOf` is the reference "today"
 * that all relative time-ranges anchor to (never wall-clock). Fixtures and real
 * ingest both produce this shape; cost is derived from `records` at read time.
 */
export interface Snapshot {
  /** YYYY-MM-DD reference date for relative ranges. */
  readonly asOf: string;
  readonly records: readonly UsageRecord[];
}
