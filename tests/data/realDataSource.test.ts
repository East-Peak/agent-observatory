import { describe, it, expect } from 'vitest';
import { selectDataSource } from '@/data/realDataSource';
import { fixturesDataSource, baseRateCard } from '@/data/FixturesDataSource';
import type { Snapshot } from '@/domain/types';

const fakeReal: Snapshot = {
  asOf: '2026-06-29',
  records: [
    {
      source: 'claude',
      date: '2026-06-29',
      model: 'claude-opus-4-8',
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    },
  ],
};

describe('selectDataSource', () => {
  it('serves the ingested real snapshot when one is present', () => {
    expect(selectDataSource(fakeReal).getSnapshot()).toBe(fakeReal);
  });

  it('prices the real snapshot with the base rate card', () => {
    expect(selectDataSource(fakeReal).getRateCard()).toEqual(baseRateCard());
  });

  it('falls back to the committed synthetic fixtures when no real snapshot exists', () => {
    expect(selectDataSource(undefined).getSnapshot()).toEqual(fixturesDataSource.getSnapshot());
  });

  it('falls back to fixtures for a malformed artifact rather than shipping bad data', () => {
    for (const bad of [null, {}, { asOf: '2026-06-29' }, { records: [] }, 'nope']) {
      expect(selectDataSource(bad).getSnapshot()).toEqual(fixturesDataSource.getSnapshot());
    }
  });
});
