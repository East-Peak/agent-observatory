import type { BillableUsage, Source, TokenUsage } from '../../../pricing/src/index.js';

export type { BillableUsage, Source, TokenUsage };

/**
 * Domain types for the attribution classifier. These are the STABLE shapes the classifier reasons over —
 * a `ClaudeTranscriptAdapter` (later) is responsible for turning raw transcript JSONL into `AgentTurn`s, so
 * nothing here is coupled to any one agent's schema.
 */

/** A stable, adapter-emitted view of one transcript turn. */
export interface AgentTurn {
  readonly sessionId: string;
  readonly index: number;
  /** Agent/tool source for this turn. */
  readonly source: Source;
  /** UTC billing date, YYYY-MM-DD, derived from the transcript timestamp. */
  readonly date: string;
  /** Model id emitted by the source transcript. */
  readonly model: string;
  /** Working directory recorded for this turn (tracks `cd`); `null` if the transcript omits it. */
  readonly cwd: string | null;
  /** Token usage for a billable turn; `null` for non-billable lines. */
  readonly usage: TokenUsage | null;
  /** File operations performed in this turn, in order. */
  readonly files: readonly FileEvidence[];
  /** Shell commands invoked in this turn, in order. */
  readonly commands: readonly string[];
}

export interface FileEvidence {
  readonly path: string;
  readonly kind: FileKind;
}
export type FileKind = 'mutate' | 'read';

/** The cost-accounting taxonomy — where a turn's compute is allocated. */
export interface Target {
  readonly kind: TargetKind;
  /** Stable key: the git-root path for `repo`, the project name for `direct`, else a bucket name. */
  readonly key: string;
}
export type TargetKind = 'repo' | 'direct' | 'meta' | 'scratch' | 'overhead' | 'unattributed';

/** The local project-map: known roots + workspace. The ONLY place full paths live (kept off the durable rows). */
export interface ProjectMap {
  /** Absolute git-toplevel project roots (e.g. `~/projects/*`). */
  readonly projectRoots: readonly string[];
  /** The workspace root; its `projects/<name>` entries are DIRECT project cost, the rest is meta. */
  readonly workspaceRoot: string;
}

/** The classifier's verdict for a single turn. */
export interface TurnAllocation {
  readonly target: Target;
  readonly evidence: EvidenceCode;
  readonly confidence: Confidence;
  /** Relative share when one turn carries multiple same-tier evidence signals. */
  readonly weight: number;
}
export type EvidenceCode = 'file-mutate' | 'bash-target' | 'file-read' | 'cwd' | 'none';
export type Confidence = 'strong' | 'contextual' | 'none';

/** Prices one turn's token usage in integer pico-USD. Injected so the money engine stays a dependency. */
export type Pricer = (usage: BillableUsage) => bigint;

/** One target's slice of a session: its normalized cost + a token volume for context. */
export interface TargetAllocation {
  readonly target: Target;
  readonly costPico: bigint;
  readonly tokens: TokenUsage;
  readonly evidence: readonly EvidenceCode[];
}

/** The durable ledger row for one session: cost allocated across targets, reconciling to the total. */
export interface SessionLedgerRow {
  readonly sessionId: string;
  /** Billable turns allocated. */
  readonly turns: number;
  readonly totalCostPico: bigint;
  readonly totalTokens: TokenUsage;
  /** Per-target slices, cost-descending; `Σ costPico === totalCostPico` exactly. */
  readonly allocations: readonly TargetAllocation[];
}
