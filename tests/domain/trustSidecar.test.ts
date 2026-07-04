import { describe, expect, it } from 'vitest'
import {
  buildTrustSidecar,
  selectTrustSidecar,
  summarizeTrustSidecar,
  type TrustLedgerRow,
  type TrustProjectMap,
} from '@/domain/trustSidecar'

const projectMap: TrustProjectMap = {
  targets: [
    { kind: 'repo', projectKey: 'p_alpha' },
    { kind: 'direct', projectKey: 'p_bravo' },
    { kind: 'meta', projectKey: 'workspace_meta' },
    { kind: 'overhead', projectKey: 'overhead_other' },
  ],
}

const row = (
  projectKey: string,
  costPico: string,
  targetKind: TrustLedgerRow['allocations'][number]['target_kind'] = 'repo',
): TrustLedgerRow => ({
  allocations: [
    {
      project_key: projectKey,
      target_kind: targetKind,
      cost_pico: costPico,
    },
  ],
})

describe('buildTrustSidecar', () => {
  it('summarizes per-project target kind, evidence share, ledger freshness, and exceptions', () => {
    const { sidecar, summary } = buildTrustSidecar({
      generatedAt: '2026-07-04T12:40:00.000Z',
      rows: [
        row('p_alpha', '700'),
        row('p_bravo', '50', 'direct'),
        row('workspace_meta', '150', 'meta'),
        row('overhead_other', '100', 'overhead'),
      ],
      projectMap,
      exceptionsCurrent: 7,
      lastBackfillAt: '2026-07-04T12:35:27Z',
    })

    expect(sidecar).toEqual({
      generatedAt: '2026-07-04T12:40:00.000Z',
      perProject: {
        p_alpha: { targetKind: 'repo', evidenceShare: 0.7 },
        p_bravo: { targetKind: 'direct', evidenceShare: 0.05 },
        workspace_meta: { targetKind: 'meta', evidenceShare: 0.15 },
        overhead_other: { targetKind: 'overhead', evidenceShare: 0.1 },
      },
      ledger: {
        lastBackfillAt: '2026-07-04T12:35:27Z',
        exceptionsCurrent: 7,
      },
    })
    expect(summary).toEqual({
      directCostPico: '750',
      overheadCostPico: '250',
      totalCostPico: '1000',
      directShare: 0.75,
      overheadShare: 0.25,
      exceptionsCurrent: 7,
    })
  })

  it('fails closed when a durable allocation is absent from the project map', () => {
    expect(() =>
      buildTrustSidecar({
        generatedAt: '2026-07-04T12:40:00.000Z',
        rows: [row('p_missing', '1')],
        projectMap,
        exceptionsCurrent: 0,
        lastBackfillAt: null,
      }),
    ).toThrow(/missing project-map target/)
  })
})

describe('selectTrustSidecar', () => {
  it('accepts the sidecar shape and rejects malformed optional artifacts fail-open', () => {
    const { sidecar } = buildTrustSidecar({
      generatedAt: '2026-07-04T12:40:00.000Z',
      rows: [row('p_alpha', '1')],
      projectMap,
      exceptionsCurrent: 0,
      lastBackfillAt: null,
    })

    expect(selectTrustSidecar(sidecar)).toEqual(sidecar)
    expect(selectTrustSidecar(undefined)).toBeUndefined()
    expect(
      selectTrustSidecar({
        ...sidecar,
        perProject: { p_alpha: { targetKind: 'repo', evidenceShare: 1.5 } },
      }),
    ).toBeUndefined()
  })

  it('derives a direct-vs-overhead split from the optional sidecar only', () => {
    const { sidecar } = buildTrustSidecar({
      generatedAt: '2026-07-04T12:40:00.000Z',
      rows: [row('p_alpha', '2'), row('workspace_meta', '1', 'meta')],
      projectMap,
      exceptionsCurrent: 0,
      lastBackfillAt: null,
    })

    expect(summarizeTrustSidecar(sidecar)).toMatchObject({
      directShare: 0.666666,
      overheadShare: 0.333333,
    })
    expect(summarizeTrustSidecar(undefined)).toBeUndefined()
  })
})
