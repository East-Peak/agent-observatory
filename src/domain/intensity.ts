/**
 * Per-section quantile intensity binning for the contribution heatmap. Bins are computed SEPARATELY
 * per section (repo cells among repo cells, tool cells among tool cells) and independently per metric
 * (a tokens ramp and a `$` ramp never share a scale). The rules, pinned for the frozen oracle:
 *  - **zero is its own bin (0)** and is excluded from the quantile breakpoints,
 *  - nonzero values get bins **1..bins** by their rank among the section's nonzero values,
 *  - **ties share a bin** (equal values get the same — lower — bin).
 */
export interface IntensityScale {
  readonly binCount: number;
  /** The bin index for a value: 0 for zero, else 1..binCount by quantile rank. */
  binOf(value: bigint): number;
}

/**
 * Build an {@link IntensityScale} from a section's values (BigInt — costPico or BigInt(tokenCount)).
 * `bins` is the number of nonzero levels (default 4 → 5 levels including the zero bin, GitHub-style).
 */
export function quantileScale(values: readonly bigint[], bins = 4): IntensityScale {
  const nonzero = values.filter((v) => v > 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = nonzero.length;
  return {
    binCount: bins,
    binOf(value: bigint): number {
      if (value <= 0n) return 0;
      if (n === 0) return bins; // no nonzero reference (shouldn't occur for a nonzero cell) — fail high
      // lessCount = section values strictly less than `value`; equal values share the lower bin.
      let lessCount = 0;
      for (const v of nonzero) {
        if (v < value) lessCount++;
        else break; // ascending — the rest are >= value
      }
      return Math.min(1 + Math.floor((bins * lessCount) / n), bins);
    },
  };
}
