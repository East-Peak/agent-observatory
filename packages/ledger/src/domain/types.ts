/**
 * Domain types for the attribution classifier. These are the STABLE shapes the classifier reasons over —
 * a `ClaudeTranscriptAdapter` (later) is responsible for turning raw transcript JSONL into `AgentTurn`s, so
 * nothing here is coupled to any one agent's schema.
 */

/** A stable, adapter-emitted view of one transcript turn. */
export interface AgentTurn {
  readonly sessionId: string;
  readonly index: number;
  /** Working directory recorded for this turn (tracks `cd`); `null` if the transcript omits it. */
  readonly cwd: string | null;
  /** Token usage for a billable turn; `null` for non-billable lines. */
  readonly usage: TokenUsage | null;
  /** File operations performed in this turn, in order. */
  readonly files: readonly FileEvidence[];
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
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
}
export type EvidenceCode = 'file-mutate' | 'file-read' | 'cwd' | 'none';
export type Confidence = 'strong' | 'contextual' | 'none';
