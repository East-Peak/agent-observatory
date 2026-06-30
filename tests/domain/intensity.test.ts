import { describe, it, expect } from 'vitest';
import { quantileScale } from '@/domain/intensity';

describe('quantileScale (per-section intensity bins)', () => {
  it('zero is its own bin (0); distinct nonzero values spread 1..bins (min→1, max→bins); ties share', () => {
    const s = quantileScale([0n, 10n, 20n, 20n, 30n, 100n], 4); // distinct nonzero: 10,20,30,100
    expect(s.binCount).toBe(4);
    expect(s.binOf(0n)).toBe(0);
    expect(s.binOf(10n)).toBe(1); // smallest nonzero -> bin 1
    expect(s.binOf(20n)).toBe(2); // rank 2 of 4
    expect(s.binOf(30n)).toBe(3); // rank 3 of 4
    expect(s.binOf(100n)).toBe(4); // largest -> top bin
  });

  it('a sparse section still uses the top bin (max -> bins, not a muted middle)', () => {
    const s = quantileScale([1n, 2n], 4); // two distinct values
    expect(s.binOf(1n)).toBe(1);
    expect(s.binOf(2n)).toBe(4);
  });

  it('an all-zero section puts everything in bin 0', () => {
    const s = quantileScale([0n, 0n, 0n], 4);
    expect(s.binOf(0n)).toBe(0);
  });

  it('a single distinct nonzero value (repeated) maps to the top bin', () => {
    const s = quantileScale([5n, 5n, 5n], 4);
    expect(s.binOf(5n)).toBe(4);
  });

  it('bins a value by the largest distinct level <= it, even if not a source value', () => {
    const s = quantileScale([10n, 20n, 30n, 40n], 4); // distinct ranks 1..4 -> bins 1,2,3,4
    expect(s.binOf(25n)).toBe(2); // largest distinct <= 25 is 20 (rank 2)
  });

  it('honours a custom bin count', () => {
    const s = quantileScale([1n, 2n, 3n, 4n, 5n], 5);
    expect(s.binCount).toBe(5);
    expect(s.binOf(1n)).toBe(1);
    expect(s.binOf(5n)).toBe(5);
  });
});
