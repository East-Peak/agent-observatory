import type {
  AgentTurn,
  EvidenceCode,
  Pricer,
  ProjectMap,
  SessionLedgerRow,
  Target,
  TargetAllocation,
  TokenUsage,
  TurnAllocation,
} from './types.js';
import { classifyTurnAllocations } from './classify.js';

const zeroTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoning: 0 });
const EVIDENCE_ORDER: readonly EvidenceCode[] = ['file-mutate', 'bash-target', 'file-read', 'cwd', 'none'];

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    reasoning: a.reasoning + b.reasoning,
  };
}

function splitBigInt(total: bigint, weights: readonly number[]): bigint[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) throw new Error('cannot split with zero total weight');

  const parts = weights.map((weight, index) => {
    const numerator = total * BigInt(weight);
    return {
      index,
      value: numerator / BigInt(weightTotal),
      remainder: numerator % BigInt(weightTotal),
    };
  });

  let leftover = total - parts.reduce((sum, part) => sum + part.value, 0n);
  const byRemainder = [...parts].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder < b.remainder ? 1 : -1;
  });

  for (const part of byRemainder) {
    if (leftover <= 0n) break;
    part.value += 1n;
    leftover -= 1n;
  }

  return parts.map((part) => part.value);
}

function splitNumber(total: number, weights: readonly number[]): number[] {
  return splitBigInt(BigInt(total), weights).map((value) => Number(value));
}

function splitTokens(total: TokenUsage, weights: readonly number[]): TokenUsage[] {
  const input = splitNumber(total.input, weights);
  const output = splitNumber(total.output, weights);
  const cacheRead = splitNumber(total.cacheRead, weights);
  const cacheCreation = splitNumber(total.cacheCreation, weights);
  const reasoning = splitNumber(total.reasoning, weights);

  return weights.map((_, index) => ({
    input: input[index] ?? 0,
    output: output[index] ?? 0,
    cacheRead: cacheRead[index] ?? 0,
    cacheCreation: cacheCreation[index] ?? 0,
    reasoning: reasoning[index] ?? 0,
  }));
}

function targetKey(target: Target): string {
  return `${target.kind}:${target.key}`;
}

function orderedEvidence(evidence: ReadonlySet<EvidenceCode>): EvidenceCode[] {
  return EVIDENCE_ORDER.filter((code) => evidence.has(code));
}

function aggregateTurnAllocations(
  allocations: readonly TurnAllocation[],
): { target: Target; weight: number; evidence: Set<EvidenceCode> }[] {
  const byKey = new Map<string, { target: Target; weight: number; evidence: Set<EvidenceCode> }>();
  for (const allocation of allocations) {
    const key = targetKey(allocation.target);
    const current = byKey.get(key);
    if (current) {
      current.weight += allocation.weight;
      current.evidence.add(allocation.evidence);
    } else {
      byKey.set(key, {
        target: allocation.target,
        weight: allocation.weight,
        evidence: new Set([allocation.evidence]),
      });
    }
  }
  return [...byKey.values()];
}

/**
 * Aggregate a session's turns into one ledger row: classify each billable turn to its target, price it in
 * pico-USD via the injected `price`, split mixed-evidence turns by largest remainder, and sum by target.
 * Reconciliation is exact by construction: every pico-USD and every token class is assigned once.
 */
export function allocateSession(
  turns: readonly AgentTurn[],
  map: ProjectMap,
  price: Pricer,
): SessionLedgerRow {
  const byKey = new Map<
    string,
    { target: Target; costPico: bigint; tokens: TokenUsage; evidence: Set<EvidenceCode> }
  >();
  let totalCostPico = 0n;
  let totalTokens = zeroTokens();
  let billable = 0;
  let sessionId = '';

  for (const turn of turns) {
    if (!sessionId && turn.sessionId) sessionId = turn.sessionId;
    const { usage } = turn;
    if (!usage) continue;
    billable++;

    const turnAllocations = aggregateTurnAllocations(classifyTurnAllocations(turn, map));
    const costPico = price({ source: turn.source, date: turn.date, model: turn.model, usage });
    totalCostPico += costPico;
    totalTokens = addTokens(totalTokens, usage);

    const weights = turnAllocations.map((allocation) => allocation.weight);
    const costParts = splitBigInt(costPico, weights);
    const tokenParts = splitTokens(usage, weights);

    for (let i = 0; i < turnAllocations.length; i++) {
      const allocation = turnAllocations[i];
      const allocationCost = costParts[i];
      const allocationTokens = tokenParts[i];
      if (!allocation || allocationCost === undefined || !allocationTokens) continue;

      const key = targetKey(allocation.target);
      const current = byKey.get(key);
      if (current) {
        current.costPico += allocationCost;
        current.tokens = addTokens(current.tokens, allocationTokens);
        for (const evidence of allocation.evidence) current.evidence.add(evidence);
      } else {
        byKey.set(key, {
          target: allocation.target,
          costPico: allocationCost,
          tokens: allocationTokens,
          evidence: new Set(allocation.evidence),
        });
      }
    }
  }

  const allocations: TargetAllocation[] = [...byKey.values()]
    .map(({ target, costPico, tokens, evidence }) => ({
      target,
      costPico,
      tokens,
      evidence: orderedEvidence(evidence),
    }))
    .sort((a, b) => {
      if (a.costPico !== b.costPico) return a.costPico < b.costPico ? 1 : -1;
      return targetKey(a.target).localeCompare(targetKey(b.target));
    });

  return { sessionId, turns: billable, totalCostPico, totalTokens, allocations };
}
