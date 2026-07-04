import { createHash } from 'node:crypto';
import type { RateCard } from '../../../pricing/src/index.js';
import type {
  EvidenceCode,
  ProjectMap,
  SessionLedgerRow,
  Source,
  Target,
  TargetKind,
  TokenUsage,
} from './types.js';

export const DURABLE_ROW_SCHEMA_VERSION = 'agent-ledger-row/v1';
export const ADAPTER_VERSION = 'claude-v1';
export const CLASSIFIER_VERSION = 'classifier-v1';
export const ALLOCATOR_VERSION = 'allocator-v1';
export const PRICER_VERSION = 'pricing-v1';

export interface LedgerProjectMap {
  readonly version: string;
  readonly workspaceRoot: string;
  readonly targets: readonly LedgerProjectTarget[];
}

export interface LedgerProjectTarget {
  readonly kind: TargetKind;
  /** Local private target key: repo root, direct project name, or bucket key. Never persisted to rows. */
  readonly key: string;
  readonly projectKey: string;
}

export interface DurableVersions {
  readonly adapter: string;
  readonly classifier: string;
  readonly allocator: string;
  readonly pricer: string;
  readonly rate_card: string;
}

export interface DurableAllocation {
  readonly project_key: string;
  readonly target_kind: TargetKind;
  readonly cost_pico: string;
  readonly tokens: TokenUsage;
  readonly evidence: readonly EvidenceCode[];
}

export interface DurableLedgerRow {
  readonly schema_version: typeof DURABLE_ROW_SCHEMA_VERSION;
  readonly row_key: string;
  readonly source: Source;
  readonly session_key: string;
  readonly date: string;
  readonly model: string;
  readonly transcript_hash: string;
  readonly transcript_key: string;
  readonly versions: DurableVersions;
  readonly turns: number;
  readonly total_cost_pico: string;
  readonly total_tokens: TokenUsage;
  readonly allocations: readonly DurableAllocation[];
}

export interface EncodeDurableRowOptions {
  readonly source: Source;
  readonly date: string;
  readonly model: string;
  readonly transcriptHash: string;
  readonly transcriptKey: string;
  readonly projectMap: LedgerProjectMap;
  readonly versions: DurableVersions;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function prefixedSha256(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

export function versionsForRateCard(card: RateCard): DurableVersions {
  return {
    adapter: ADAPTER_VERSION,
    classifier: CLASSIFIER_VERSION,
    allocator: ALLOCATOR_VERSION,
    pricer: PRICER_VERSION,
    rate_card: card.version,
  };
}

export function ledgerProjectMapToClassifierMap(map: LedgerProjectMap): ProjectMap {
  return {
    workspaceRoot: map.workspaceRoot,
    projectRoots: map.targets.filter((target) => target.kind === 'repo').map((target) => target.key),
  };
}

export function encodeDurableRow(row: SessionLedgerRow, options: EncodeDurableRowOptions): DurableLedgerRow {
  if (!row.sessionId) throw new Error('cannot encode durable row without session id');

  const sessionKey = sha256Hex(`${options.source}:${row.sessionId}`);
  const rowKey = `${options.source}:${sessionKey}:${options.date}:${options.model}`;
  const allocations = row.allocations.map((allocation) => ({
    project_key: projectKeyForTarget(allocation.target, options.projectMap),
    target_kind: allocation.target.kind,
    cost_pico: allocation.costPico.toString(),
    tokens: allocation.tokens,
    evidence: allocation.evidence,
  }));

  return {
    schema_version: DURABLE_ROW_SCHEMA_VERSION,
    row_key: rowKey,
    source: options.source,
    session_key: sessionKey,
    date: options.date,
    model: options.model,
    transcript_hash: options.transcriptHash,
    transcript_key: options.transcriptKey,
    versions: options.versions,
    turns: row.turns,
    total_cost_pico: row.totalCostPico.toString(),
    total_tokens: row.totalTokens,
    allocations,
  };
}

function projectKeyForTarget(target: Target, map: LedgerProjectMap): string {
  const hit = map.targets.find((entry) => entry.kind === target.kind && entry.key === target.key);
  if (!hit) throw new Error(`missing project-map target for ${target.kind}`);
  return hit.projectKey;
}
