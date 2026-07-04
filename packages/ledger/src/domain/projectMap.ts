import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { LedgerProjectMap, LedgerProjectTarget } from './durable.js';

const DEFAULT_BUCKETS: readonly LedgerProjectTarget[] = [
  { kind: 'meta', key: 'workspace', projectKey: 'workspace_meta' },
  { kind: 'scratch', key: 'scratch', projectKey: 'scratch' },
  { kind: 'overhead', key: 'other', projectKey: 'overhead_other' },
  { kind: 'unattributed', key: 'unattributed', projectKey: 'unattributed' },
];

export interface BuildLedgerProjectMapOptions {
  readonly workspaceRoot: string;
  readonly repoRoots: readonly string[];
  readonly workspaceProjectNames?: readonly string[];
  readonly version?: string;
  readonly existingMap?: LedgerProjectMap;
}

export function buildLedgerProjectMap(options: BuildLedgerProjectMapOptions): LedgerProjectMap {
  const existingByTarget = new Map(
    (options.existingMap?.targets ?? []).map((target) => [
      targetIdentity(target.kind, target.key),
      target.projectKey,
    ]),
  );
  const projectKeyForName = (kind: LedgerProjectTarget['kind'], key: string, name: string): string =>
    existingByTarget.get(targetIdentity(kind, key)) ?? opaqueProjectKeyFromName(name);

  const repoTargets = unique(options.repoRoots)
    .sort()
    .map<LedgerProjectTarget>((root) => ({
      kind: 'repo',
      key: root,
      projectKey: projectKeyForName('repo', root, basename(root)),
    }));
  const directTargets = unique(options.workspaceProjectNames ?? [])
    .sort()
    .map<LedgerProjectTarget>((name) => ({
      kind: 'direct',
      key: name,
      projectKey: projectKeyForName('direct', name, name),
    }));
  const generatedTargets = [...repoTargets, ...directTargets, ...DEFAULT_BUCKETS];
  const generatedIdentities = new Set(
    generatedTargets.map((target) => targetIdentity(target.kind, target.key)),
  );
  const preservedTargets = (options.existingMap?.targets ?? []).filter(
    (target) => !generatedIdentities.has(targetIdentity(target.kind, target.key)),
  );

  return {
    version: options.version ?? 'map-v1',
    workspaceRoot: options.workspaceRoot,
    targets: uniqueTargets([...generatedTargets, ...preservedTargets]),
  };
}

export function opaqueProjectKeyFromName(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `p_${createHash('sha256')
    .update(normalized || 'project')
    .digest('hex')
    .slice(0, 16)}`;
}

export function validateLedgerProjectMap(map: LedgerProjectMap): string[] {
  const errors: string[] = [];
  if (!map.version) errors.push('missing version');
  if (!map.workspaceRoot) errors.push('missing workspaceRoot');

  const seenTargets = new Set<string>();
  for (const target of map.targets) {
    if (!target.kind || !target.key || !target.projectKey) {
      errors.push('target is missing kind, key, or projectKey');
      continue;
    }
    const identity = targetIdentity(target.kind, target.key);
    if (seenTargets.has(identity)) errors.push(`duplicate target: ${identity}`);
    seenTargets.add(identity);
  }

  for (const bucket of DEFAULT_BUCKETS) {
    const identity = targetIdentity(bucket.kind, bucket.key);
    if (!seenTargets.has(identity)) errors.push(`missing required target: ${identity}`);
  }
  return errors;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueTargets(targets: readonly LedgerProjectTarget[]): LedgerProjectTarget[] {
  const byKey = new Map<string, LedgerProjectTarget>();
  for (const target of targets) byKey.set(targetIdentity(target.kind, target.key), target);
  return [...byKey.values()];
}

function targetIdentity(kind: string, key: string): string {
  return `${kind}:${key}`;
}
