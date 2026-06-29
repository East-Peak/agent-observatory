import { describe, it, expect } from 'vitest';
import { selectDataSource } from '@/data/realDataSource';
import { fixturesDataSource, baseRateCard } from '@/data/FixturesDataSource';
import { UNATTRIBUTED, RESERVED_PROJECTS } from '@/domain/projects';
import type { Snapshot } from '@/domain/types';

const fakeReal: Snapshot = {
  asOf: '2026-06-29',
  records: [
    {
      source: 'claude',
      date: '2026-06-29',
      project: UNATTRIBUTED,
      model: 'claude-opus-4-8',
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    },
  ],
  projects: { [UNATTRIBUTED]: RESERVED_PROJECTS[UNATTRIBUTED]! },
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

  it('falls back to fixtures for a STALE v1-schema snapshot (no projects registry / records lacking project)', () => {
    const recNoProject = {
      source: 'claude',
      date: '2026-06-29',
      model: 'claude-opus-4-8',
      inputTokens: 1,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    };
    // v1 shape: asOf + records but NO projects registry.
    expect(selectDataSource({ asOf: '2026-06-29', records: [recNoProject] }).getSnapshot()).toEqual(
      fixturesDataSource.getSnapshot(),
    );
    // has a projects registry but a record lacks the `project` key — still rejected (would render undefined).
    expect(
      selectDataSource({ asOf: '2026-06-29', records: [recNoProject], projects: {} }).getSnapshot(),
    ).toEqual(fixturesDataSource.getSnapshot());
    // a record whose project is NOT registered (empty registry) is rejected too — it would render undefined.
    expect(
      selectDataSource({
        asOf: '2026-06-29',
        records: [{ ...recNoProject, project: '/repo/ghost' }],
        projects: {},
      }).getSnapshot(),
    ).toEqual(fixturesDataSource.getSnapshot());
  });
});
