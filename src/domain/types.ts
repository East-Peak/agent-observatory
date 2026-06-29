/** The three usage sources the Observatory unifies. */
export type Source = 'claude' | 'codex' | 'openclaw';

/** What a project key denotes: a real git repo, the catch-all bucket, or a whole tool. */
export type ProjectKind = 'repo' | 'unattributed' | 'tool';

/** The {@link Snapshot} registry value for a project key — its display label + kind. Keys are
 * git-toplevel paths (repos) or reserved sentinels (`__unattributed__`/`__codex__`/`__openclaw__`). */
export interface ProjectMeta {
  readonly kind: ProjectKind;
  readonly label: string;
}

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
  /** Project key — a git-toplevel path (repo) or a reserved sentinel; resolves in `Snapshot.projects`.
   * Never empty; unresolved Claude work is the `__unattributed__` sentinel. */
  readonly project: string;
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
  /** Registry mapping every `record.project` key → its kind + display label. */
  readonly projects: Readonly<Record<string, ProjectMeta>>;
}
