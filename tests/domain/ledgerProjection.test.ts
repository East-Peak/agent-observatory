import { describe, expect, it } from 'vitest'
import {
  projectLedgerRows,
  projectLedgerRowsToSnapshot,
  LedgerProjectionError,
} from '@/domain/ledgerProjection'
import { normalizeCost, type RateCard } from '@/domain/normalizeCost'
import { UNATTRIBUTED } from '@/domain/projects'
import type {
  DurableLedgerRow,
  LedgerProjectMap,
} from '../../packages/ledger/src/domain/durable'

const tokens = (input: number) => ({
  input,
  output: 2,
  cacheRead: 3,
  cacheCreation: 4,
  reasoning: 0,
})

const projectMap: LedgerProjectMap = {
  version: 'map-v1',
  workspaceRoot: '/Users/example/.openclaw/workspace',
  targets: [
    {
      kind: 'repo',
      key: '/Users/example/projects/alpha',
      projectKey: 'p_alpha',
    },
    { kind: 'direct', key: 'agent-observatory', projectKey: 'p_observatory' },
    { kind: 'meta', key: 'workspace', projectKey: 'workspace_meta' },
    { kind: 'scratch', key: 'scratch', projectKey: 'scratch' },
    { kind: 'overhead', key: 'other', projectKey: 'overhead_other' },
    { kind: 'unattributed', key: 'unattributed', projectKey: 'unattributed' },
  ],
}

const row = (overrides: Partial<DurableLedgerRow> = {}): DurableLedgerRow => ({
  schema_version: 'agent-ledger-row/v1',
  row_key: 'claude:session-a:2026-07-03:claude-opus-4-8',
  source: 'claude',
  session_key: 'session-a',
  date: '2026-07-03',
  model: 'claude-opus-4-8',
  transcript_hash: 'sha256:content-a',
  transcript_key: 'sha256:path-a',
  versions: {
    adapter: 'claude-v1',
    classifier: 'classifier-v1',
    allocator: 'allocator-v1',
    pricer: 'pricing-v1',
    rate_card: 'rate-card-v1',
  },
  turns: 2,
  total_cost_pico: '100',
  total_tokens: {
    input: 10,
    output: 4,
    cacheRead: 6,
    cacheCreation: 8,
    reasoning: 0,
  },
  allocations: [
    {
      project_key: 'p_alpha',
      target_kind: 'repo',
      cost_pico: '70',
      tokens: tokens(7),
      evidence: ['file-mutate'],
    },
    {
      project_key: 'unattributed',
      target_kind: 'unattributed',
      cost_pico: '30',
      tokens: tokens(3),
      evidence: ['none'],
    },
  ],
  ...overrides,
})

const card: RateCard = {
  version: 'test',
  asOf: '2026-07-04',
  unit: 'picoUsdPerToken',
  rates: {
    'claude-opus-4-8': [
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        input: '999999999',
        output: '999999999',
        cacheCreation: '999999999',
        cacheRead: '999999999',
        reasoning: '999999999',
      },
    ],
  },
}

describe('projectLedgerRowsToSnapshot', () => {
  it('projects durable allocations to the dashboard Snapshot contract with exact allocated cost', () => {
    const snap = projectLedgerRowsToSnapshot(
      [
        row(),
        row({
          row_key: 'claude:session-b:2026-07-03:claude-opus-4-8',
          session_key: 'session-b',
          transcript_hash: 'sha256:content-b',
          transcript_key: 'sha256:path-b',
          total_cost_pico: '5',
          total_tokens: tokens(1),
          allocations: [
            {
              project_key: 'p_alpha',
              target_kind: 'repo',
              cost_pico: '5',
              tokens: tokens(1),
              evidence: ['cwd'],
            },
          ],
        }),
        row({
          row_key: 'claude:session-c:2026-07-04:claude-opus-4-8',
          session_key: 'session-c',
          date: '2026-07-04',
          total_cost_pico: '11',
          total_tokens: tokens(11),
          allocations: [
            {
              project_key: 'p_observatory',
              target_kind: 'direct',
              cost_pico: '11',
              tokens: tokens(11),
              evidence: ['file-mutate'],
            },
          ],
        }),
      ],
      projectMap,
    )

    expect(snap.asOf).toBe('2026-07-04')
    expect(snap.projects).toMatchObject({
      p_alpha: { kind: 'repo', label: 'alpha' },
      p_observatory: { kind: 'repo', label: 'agent-observatory' },
      [UNATTRIBUTED]: { kind: 'unattributed', label: 'Unattributed' },
    })
    expect(snap.records).toEqual([
      expect.objectContaining({
        date: '2026-07-03',
        project: UNATTRIBUTED,
        costPico: '30',
      }),
      expect.objectContaining({
        date: '2026-07-03',
        project: 'p_alpha',
        inputTokens: 8,
        costPico: '75',
      }),
      expect.objectContaining({
        date: '2026-07-04',
        project: 'p_observatory',
        inputTokens: 11,
        costPico: '11',
      }),
    ])
    expect(
      normalizeCost(
        snap.records.find((r) => r.project === 'p_alpha')!,
        card,
      ),
    ).toBe(75n)

    const json = JSON.stringify(snap)
    expect(json).not.toContain('/Users/example')
    expect(json).not.toContain('session-a')
    expect(json).not.toContain('transcript')
    expect(json).not.toContain('sha256:')
  })

  it('fails closed when a durable allocation references no project-map target', () => {
    expect(() =>
      projectLedgerRowsToSnapshot(
        [
          row({
            allocations: [
              {
                project_key: 'missing',
                target_kind: 'repo',
                cost_pico: '1',
                tokens: tokens(1),
                evidence: ['cwd'],
              },
            ],
          }),
        ],
        projectMap,
      ),
    ).toThrow(LedgerProjectionError)
  })

  it('fails closed when allocation cost does not reconcile to the durable row total', () => {
    expect(() =>
      projectLedgerRowsToSnapshot(
        [row({ total_cost_pico: '999' })],
        projectMap,
      ),
    ).toThrow(/reconcile/)
  })

  it('fails closed when allocation tokens do not reconcile to the durable row total', () => {
    expect(() =>
      projectLedgerRowsToSnapshot(
        [
          row({
            total_tokens: tokens(999),
          }),
        ],
        projectMap,
      ),
    ).toThrow(/tokens do not reconcile/)
  })

  it('returns an empty projection without forcing a snapshot asOf', () => {
    expect(projectLedgerRows([], projectMap)).toEqual({
      records: [],
      projects: {},
    })
  })

  it('fails closed when a durable row total cost is malformed', () => {
    expect(() =>
      projectLedgerRowsToSnapshot(
        [row({ total_cost_pico: '12.50' })],
        projectMap,
      ),
    ).toThrow(LedgerProjectionError)
  })
})
