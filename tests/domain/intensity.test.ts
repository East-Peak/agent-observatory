import { describe, it, expect } from 'vitest';
import { quantileScale } from '@/domain/intensity';

describe('quantileScale (per-section intensity bins)', () => {
  it('zero is its own bin (0); nonzero values get quantile bins 1..bins; ties share the lower bin', () => {
    const s = quantileScale([0n, 10n, 20n, 20n, 30n, 100n], 4);
    expect(s.binCount).toBe(4);
    expect(s.binOf(0n)).toBe(0);
    expect(s.binOf(10n)).toBe(1); // smallest nonzero
    expect(s.binOf(20n)).toBe(1); // tie -> same bin as the other 20
    expect(s.binOf(30n)).toBe(3);
    expect(s.binOf(100n)).toBe(4); // max -> top bin
  });

  it('an all-zero section puts everything in bin 0', () => {
    const s = quantileScale([0n, 0n, 0n], 4);
    expect(s.binOf(0n)).toBe(0);
  });

  it('equal nonzero values all share bin 1', () => {
    const s = quantileScale([5n, 5n, 5n], 4);
    expect(s.binOf(5n)).toBe(1);
  });

  it('bins a value by its rank even if it is not one of the source values', () => {
    const s = quantileScale([10n, 20n, 30n, 40n], 4);
    expect(s.binOf(25n)).toBe(3); // lessCount=2 -> 1 + floor(4*2/4) = 3
  });

  it('honours a custom bin count', () => {
    const s = quantileScale([1n, 2n, 3n, 4n, 5n], 5);
    expect(s.binCount).toBe(5);
    expect(s.binOf(1n)).toBe(1);
    expect(s.binOf(5n)).toBe(5);
  });
});
