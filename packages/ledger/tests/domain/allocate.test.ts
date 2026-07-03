import { describe, it, expect } from 'vitest';
import { allocateSession } from '../../src/domain/allocate.js';
import type { AgentTurn, BillableUsage, Pricer, ProjectMap, TokenUsage } from '../../src/domain/types.js';

const map: ProjectMap = { projectRoots: ['/p/a', '/p/b'], workspaceRoot: '/ws' };
const price: Pricer = (u) => BigInt(u.usage.output) * 1000n; // 1000 pico-USD per output token (test rate)
const usage = (output: number, overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0,
  output,
  cacheRead: 0,
  cacheCreation: 0,
  reasoning: 0,
  ...overrides,
});
const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  sessionId: 'S',
  index: 0,
  source: 'claude',
  date: '2026-07-03',
  model: 'claude-opus-4-8',
  cwd: null,
  usage: usage(0),
  files: [],
  ...over,
});

describe('allocateSession', () => {
  it('aggregates priced turns by their classified target', () => {
    const row = allocateSession(
      [
        turn({ cwd: '/p/a', usage: usage(10) }), // cwd → repo a
        turn({ files: [{ path: '/p/a/x.ts', kind: 'mutate' }], usage: usage(5) }), // edit → repo a
        turn({ cwd: '/p/b', usage: usage(3) }), // cwd → repo b
      ],
      map,
      price,
    );
    expect(row.sessionId).toBe('S');
    expect(row.turns).toBe(3);
    expect(row.totalCostPico).toBe(18_000n); // (10+5+3)*1000
    expect(row.allocations.find((x) => x.target.key === '/p/a')?.costPico).toBe(15_000n);
    expect(row.allocations.find((x) => x.target.key === '/p/b')?.costPico).toBe(3_000n);
  });

  it('passes narrow billable usage metadata to the pricer', () => {
    const priced: BillableUsage[] = [];
    const row = allocateSession(
      [
        turn({
          source: 'claude',
          date: '2026-07-03',
          model: 'claude-opus-4-8',
          cwd: '/p/a',
          usage: usage(9),
        }),
      ],
      map,
      (u) => {
        priced.push(u);
        return 123n;
      },
    );

    expect(row.totalCostPico).toBe(123n);
    expect(priced).toEqual([
      {
        source: 'claude',
        date: '2026-07-03',
        model: 'claude-opus-4-8',
        usage: { input: 0, output: 9, cacheRead: 0, cacheCreation: 0, reasoning: 0 },
      },
    ]);
  });

  it('aggregates all token classes by target for transcript/ccusage reconciliation', () => {
    const row = allocateSession(
      [
        turn({ cwd: '/p/a', usage: usage(5, { input: 2, cacheRead: 3, cacheCreation: 4, reasoning: 7 }) }),
        turn({
          cwd: '/p/a',
          usage: usage(11, { input: 13, cacheRead: 17, cacheCreation: 19, reasoning: 23 }),
        }),
      ],
      map,
      price,
    );

    expect(row.allocations[0]?.tokens).toEqual({
      input: 15,
      output: 16,
      cacheRead: 20,
      cacheCreation: 23,
      reasoning: 30,
    });
  });

  it('reconciles EXACTLY — Σ allocations.costPico === totalCostPico (BigInt, no rounding loss)', () => {
    const turns = [7, 13, 2, 29].map((o, i) =>
      turn({ index: i, cwd: i % 2 ? '/p/a' : '/p/b', usage: usage(o) }),
    );
    const row = allocateSession(turns, map, price);
    const sum = row.allocations.reduce((s, x) => s + x.costPico, 0n);
    expect(sum).toBe(row.totalCostPico);
  });

  it('orders allocations by cost, descending', () => {
    const row = allocateSession(
      [turn({ cwd: '/p/b', usage: usage(2) }), turn({ cwd: '/p/a', usage: usage(50) })],
      map,
      price,
    );
    expect(row.allocations.map((x) => x.target.key)).toEqual(['/p/a', '/p/b']);
  });

  it('skips non-billable turns (null usage)', () => {
    const row = allocateSession([turn({ usage: null }), turn({ cwd: '/p/a', usage: usage(4) })], map, price);
    expect(row.turns).toBe(1);
    expect(row.totalCostPico).toBe(4_000n);
  });
});
