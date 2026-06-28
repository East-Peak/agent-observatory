import { describe, it, expect } from 'vitest';
import {
  addDays,
  toOrdinal,
  fromOrdinal,
  currentWindow,
  priorWindow,
  inWindow,
  RANGE_OPTIONS,
} from '@/domain/dateRange';

describe('dateRange — pure UTC calendar math (no Date in the app path)', () => {
  it('round-trips ordinal <-> ISO', () => {
    expect(toOrdinal('1970-01-01')).toBe(0);
    for (const iso of ['2026-06-27', '2024-02-29', '2025-12-31', '2000-01-01', '1999-12-31']) {
      expect(fromOrdinal(toOrdinal(iso))).toBe(iso);
    }
  });

  it('adds/subtracts days across month and year boundaries', () => {
    expect(addDays('2026-06-27', -6)).toBe('2026-06-21');
    expect(addDays('2026-06-27', -29)).toBe('2026-05-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28'); // 2026 is not a leap year
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29'); // 2024 is a leap year
    expect(addDays('2026-06-27', 0)).toBe('2026-06-27');
  });

  it('derives the current window for each range, anchored to asOf', () => {
    const asOf = '2026-06-27';
    const earliest = '2026-05-19';
    expect(currentWindow('last7', asOf, earliest)).toEqual({ from: '2026-06-21', to: asOf });
    expect(currentWindow('last30', asOf, earliest)).toEqual({ from: '2026-05-29', to: asOf });
    expect(currentWindow('thisMonth', asOf, earliest)).toEqual({ from: '2026-06-01', to: asOf });
    expect(currentWindow('all', asOf, earliest)).toEqual({ from: earliest, to: asOf });
  });

  it('derives the equal-length prior window immediately preceding current', () => {
    expect(priorWindow({ from: '2026-06-21', to: '2026-06-27' })).toEqual({
      from: '2026-06-14',
      to: '2026-06-20',
    });
    // This Month (Jun 1..27 = 27 days) -> prior 27-day window ending the day before.
    expect(priorWindow({ from: '2026-06-01', to: '2026-06-27' })).toEqual({
      from: '2026-05-05',
      to: '2026-05-31',
    });
  });

  it('tests window membership inclusively on both bounds (string compare)', () => {
    const w = { from: '2026-06-01', to: '2026-06-27' };
    expect(inWindow('2026-06-01', w)).toBe(true);
    expect(inWindow('2026-06-27', w)).toBe(true);
    expect(inWindow('2026-05-31', w)).toBe(false);
    expect(inWindow('2026-06-28', w)).toBe(false);
  });

  it('exposes the four house-style range options in order', () => {
    expect(RANGE_OPTIONS.map((o) => o.label)).toEqual([
      'Last 7 Days',
      'Last 30 Days',
      'This Month',
      'All Time',
    ]);
  });
});
