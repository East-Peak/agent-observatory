/**
 * Per-section quantile intensity binning for the contribution heatmap. Bins are computed SEPARATELY
 * per section (repo cells among repo cells, tool cells among tool cells) and independently per metric
 * (a tokens ramp and a `$` ramp never share a scale). The rules, pinned for the frozen oracle:
 *  - **zero is its own bin (0)**, excluded from the scale,
 *  - the section's DISTINCT nonzero values are ranked and spread linearly across bins **1..bins**, so
 *    the smallest nonzero always lands on bin 1 and the largest on bin `bins` (the full ramp is used,
 *    even for a sparse section); a lone distinct value maps to bin `bins`,
 *  - **ties share a bin** (equal values share a rank → the same bin).
 */
export interface IntensityScale {
  readonly binCount: number;
  /** The bin index for a value: 0 for zero, else 1..binCount by its distinct-value rank. */
  binOf(value: bigint): number;
}

/**
 * Build an {@link IntensityScale} from a section's values (BigInt — costPico or BigInt(tokenCount)).
 * `bins` is the number of nonzero levels (default 4 → 5 levels including the zero bin, GitHub-style).
 */
export function quantileScale(values: readonly bigint[], bins = 4): IntensityScale {
  const distinct = [...new Set(values.filter((v) => v > 0n))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const k = distinct.length;
  // A distinct value's rank r (1..k) maps linearly to a bin: r=1 → 1, r=k → bins. A lone distinct
  // value (k=1) maps to the top bin (it is the section's only — hence strongest — activity level).
  const binForRank = (r: number): number => (k <= 1 ? bins : 1 + Math.round(((r - 1) / (k - 1)) * (bins - 1)));
  return {
    binCount: bins,
    binOf(value: bigint): number {
      if (value <= 0n) return 0;
      if (k === 0) return bins; // no nonzero reference (unreachable for a nonzero cell) — fail high
      // rank = the position of the largest distinct value <= `value` (so ties share, and a value
      // between two distinct levels takes the lower level's bin).
      let rank = 1;
      for (let i = 0; i < k; i++) {
        if (distinct[i]! <= value) rank = i + 1;
        else break; // ascending — the rest are greater
      }
      return binForRank(rank);
    },
  };
}
