const COST_PICO_RE = /^(0|[1-9]\d*)$/

export function isCostPicoString(value: unknown): value is string {
  return typeof value === 'string' && COST_PICO_RE.test(value)
}

export function parseCostPico(value: string, where: string): bigint {
  if (!isCostPicoString(value)) {
    throw new Error(`${where} must be a non-negative base-10 integer string`)
  }
  return BigInt(value)
}
