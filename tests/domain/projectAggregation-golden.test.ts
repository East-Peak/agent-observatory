import { describe, it, expect } from 'vitest';
import { aggregateByProjectPeriod, aggregateByProject } from '@/domain/aggregate';
import type { RateCard } from '@/domain/normalizeCost';
import type { BucketKind } from '@/domain/buckets';
import type { UsageRecord } from '@/domain/types';
import periodGolden from '../../data/fixtures/project-period-golden.json';
import byProjectGolden from '../../data/fixtures/byproject-golden.json';

describe('project aggregation goldens (frozen, hand-derived anchors)', () => {
  it('aggregateByProjectPeriod reproduces the frozen dense-grid golden', () => {
    const got = aggregateByProjectPeriod(
      periodGolden.records as unknown as UsageRecord[],
      periodGolden.card as unknown as RateCard,
      periodGolden.bucket as BucketKind,
      periodGolden.window,
      periodGolden.rows,
    );
    expect(got).toEqual(
      periodGolden.expectedCells.map((c) => ({
        projectKey: c.projectKey,
        bucketId: c.bucketId,
        costPico: BigInt(c.costPico),
        totalTokens: c.totalTokens,
      })),
    );
  });

  it('aggregateByProject reproduces the frozen leaderboard golden (grid share, tools excluded)', () => {
    const got = aggregateByProject(
      byProjectGolden.records as unknown as UsageRecord[],
      byProjectGolden.card as unknown as RateCard,
    );
    expect(got).toEqual(
      byProjectGolden.expectedRows.map((r) => ({
        projectKey: r.projectKey,
        costPico: BigInt(r.costPico),
        totalTokens: r.totalTokens,
        tokenShareBp: r.tokenShareBp,
      })),
    );
  });
});
