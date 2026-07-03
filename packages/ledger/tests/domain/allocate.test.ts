import { describe, it, expect } from 'vitest';
import { allocateSession } from '../../src/domain/allocate.js';
import type { AgentTurn, Pricer, ProjectMap, TokenUsage } from '../../src/domain/types.js';

const map: ProjectMap = { projectRoots: ['/p/a', '/p/b'], workspaceRoot: '/ws' };
const price: Pricer = (u) => BigInt(u.output) * 1000n; // 1000 pico-USD per output token (test rate)
const usage = (output: number): TokenUsage => ({ input: 0, output, cacheRead: 0, cacheCreation: 0 });
const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  sessionId: 'S',
  index: 0,
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
