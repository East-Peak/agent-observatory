import { describe, it, expect } from 'vitest';
import { scopeRecords } from '@/domain/scopeRecords';
import type { UsageRecord } from '@/domain/types';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'claude',
  date: '2026-05-19',
  project: '__unattributed__',
  model: 'm',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('scopeRecords', () => {
  it('filters by source (all → keep everything; a source → only that source)', () => {
    const records = [rec({ source: 'claude', date: '2026-06-20' }), rec({ source: 'codex', date: '2026-06-20' })];
    expect(scopeRecords(records, '2026-06-27', 'all', 'all').records).toHaveLength(2);
    expect(scopeRecords(records, '2026-06-27', 'all', 'claude').records.map((r) => r.source)).toEqual(['claude']);
  });

  it('resolves the window from the SOURCE-scoped earliest date, not the global earliest', () => {
    // Codex has an older record; scoping to Claude must use CLAUDE's earliest for the window.
    const records = [rec({ source: 'codex', date: '2026-01-01' }), rec({ source: 'claude', date: '2026-06-20' })];
    expect(scopeRecords(records, '2026-06-27', 'all', 'claude').window.from).toBe('2026-06-20');
    expect(scopeRecords(records, '2026-06-27', 'all', 'all').window.from).toBe('2026-01-01');
  });

  it('keeps only in-window records and exposes the full source-scoped set separately', () => {
    const records = [rec({ date: '2026-06-25' }), rec({ date: '2026-05-01' })];
    const w = scopeRecords(records, '2026-06-27', 'last7', 'all'); // last 7 days: 2026-06-21..27
    expect(w.records.map((r) => r.date)).toEqual(['2026-06-25']); // 05-01 is out of window
    expect(w.scoped).toHaveLength(2); // scoped keeps both dates for a prior-window reuse
  });

  it('falls back to asOf when the scope is empty (no records for that source)', () => {
    const w = scopeRecords([rec({ source: 'codex' })], '2026-06-27', 'all', 'claude');
    expect(w.records).toHaveLength(0);
    expect(w.window.to).toBe('2026-06-27');
  });
});
