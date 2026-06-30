import type { Source, UsageRecord } from './types';
import { normalizeCost, selectBand, type RateCard } from './normalizeCost';
import { bucketsInWindow, bucketOf, type BucketKind } from './buckets';
import { inWindow, type DateWindow } from './dateRange';
import { UNATTRIBUTED, metaForKey } from './projects';

const tokenTotal = (r: UsageRecord): number =>
  r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;

/** Per-day rollup: normalized cost (pico-USD BigInt) + summed token counts. */
export interface DayTotal {
  readonly date: string;
  readonly costPico: bigint;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

type MutableDayTotal = {
  date: string;
  costPico: bigint;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

/** Roll records up by calendar day, ascending by date. */
export function aggregateByDay(records: readonly UsageRecord[], card: RateCard): DayTotal[] {
  const byDate = new Map<string, MutableDayTotal>();
  for (const r of records) {
    let acc = byDate.get(r.date);
    if (!acc) {
      acc = {
        date: r.date,
        costPico: 0n,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      };
      byDate.set(r.date, acc);
    }
    acc.costPico += normalizeCost(r, card);
    acc.inputTokens += r.inputTokens;
    acc.outputTokens += r.outputTokens;
    acc.cacheCreationTokens += r.cacheCreationTokens;
    acc.cacheReadTokens += r.cacheReadTokens;
    acc.reasoningTokens += r.reasoningTokens;
    acc.totalTokens +=
      r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Per (source, model) rollup. */
export interface SourceModelTotal {
  readonly source: Source;
  readonly model: string;
  readonly costPico: bigint;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

type MutableSMT = {
  source: Source;
  model: string;
  costPico: bigint;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

/** Roll records up by (source, model), most expensive first (tie-break source|model asc). */
export function aggregateBySourceModel(
  records: readonly UsageRecord[],
  card: RateCard,
): SourceModelTotal[] {
  const by = new Map<string, MutableSMT>();
  for (const r of records) {
    const key = `${r.source}|${r.model}`;
    let acc = by.get(key);
    if (!acc) {
      acc = {
        source: r.source,
        model: r.model,
        costPico: 0n,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      };
      by.set(key, acc);
    }
    acc.costPico += normalizeCost(r, card);
    acc.inputTokens += r.inputTokens;
    acc.outputTokens += r.outputTokens;
    acc.cacheCreationTokens += r.cacheCreationTokens;
    acc.cacheReadTokens += r.cacheReadTokens;
    acc.reasoningTokens += r.reasoningTokens;
    acc.totalTokens +=
      r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;
  }
  return [...by.values()].sort((a, b) => {
    if (a.costPico !== b.costPico) return a.costPico > b.costPico ? -1 : 1;
    const ka = `${a.source}|${a.model}`;
    const kb = `${b.source}|${b.model}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** Cache-efficiency summary: cache-read vs fresh-input volume + pico-USD saved by caching
 * (what cache-read tokens would have cost at the input rate, minus what they did cost). */
export interface CacheEfficiency {
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly freshInputTokens: number;
  readonly savedPico: bigint;
}

export function cacheEfficiency(
  records: readonly UsageRecord[],
  card: RateCard,
): CacheEfficiency {
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let freshInputTokens = 0;
  let savedPico = 0n;
  for (const r of records) {
    const b = selectBand(card, r.model, r.date);
    cacheReadTokens += r.cacheReadTokens;
    cacheCreationTokens += r.cacheCreationTokens;
    freshInputTokens += r.inputTokens;
    // What the cache-read tokens would have cost at the input rate, minus what they did cost.
    savedPico += BigInt(r.cacheReadTokens) * (BigInt(b.input) - BigInt(b.cacheRead));
  }
  return { cacheReadTokens, cacheCreationTokens, freshInputTokens, savedPico };
}

/** One cell of the dense project × time grid: a (project, bucket) rollup. */
export interface ProjectPeriodCell {
  readonly projectKey: string;
  readonly bucketId: string;
  readonly costPico: bigint;
  readonly totalTokens: number;
}

/**
 * Build the DENSE project × time grid for the given rows over an inclusive window: every
 * `rows × bucketsInWindow` cell is materialized (zeros included), summing the in-window records whose
 * project is one of `rows` into their `(project, bucket)` cell. Records outside the window or for a
 * project not in `rows` are ignored. Returns cells in row-major order (rows as given, buckets
 * chronological) — point-in-time cost via the injected card. The caller chooses `rows` (and their
 * order): the project grid passes repo+unattributed keys; the Tools strip passes the tool keys.
 */
export function aggregateByProjectPeriod(
  records: readonly UsageRecord[],
  card: RateCard,
  bucket: BucketKind,
  window: DateWindow,
  rows: readonly string[],
): ProjectPeriodCell[] {
  const buckets = bucketsInWindow(window.from, window.to, bucket);
  // Nested project -> bucket -> mutable cell, pre-seeded with every cartesian cell so zeros
  // materialize. Nesting avoids any string-key separator (project keys are paths that may contain
  // spaces), so two distinct (project, bucket) pairs can never collide.
  const grid = new Map<string, Map<string, { costPico: bigint; totalTokens: number }>>();
  for (const project of rows) {
    const row = new Map<string, { costPico: bigint; totalTokens: number }>();
    for (const bucketId of buckets) row.set(bucketId, { costPico: 0n, totalTokens: 0 });
    grid.set(project, row);
  }
  for (const r of records) {
    if (!inWindow(r.date, window)) continue;
    const acc = grid.get(r.project)?.get(bucketOf(r.date, bucket));
    if (!acc) continue; // project not in `rows`, or (impossible) a bucket outside the window
    acc.costPico += normalizeCost(r, card);
    acc.totalTokens += tokenTotal(r);
  }
  const out: ProjectPeriodCell[] = [];
  for (const projectKey of rows) {
    const row = grid.get(projectKey)!;
    for (const bucketId of buckets) {
      const acc = row.get(bucketId)!;
      out.push({ projectKey, bucketId, costPico: acc.costPico, totalTokens: acc.totalTokens });
    }
  }
  return out;
}

/** One leaderboard row: a project's grid total + its token share (basis points) of the grid. */
export interface ProjectTotal {
  readonly projectKey: string;
  readonly costPico: bigint;
  readonly totalTokens: number;
  /** projectTokens / Σ grid tokens, in basis points (× 10000), integer-floored. 0 when the grid is empty. */
  readonly tokenShareBp: number;
}

/**
 * Roll records up by project over the GRID (kind `repo` + `unattributed`; tool rows are excluded so a
 * "project share" never silently means "tool share"). Share = projectTokens / Σ grid tokens. Ordered
 * repos by total tokens (effort) descending, ties by key, with `Unattributed` pinned last.
 */
export function aggregateByProject(records: readonly UsageRecord[], card: RateCard): ProjectTotal[] {
  type Mutable = { projectKey: string; costPico: bigint; totalTokens: number };
  const by = new Map<string, Mutable>();
  let gridTokens = 0;
  for (const r of records) {
    if (metaForKey(r.project).kind === 'tool') continue; // grid = repo + unattributed only
    let acc = by.get(r.project);
    if (!acc) {
      acc = { projectKey: r.project, costPico: 0n, totalTokens: 0 };
      by.set(r.project, acc);
    }
    acc.costPico += normalizeCost(r, card);
    const t = tokenTotal(r);
    acc.totalTokens += t;
    gridTokens += t;
  }
  const rows = [...by.values()].map((m) => ({
    projectKey: m.projectKey,
    costPico: m.costPico,
    totalTokens: m.totalTokens,
    tokenShareBp: gridTokens > 0 ? Number((BigInt(m.totalTokens) * 10000n) / BigInt(gridTokens)) : 0,
  }));
  return rows.sort((a, b) => {
    const au = a.projectKey === UNATTRIBUTED;
    const bu = b.projectKey === UNATTRIBUTED;
    if (au !== bu) return au ? 1 : -1; // Unattributed last
    if (a.totalTokens !== b.totalTokens) return b.totalTokens - a.totalTokens; // effort desc
    return a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0;
  });
}
