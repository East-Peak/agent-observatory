export type TrustTargetKind =
  'repo' | 'direct' | 'meta' | 'scratch' | 'overhead' | 'unattributed'

export interface TrustSidecarProject {
  readonly targetKind: TrustTargetKind
  /** Share of total durable-ledger allocated cost represented by this project key. */
  readonly evidenceShare: number
}

export interface TrustSidecar {
  readonly generatedAt: string
  readonly perProject: Readonly<Record<string, TrustSidecarProject>>
  readonly ledger: {
    readonly lastBackfillAt: string | null
    readonly exceptionsCurrent: number
  }
}

export interface TrustProjectMap {
  readonly targets: readonly {
    readonly kind: TrustTargetKind
    readonly projectKey: string
  }[]
}

export interface TrustLedgerRow {
  readonly allocations: readonly {
    readonly project_key: string
    readonly target_kind: TrustTargetKind
    readonly cost_pico: string
  }[]
}

export interface BuildTrustSidecarInput {
  readonly generatedAt: string
  readonly rows: readonly TrustLedgerRow[]
  readonly projectMap: TrustProjectMap
  readonly exceptionsCurrent: number
  readonly lastBackfillAt: string | null
}

export interface TrustSidecarSummary {
  readonly directCostPico: string
  readonly overheadCostPico: string
  readonly totalCostPico: string
  readonly directShare: number
  readonly overheadShare: number
  readonly exceptionsCurrent: number
}

const SHARE_SCALE = 1_000_000n
const TARGET_KINDS = new Set<TrustTargetKind>([
  'repo',
  'direct',
  'meta',
  'scratch',
  'overhead',
  'unattributed',
])

export function buildTrustSidecar(input: BuildTrustSidecarInput): {
  readonly sidecar: TrustSidecar
  readonly summary: TrustSidecarSummary
} {
  const targetKindByProject = firstTargetKindByProject(input.projectMap)
  const costByProject = new Map<string, bigint>()
  let totalCost = 0n

  for (const row of input.rows) {
    for (const allocation of row.allocations) {
      const targetKind = targetKindByProject.get(allocation.project_key)
      if (!targetKind) {
        throw new Error(
          `missing project-map target for durable project key ${allocation.project_key}`,
        )
      }
      const cost = parseCostPico(allocation.cost_pico)
      totalCost += cost
      costByProject.set(
        allocation.project_key,
        (costByProject.get(allocation.project_key) ?? 0n) + cost,
      )
    }
  }

  const perProject: Record<string, TrustSidecarProject> = {}
  for (const [projectKey, cost] of [...costByProject.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    perProject[projectKey] = {
      targetKind: targetKindByProject.get(projectKey)!,
      evidenceShare: share(cost, totalCost),
    }
  }

  const sidecar: TrustSidecar = {
    generatedAt: input.generatedAt,
    perProject,
    ledger: {
      lastBackfillAt: input.lastBackfillAt,
      exceptionsCurrent: input.exceptionsCurrent,
    },
  }

  return {
    sidecar,
    summary: summarizeTrustCosts(
      costByProject,
      targetKindByProject,
      totalCost,
      input.exceptionsCurrent,
    ),
  }
}

export function selectTrustSidecar(value: unknown): TrustSidecar | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.generatedAt !== 'string') return undefined
  if (!isRecord(value.ledger)) return undefined
  if (
    value.ledger.lastBackfillAt !== null &&
    typeof value.ledger.lastBackfillAt !== 'string'
  ) {
    return undefined
  }
  if (
    typeof value.ledger.exceptionsCurrent !== 'number' ||
    !Number.isInteger(value.ledger.exceptionsCurrent) ||
    value.ledger.exceptionsCurrent < 0
  ) {
    return undefined
  }
  if (!isRecord(value.perProject)) return undefined

  const perProject: Record<string, TrustSidecarProject> = {}
  for (const [projectKey, project] of Object.entries(value.perProject)) {
    if (!isRecord(project)) return undefined
    if (!isTrustTargetKind(project.targetKind)) return undefined
    if (
      typeof project.evidenceShare !== 'number' ||
      !Number.isFinite(project.evidenceShare) ||
      project.evidenceShare < 0 ||
      project.evidenceShare > 1
    ) {
      return undefined
    }
    perProject[projectKey] = {
      targetKind: project.targetKind,
      evidenceShare: project.evidenceShare,
    }
  }

  return {
    generatedAt: value.generatedAt,
    perProject,
    ledger: {
      lastBackfillAt: value.ledger.lastBackfillAt,
      exceptionsCurrent: value.ledger.exceptionsCurrent,
    },
  }
}

export function summarizeTrustSidecar(
  sidecar: TrustSidecar | undefined,
): TrustSidecarSummary | undefined {
  if (!sidecar) return undefined
  return summarizeConcreteTrustSidecar(sidecar, SHARE_SCALE)
}

export function isDirectTrustKind(kind: TrustTargetKind): boolean {
  return kind === 'repo' || kind === 'direct'
}

function summarizeConcreteTrustSidecar(
  sidecar: TrustSidecar,
  totalCost: bigint,
): TrustSidecarSummary {
  let directScaled = 0n
  let overheadScaled = 0n

  for (const project of Object.values(sidecar.perProject)) {
    const scaled = BigInt(
      Math.round(project.evidenceShare * Number(SHARE_SCALE)),
    )
    if (isDirectTrustKind(project.targetKind)) directScaled += scaled
    else overheadScaled += scaled
  }

  return {
    directCostPico: directScaledCost(directScaled, totalCost).toString(),
    overheadCostPico: directScaledCost(overheadScaled, totalCost).toString(),
    totalCostPico: totalCost.toString(),
    directShare: share(directScaled, SHARE_SCALE),
    overheadShare: share(overheadScaled, SHARE_SCALE),
    exceptionsCurrent: sidecar.ledger.exceptionsCurrent,
  }
}

function summarizeTrustCosts(
  costByProject: Map<string, bigint>,
  targetKindByProject: Map<string, TrustTargetKind>,
  totalCost: bigint,
  exceptionsCurrent: number,
): TrustSidecarSummary {
  let directCost = 0n
  let overheadCost = 0n
  for (const [projectKey, cost] of costByProject) {
    const kind = targetKindByProject.get(projectKey)
    if (kind && isDirectTrustKind(kind)) directCost += cost
    else overheadCost += cost
  }

  return {
    directCostPico: directCost.toString(),
    overheadCostPico: overheadCost.toString(),
    totalCostPico: totalCost.toString(),
    directShare: share(directCost, totalCost),
    overheadShare: share(overheadCost, totalCost),
    exceptionsCurrent,
  }
}

function firstTargetKindByProject(
  projectMap: TrustProjectMap,
): Map<string, TrustTargetKind> {
  const out = new Map<string, TrustTargetKind>()
  for (const target of projectMap.targets) {
    if (!out.has(target.projectKey)) out.set(target.projectKey, target.kind)
  }
  return out
}

function parseCostPico(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`invalid cost_pico: ${value}`)
  return BigInt(value)
}

function share(part: bigint, total: bigint): number {
  if (total === 0n) return 0
  return Number((part * SHARE_SCALE) / total) / Number(SHARE_SCALE)
}

function directScaledCost(scaledShare: bigint, totalCost: bigint): bigint {
  if (totalCost === SHARE_SCALE) return scaledShare
  return (totalCost * scaledShare) / SHARE_SCALE
}

function isTrustTargetKind(value: unknown): value is TrustTargetKind {
  return typeof value === 'string' && TARGET_KINDS.has(value as TrustTargetKind)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
