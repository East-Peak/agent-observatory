import {
  normalizeCost as normalizeBillableCost,
  RateCardError,
  selectBand,
  type RateBand,
  type RateCard,
} from '../../packages/pricing/src/index.ts'
import type { UsageRecord } from './types'
import { parseCostPico } from './costPico.ts'

export { RateCardError, selectBand }
export type { RateBand, RateCard }

/** Cost of one dashboard usage record in pico-USD (BigInt), via the shared pricing engine. */
export function normalizeCost(record: UsageRecord, card: RateCard): bigint {
  if (record.costPico !== undefined) {
    try {
      return parseCostPico(record.costPico, 'UsageRecord.costPico')
    } catch (error) {
      throw new RateCardError(
        error instanceof Error ? error.message : 'invalid UsageRecord.costPico',
      )
    }
  }
  return normalizeBillableCost(
    {
      source: record.source,
      date: record.date,
      model: record.model,
      usage: {
        input: record.inputTokens,
        output: record.outputTokens,
        cacheCreation: record.cacheCreationTokens,
        cacheRead: record.cacheReadTokens,
        reasoning: record.reasoningTokens,
      },
    },
    card,
  )
}
