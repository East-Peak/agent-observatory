import { describe, it, expect } from 'vitest';
import {
  remapOpenclawAll,
  assembleSnapshot,
  validateSnapshot,
  reconcileTotals,
  SnapshotBuildError,
  OPENCLAW_ALL_MARKER,
  OPENCLAW_DEFAULT_MODEL,
} from '@/domain/buildSnapshot';
import { UNATTRIBUTED, CODEX_PROJECT } from '@/domain/projects';
import type { UsageRecord } from '@/domain/types';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  source: 'claude',
  date: '2026-06-01',
  project: UNATTRIBUTED,
  model: 'claude-opus-4-8',
  inputTokens: 10,
  outputTokens: 20,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe('remapOpenclawAll', () => {
  it('remaps an openclaw "(all)" multi-model day onto the distinct, honestly-labeled mixed model', () => {
    expect(OPENCLAW_DEFAULT_MODEL).toBe('openclaw-mixed');
    const out = remapOpenclawAll([rec({ source: 'openclaw', model: OPENCLAW_ALL_MARKER })]);
    expect(out[0]!.model).toBe(OPENCLAW_DEFAULT_MODEL);
    expect(out[0]!.source).toBe('openclaw');
  });

  it('honours a caller-supplied default model', () => {
    const out = remapOpenclawAll([rec({ source: 'openclaw', model: OPENCLAW_ALL_MARKER })], 'claude-haiku-4-5-20251001');
    expect(out[0]!.model).toBe('claude-haiku-4-5-20251001');
  });

  it('leaves a real openclaw model untouched', () => {
    const out = remapOpenclawAll([rec({ source: 'openclaw', model: 'claude-sonnet-4-6' })]);
    expect(out[0]!.model).toBe('claude-sonnet-4-6');
  });

  it('only touches openclaw — never remaps another source even if it somehow carried the marker', () => {
    const out = remapOpenclawAll([rec({ source: 'claude', model: OPENCLAW_ALL_MARKER })]);
    expect(out[0]!.model).toBe(OPENCLAW_ALL_MARKER);
  });

  it('preserves token fields when remapping', () => {
    const out = remapOpenclawAll([
      rec({ source: 'openclaw', model: OPENCLAW_ALL_MARKER, inputTokens: 7, outputTokens: 9, reasoningTokens: 0 }),
    ]);
    expect(out[0]).toMatchObject({ inputTokens: 7, outputTokens: 9, model: OPENCLAW_DEFAULT_MODEL });
  });
});

describe('assembleSnapshot', () => {
  it('flattens groups and sorts by date, then source, then model (deterministic bytes)', () => {
    const groups = [
      [rec({ source: 'codex', date: '2026-06-02', model: 'gpt-5.5' })],
      [
        rec({ source: 'openclaw', date: '2026-06-01', model: 'claude-sonnet-4-6' }),
        rec({ source: 'claude', date: '2026-06-01', model: 'claude-opus-4-8' }),
        rec({ source: 'claude', date: '2026-06-01', model: 'claude-haiku-4-5-20251001' }),
      ],
    ];
    const snap = assembleSnapshot(groups);
    expect(snap.records.map((r) => `${r.date}|${r.source}|${r.model}`)).toEqual([
      '2026-06-01|claude|claude-haiku-4-5-20251001',
      '2026-06-01|claude|claude-opus-4-8',
      '2026-06-01|openclaw|claude-sonnet-4-6',
      '2026-06-02|codex|gpt-5.5',
    ]);
  });

  it('anchors asOf to the latest record date when none is given', () => {
    const snap = assembleSnapshot([[rec({ date: '2026-06-01' }), rec({ date: '2026-06-10' }), rec({ date: '2026-05-20' })]]);
    expect(snap.asOf).toBe('2026-06-10');
  });

  it('honours an explicit asOf', () => {
    const snap = assembleSnapshot([[rec({ date: '2026-06-01' })]], { asOf: '2026-06-29' });
    expect(snap.asOf).toBe('2026-06-29');
  });

  it('is a pure sort — calling twice yields byte-identical JSON', () => {
    const groups = [[rec({ date: '2026-06-03', model: 'b' }), rec({ date: '2026-06-01', model: 'a' })]];
    expect(JSON.stringify(assembleSnapshot(groups))).toBe(JSON.stringify(assembleSnapshot(groups)));
  });

  it('throws on an empty input with no explicit asOf (no wall-clock fallback)', () => {
    expect(() => assembleSnapshot([])).toThrow(SnapshotBuildError);
  });

  it('allows an empty snapshot when asOf is explicit', () => {
    const snap = assembleSnapshot([], { asOf: '2026-06-29' });
    expect(snap).toEqual({ asOf: '2026-06-29', records: [], projects: {} });
  });

  it('sorts by date, source, project, then model (project enters the canonical order)', () => {
    const snap = assembleSnapshot([
      [
        rec({ date: '2026-06-01', source: 'claude', project: '/r/zeta', model: 'claude-opus-4-8' }),
        rec({ date: '2026-06-01', source: 'claude', project: '/r/alpha', model: 'claude-opus-4-8' }),
      ],
    ]);
    expect(snap.records.map((r) => r.project)).toEqual(['/r/alpha', '/r/zeta']);
  });

  it('derives a projects registry covering every record key', () => {
    const snap = assembleSnapshot([
      [rec({ project: '/r/yard-ops' }), rec({ source: 'codex', project: CODEX_PROJECT })],
    ]);
    expect(snap.projects).toEqual({
      '/r/yard-ops': { kind: 'repo', label: 'yard-ops' },
      [CODEX_PROJECT]: { kind: 'tool', label: 'Codex' },
    });
  });
});

describe('validateSnapshot', () => {
  // Priceability is a (model, date) predicate so validation matches what the renderer's point-in-
  // time `selectBand` actually requires — a model key alone is not enough.
  const known = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5']);
  const priceable = (model: string) => known.has(model);

  it('returns no problems for a clean, fully-priceable snapshot', () => {
    const snap = assembleSnapshot([[rec({ model: 'claude-opus-4-8' }), rec({ source: 'codex', model: 'gpt-5.5' })]]);
    expect(validateSnapshot(snap, priceable)).toEqual([]);
  });

  it('flags a model that is not priceable in the rate card', () => {
    const snap = assembleSnapshot([[rec({ model: 'claude-opus-4-8' }), rec({ source: 'openclaw', model: '(all)' })]]);
    const problems = validateSnapshot(snap, priceable);
    expect(problems.join(' ')).toMatch(/unpriceable/);
    expect(problems.join(' ')).toContain('(all)');
  });

  it('flags a known model whose rate band does not cover the record date (band coverage, not just key)', () => {
    // claude-opus-4-8 is priceable only from 2026-06-01 onward in this predicate.
    const dateAware = (model: string, date: string) => model === 'claude-opus-4-8' && date >= '2026-06-01';
    const snap = {
      asOf: '2026-06-29',
      records: [rec({ model: 'claude-opus-4-8', date: '2026-05-01' })],
      projects: { [UNATTRIBUTED]: { kind: 'unattributed' as const, label: 'Unattributed' } },
    };
    expect(validateSnapshot(snap, dateAware).join(' ')).toMatch(/unpriceable/);
  });

  it('flags a non-negative-integer token field', () => {
    const snap = assembleSnapshot([[rec({ inputTokens: -1 })]]);
    expect(validateSnapshot(snap, priceable).join(' ')).toMatch(/inputTokens/);
  });

  it('flags a record dated after asOf', () => {
    const snap = {
      asOf: '2026-06-01',
      records: [rec({ date: '2026-06-05' })],
      projects: { [UNATTRIBUTED]: { kind: 'unattributed' as const, label: 'Unattributed' } },
    };
    expect(validateSnapshot(snap, priceable).join(' ')).toMatch(/after asOf/);
  });

  it('flags a zero-record snapshot', () => {
    expect(validateSnapshot({ asOf: '2026-06-29', records: [], projects: {} }, priceable).join(' ')).toMatch(/zero records/);
  });

  it('flags a record whose project key is absent from the registry', () => {
    const snap = { asOf: '2026-06-29', records: [rec({ model: 'claude-opus-4-8', project: '/r/missing' })], projects: {} };
    expect(validateSnapshot(snap, priceable).join(' ')).toMatch(/project/i);
  });

  it('flags a reserved sentinel registered with the wrong kind', () => {
    const snap = {
      asOf: '2026-06-29',
      records: [rec({ model: 'claude-opus-4-8', project: UNATTRIBUTED })],
      projects: { [UNATTRIBUTED]: { kind: 'repo' as const, label: 'Unattributed' } },
    };
    expect(validateSnapshot(snap, priceable).join(' ')).toMatch(/sentinel|kind/i);
  });
});

describe('reconcileTotals', () => {
  it('returns no problems when decoded record sums match the ccusage envelope totals exactly', () => {
    const records = [
      rec({ inputTokens: 10, outputTokens: 20, cacheCreationTokens: 1, cacheReadTokens: 2, reasoningTokens: 0 }),
      rec({ inputTokens: 5, outputTokens: 7, cacheCreationTokens: 3, cacheReadTokens: 4, reasoningTokens: 0 }),
    ];
    const totals = { inputTokens: 15, outputTokens: 27, cacheCreationTokens: 4, cacheReadTokens: 6 };
    expect(reconcileTotals('claude', records, totals)).toEqual([]);
  });

  it('flags a token class that does not reconcile (envelope-drift / undercount guard)', () => {
    const records = [rec({ inputTokens: 10, outputTokens: 20 })];
    const totals = { inputTokens: 99, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const problems = reconcileTotals('claude', records, totals);
    expect(problems.join(' ')).toMatch(/input/);
    expect(problems.join(' ')).toContain('claude');
  });

  it('maps codex reasoning tokens to the totals’ reasoningOutputTokens field', () => {
    const records = [rec({ source: 'codex', reasoningTokens: 40 })];
    const totals = {
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 40,
    };
    expect(reconcileTotals('codex', records, totals)).toEqual([]);
  });

  it('skips reconciliation when the envelope carries no totals (nothing to compare against)', () => {
    expect(reconcileTotals('openclaw', [rec({ source: 'openclaw' })], undefined)).toEqual([]);
  });
});
