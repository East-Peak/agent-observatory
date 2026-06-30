import { describe, it, expect } from 'vitest';
import { bucketOf, bucketsInWindow } from '@/domain/buckets';

describe('bucketOf', () => {
  it('day bucket is the ISO date itself', () => {
    expect(bucketOf('2026-05-19', 'day')).toBe('2026-05-19');
  });

  it('month bucket is YYYY-MM', () => {
    expect(bucketOf('2026-05-19', 'month')).toBe('2026-05');
    expect(bucketOf('2026-12-31', 'month')).toBe('2026-12');
  });

  it('week bucket is the ISO-8601 Monday (UTC) of the week', () => {
    expect(bucketOf('2026-05-18', 'week')).toBe('2026-05-18'); // Monday -> itself
    expect(bucketOf('2026-05-19', 'week')).toBe('2026-05-18'); // Tuesday -> that Monday
    expect(bucketOf('2026-05-24', 'week')).toBe('2026-05-18'); // Sunday -> still that Monday
    expect(bucketOf('2026-05-25', 'week')).toBe('2026-05-25'); // next Monday -> itself
    expect(bucketOf('2026-06-01', 'week')).toBe('2026-06-01'); // crosses month boundary cleanly
  });
});

describe('bucketsInWindow', () => {
  it('day: every day in the inclusive window, chronological', () => {
    expect(bucketsInWindow('2026-05-30', '2026-06-02', 'day')).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
    ]);
  });

  it('month: every month the window touches (dense — no gaps)', () => {
    expect(bucketsInWindow('2026-05-19', '2026-07-03', 'month')).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('week: each ISO Monday the window touches, including a partial first/last week', () => {
    // 2026-05-19 (Tue) .. 2026-06-01 (Mon): weeks of 05-18, 05-25, 06-01.
    expect(bucketsInWindow('2026-05-19', '2026-06-01', 'week')).toEqual(['2026-05-18', '2026-05-25', '2026-06-01']);
  });

  it('a single-day window yields exactly one bucket', () => {
    expect(bucketsInWindow('2026-06-29', '2026-06-29', 'week')).toEqual(['2026-06-29']);
  });
});
