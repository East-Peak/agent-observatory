import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '@/App'
import { baseRateCard } from '@/data/FixturesDataSource'
import type { DataSource } from '@/data/DataSource'
import type { Snapshot } from '@/domain/types'
import type { TrustSidecar } from '@/domain/trustSidecar'
import { ByProjectPanel } from '@/panels/by-project/ByProjectPanel'

const snapshot: Snapshot = {
  asOf: '2026-07-04',
  projects: { p_alpha: { kind: 'repo', label: 'alpha' } },
  records: [
    {
      source: 'claude',
      date: '2026-07-04',
      project: 'p_alpha',
      model: 'claude-opus-4-8',
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      costPico: '123',
    },
  ],
}

const dataSource: DataSource = {
  getSnapshot: () => snapshot,
  getRateCard: () => baseRateCard(),
}

const trustSidecar: TrustSidecar = {
  generatedAt: '2026-07-04T12:40:00.000Z',
  perProject: {
    p_alpha: { targetKind: 'repo', evidenceShare: 1 },
  },
  ledger: {
    lastBackfillAt: '2026-07-04T12:35:27Z',
    exceptionsCurrent: 3,
  },
}

describe('ByProjectPanel trust sidecar', () => {
  it('renders optional trust metadata without changing the row carrier contract', () => {
    render(
      <AppProviders dataSource={dataSource} trustSidecar={trustSidecar}>
        <MemoryRouter>
          <ByProjectPanel />
        </MemoryRouter>
      </AppProviders>,
    )

    const trust = screen.getByLabelText('Ledger trust')
    expect(within(trust).getByText(/Ledger trust/i)).toBeInTheDocument()
    expect(within(trust).getByText(/100\.0% direct/i)).toBeInTheDocument()
    expect(within(trust).getByText(/3 current exceptions/i)).toBeInTheDocument()

    const row = screen.getByTestId('breakdown-row')
    expect(row).toHaveAttribute('data-row-key', 'p_alpha')
    expect(row).toHaveAttribute('data-row-value', '123')
    expect(row).toHaveAttribute('data-row-share', '10000')
  })
})
