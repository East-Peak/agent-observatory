import type { AgentTurn, ProjectMap, TurnAllocation } from './types.js';
import { resolveTarget } from './target.js';

/**
 * Classify one turn to an allocation target by the deterministic evidence hierarchy:
 *   file mutation (strong) → file read (contextual) → per-turn cwd (contextual) → none (unattributed).
 * A mutation overrides the cwd, which is what makes "cd-ed in repo A but editing repo B" attribute to B.
 * The per-turn cwd — present on ~100% of transcript turns — is the dense fallback that keeps reasoning /
 * bare-command turns from collapsing into an unattributed bucket.
 *
 * NOT yet modelled (later tranches, per the design decision): explicit Bash command targets, causal
 * tool-result linkage, and multi-target splitting when one turn touches several repos.
 */
export function classifyTurn(turn: AgentTurn, map: ProjectMap): TurnAllocation {
  const mutate = turn.files.find((f) => f.kind === 'mutate');
  if (mutate) {
    return { target: resolveTarget(mutate.path, map), evidence: 'file-mutate', confidence: 'strong' };
  }

  const read = turn.files.find((f) => f.kind === 'read');
  if (read) {
    return { target: resolveTarget(read.path, map), evidence: 'file-read', confidence: 'contextual' };
  }

  if (turn.cwd) {
    return { target: resolveTarget(turn.cwd, map), evidence: 'cwd', confidence: 'contextual' };
  }

  return { target: { kind: 'unattributed', key: 'unattributed' }, evidence: 'none', confidence: 'none' };
}
