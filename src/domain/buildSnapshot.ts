import type { ProjectMeta, Snapshot, Source, UsageRecord } from './types';
// Explicit .ts extension so this VALUE import resolves under Node-native type-stripping (the ingest
// imports buildSnapshot.ts directly via Node, which requires the extension on a runtime relative import).
import { deriveRegistry, RESERVED_PROJECTS } from './projects.ts';

/** Raised when records can't be assembled into a well-formed snapshot. */
export class SnapshotBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotBuildError';
  }
}

/**
 * The marker the openclaw decoder emits for a day that spans multiple models — ccusage's
 * openclaw daily output carries no per-model token split, so such days can't be attributed.
 */
export const OPENCLAW_ALL_MARKER = '(all)';

/**
 * The model openclaw `(all)` multi-model days are remapped to. It is a DISTINCT, honestly-labeled
 * model (not a real Claude model) so a mixed day reads as "openclaw-mixed" in the panels rather
 * than silently masquerading as one specific model. Its rate band is priced at the openclaw
 * representative (Claude-Sonnet-equivalent) rate — a marginal/representative figure consistent
 * with the "subscription marginal cost ≠ billed" disclaimer. The label must exist in the rate
 * card (it does), so these days stay priceable.
 */
export const OPENCLAW_DEFAULT_MODEL = 'openclaw-mixed';

/**
 * Remap openclaw `(all)` multi-model-day records onto the openclaw default model so they're
 * priceable. Touches openclaw `(all)` only; every other record (including real openclaw models
 * and any other source) passes through unchanged.
 */
export function remapOpenclawAll(
  records: readonly UsageRecord[],
  defaultModel: string = OPENCLAW_DEFAULT_MODEL,
): UsageRecord[] {
  return records.map((r) =>
    r.source === 'openclaw' && r.model === OPENCLAW_ALL_MARKER ? { ...r, model: defaultModel } : r,
  );
}

/** Stable source ordering for the deterministic record sort. */
const SOURCE_ORDER: Record<Source, number> = { claude: 0, codex: 1, openclaw: 2 };

/** Deterministic order: date, source, project, then model — byte-stable for a given input set
 * (project enters the key so multiple per-project records sharing date/source/model stay stable). */
function compareRecords(a: UsageRecord, b: UsageRecord): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.source !== b.source) return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
  if (a.project !== b.project) return a.project < b.project ? -1 : 1;
  if (a.model !== b.model) return a.model < b.model ? -1 : 1;
  return 0;
}

/**
 * Assemble decoded record groups into a canonical {@link Snapshot}: flatten, sort
 * deterministically, and anchor `asOf` to the latest record date (relative ranges anchor here,
 * never wall-clock). An explicit `asOf` overrides; an empty input requires one (no silent
 * wall-clock fallback).
 */
export function assembleSnapshot(
  groups: readonly (readonly UsageRecord[])[],
  opts: { readonly asOf?: string; readonly projects?: Readonly<Record<string, ProjectMeta>> } = {},
): Snapshot {
  const records = groups.flat().slice().sort(compareRecords);
  if (records.length === 0 && opts.asOf === undefined) {
    throw new SnapshotBuildError('cannot assemble an empty snapshot without an explicit asOf');
  }
  const asOf = opts.asOf ?? records[records.length - 1]!.date;
  // When given, `opts.projects` is the COMPLETE registry (it replaces, not merges) — the ingest builds
  // it up front via `deriveRegistry(records, aliasOverrides)` and passes the whole thing. Absent it, we
  // derive a basename/sentinel registry from the record keys.
  const projects = opts.projects ?? deriveRegistry(records);
  return { asOf, records, projects };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheCreationTokens',
  'cacheReadTokens',
  'reasoningTokens',
] as const;

/**
 * Validate a snapshot is well-formed and fully priceable. `isPriceable(model, date)` is the
 * point-in-time predicate the renderer actually relies on — it must answer whether a rate *band*
 * covers that record's date, not merely whether the model key exists (a record dated before a
 * model's first band would pass a key check yet still throw in `selectBand` at render time).
 * Returns a list of human-readable problems — empty means valid. The caller decides how to react
 * (ingest fails loud), so fail-closed pricing never meets a surprise on screen.
 */
export function validateSnapshot(
  snap: Snapshot,
  isPriceable: (model: string, date: string) => boolean,
): string[] {
  const problems: string[] = [];
  if (!ISO_DATE.test(snap.asOf)) problems.push(`asOf "${snap.asOf}" is not a YYYY-MM-DD date`);
  if (snap.records.length === 0) problems.push('snapshot has zero records');

  const unpriceable = new Set<string>();
  snap.records.forEach((r, i) => {
    const where = `records[${i}] (${r.source}/${r.date}/${r.model})`;
    if (!ISO_DATE.test(r.date)) problems.push(`${where}: date is not YYYY-MM-DD`);
    else if (r.date > snap.asOf) problems.push(`${where}: date is after asOf ${snap.asOf}`);
    for (const f of TOKEN_FIELDS) {
      const v = r[f];
      if (!Number.isInteger(v) || v < 0) {
        problems.push(`${where}: ${f} must be a non-negative integer (got ${JSON.stringify(v)})`);
      }
    }
    if (!isPriceable(r.model, r.date)) unpriceable.add(`${r.model}@${r.date}`);
  });
  if (unpriceable.size > 0) {
    problems.push(`unpriceable model(s) — no rate band covers: ${[...unpriceable].sort().join(', ')}`);
  }

  // Canonical records are unique by full identity (date, source, project, model). The renderer's
  // per-record carriers (e.g. the activity feed's `<source>|<date>|<model>|<project>` key) and the
  // oracle's counted-multiset comparison both assume this — a duplicate would let two cells share a
  // carrier key, where a wrong value on the second could hide. Fail closed at the data boundary.
  const seenIdentity = new Set<string>();
  const dupIdentity = new Set<string>();
  for (const r of snap.records) {
    const id = `${r.date}|${r.source}|${r.project}|${r.model}`;
    if (seenIdentity.has(id)) dupIdentity.add(id);
    else seenIdentity.add(id);
  }
  if (dupIdentity.size > 0) {
    problems.push(`duplicate record identity (date|source|project|model): ${[...dupIdentity].sort().join(', ')}`);
  }

  // Registry consistency: every record's project key must resolve, and reserved sentinels must keep
  // their fixed kind (so a panel can trust `projects[key].kind` to place repo/tool/unattributed rows).
  const missing = new Set<string>();
  for (const r of snap.records) if (!(r.project in snap.projects)) missing.add(r.project);
  if (missing.size > 0) {
    problems.push(`record project key(s) absent from the registry: ${[...missing].sort().join(', ')}`);
  }
  for (const [key, meta] of Object.entries(RESERVED_PROJECTS)) {
    const got = snap.projects[key];
    if (got && got.kind !== meta.kind) {
      problems.push(`reserved sentinel ${key} registered with kind "${got.kind}" (must be "${meta.kind}")`);
    }
  }
  return problems;
}

/** ccusage's per-source `totals` envelope field — token counts only (its float cost is ignored). */
export interface CcusageTotals {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly cacheReadTokens?: number;
  /** Codex-only; maps onto our canonical `reasoningTokens`. */
  readonly reasoningOutputTokens?: number;
}

/**
 * Reconcile a source's decoded record sums against ccusage's own reported `totals` for the same
 * envelope. Empirically these match to the token (the decoder sums every model breakdown), so any
 * divergence means envelope drift dropped or added a token class — exactly the silent-undercount
 * the per-field decoder contract can't see. Returns problems; an absent `totals` means there is
 * nothing to reconcile against (skip, not fail).
 */
export function reconcileTotals(
  source: Source,
  records: readonly UsageRecord[],
  totals: CcusageTotals | undefined,
): string[] {
  if (!totals) return [];
  const sum = (pick: (r: UsageRecord) => number) => records.reduce((acc, r) => acc + pick(r), 0);
  const pairs: ReadonlyArray<readonly [string, number, number | undefined]> = [
    ['inputTokens', sum((r) => r.inputTokens), totals.inputTokens],
    ['outputTokens', sum((r) => r.outputTokens), totals.outputTokens],
    ['cacheCreationTokens', sum((r) => r.cacheCreationTokens), totals.cacheCreationTokens],
    ['cacheReadTokens', sum((r) => r.cacheReadTokens), totals.cacheReadTokens],
    ['reasoningTokens', sum((r) => r.reasoningTokens), totals.reasoningOutputTokens],
  ];
  const problems: string[] = [];
  for (const [field, decoded, reported] of pairs) {
    const expected = reported ?? 0;
    if (decoded !== expected) {
      problems.push(`${source}: ${field} decoded ${decoded} ≠ ccusage total ${expected} (envelope drift?)`);
    }
  }
  return problems;
}
