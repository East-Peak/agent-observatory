import { describe, expect, it } from 'vitest'

import { buildValidated, claudeRowsFromLedger } from '../../scripts/ingest.mjs'

const record = (overrides = {}) => ({
  source: 'codex',
  date: '2026-07-03',
  project: '__codex__',
  model: 'gpt-5.5',
  inputTokens: 1,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  ...overrides,
})

describe('ledger ingest boundary', () => {
  it('fails closed when the durable ledger contains non-Claude rows in v1 mode', () => {
    expect(() =>
      claudeRowsFromLedger([
        { row_key: 'claude-row', source: 'claude' },
        { row_key: 'codex-row', source: 'codex' },
      ]),
    ).toThrow(/codex/)
  })

  it('allows empty Claude ledger rows when tool-sentinel daily rows still produce a snapshot', () => {
    const snapshot = buildValidated({
      groups: [
        { name: 'claude', records: [] },
        { name: 'codex', records: [record()] },
      ],
      projects: {},
    })
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.asOf).toBe('2026-07-03')
  })
})
