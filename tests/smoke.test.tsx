import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '@/App'

describe('App shell', () => {
  it('renders the Agent Observatory heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /agent observatory/i })).toBeInTheDocument()
  })

  it('mounts the live spendOverview panel populated with real synthetic spend', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /spend overview/i })).toBeInTheDocument()
    const costMetric = screen
      .getAllByTestId('panel-metric')
      .find((el) => el.getAttribute('data-metric-key') === 'total-cost')
    expect(costMetric).toBeTruthy()
    expect(BigInt(costMetric!.getAttribute('data-metric-value') ?? '0')).not.toBe(0n)
  })
})
