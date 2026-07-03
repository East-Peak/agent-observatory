import type {
  AgentTurn,
  Pricer,
  ProjectMap,
  SessionLedgerRow,
  Target,
  TargetAllocation,
  TokenUsage,
} from './types.js';
import { classifyTurn } from './classify.js';

const zeroTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoning: 0 });

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    reasoning: a.reasoning + b.reasoning,
  };
}

/**
 * Aggregate a session's turns into one ledger row: classify each billable turn to its target, price it in
 * pico-USD via the injected `price`, and sum cost by target. Reconciliation is exact by construction —
 * every turn's whole cost lands on its single target, and we sum BigInts (no fractions, no rounding). When
 * a later tranche splits one turn across several targets, THAT is where largest-remainder rounding enters;
 * v1 is single-target-per-turn, so `Σ allocations.costPico === totalCostPico` holds trivially.
 */
export function allocateSession(
  turns: readonly AgentTurn[],
  map: ProjectMap,
  price: Pricer,
): SessionLedgerRow {
  const byKey = new Map<string, { target: Target; costPico: bigint; tokens: TokenUsage }>();
  let totalCostPico = 0n;
  let totalTokens = zeroTokens();
  let billable = 0;
  let sessionId = '';

  for (const turn of turns) {
    if (!sessionId && turn.sessionId) sessionId = turn.sessionId;
    const { usage } = turn;
    if (!usage) continue;
    billable++;

    const { target } = classifyTurn(turn, map);
    const costPico = price({ source: turn.source, date: turn.date, model: turn.model, usage });
    totalCostPico += costPico;
    totalTokens = addTokens(totalTokens, usage);

    const key = `${target.kind}:${target.key}`;
    const current = byKey.get(key);
    if (current) {
      current.costPico += costPico;
      current.tokens = addTokens(current.tokens, usage);
    } else {
      byKey.set(key, { target, costPico, tokens: usage });
    }
  }

  const allocations: TargetAllocation[] = [...byKey.values()]
    .map(({ target, costPico, tokens }) => ({ target, costPico, tokens }))
    .sort((a, b) => (a.costPico < b.costPico ? 1 : a.costPico > b.costPico ? -1 : 0));

  return { sessionId, turns: billable, totalCostPico, totalTokens, allocations };
}
