import { assembleSnapshot } from './buildSnapshot.ts'
import { parseCostPico } from './costPico.ts'
import { UNATTRIBUTED, RESERVED_PROJECTS } from './projects.ts'
import type { ProjectMeta, Snapshot, UsageRecord } from './types'
import type {
  DurableAllocation,
  DurableLedgerRow,
  LedgerProjectMap,
  LedgerProjectTarget,
} from '../../packages/ledger/src/domain/durable'

export class LedgerProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LedgerProjectionError'
  }
}

interface ProjectionTarget {
  readonly dashboardKey: string
  readonly meta: ProjectMeta
}

type MutableUsageRecord = Omit<UsageRecord, 'costPico'> & { costPico: string }

interface LedgerProjection {
  readonly records: readonly UsageRecord[]
  readonly projects: Readonly<Record<string, ProjectMeta>>
}

export function projectLedgerRows(
  rows: readonly DurableLedgerRow[],
  projectMap: LedgerProjectMap,
): LedgerProjection {
  const targets = projectionTargets(projectMap)
  const byIdentity = new Map<string, MutableUsageRecord>()

  for (const row of rows) {
    assertRowCostReconciles(row)
    assertRowTokensReconcile(row)
    for (const allocation of row.allocations) {
      const target = targets.get(allocation.project_key)
      if (!target) {
        throw new LedgerProjectionError(
          `missing project-map target for durable project key ${allocation.project_key}`,
        )
      }
      const identity = `${row.source}\u0000${row.date}\u0000${target.dashboardKey}\u0000${row.model}`
      const costPico = parseAllocationCost(allocation, row.row_key)
      const existing = byIdentity.get(identity)
      if (existing) {
        byIdentity.set(identity, {
          ...existing,
          inputTokens: existing.inputTokens + allocation.tokens.input,
          outputTokens: existing.outputTokens + allocation.tokens.output,
          cacheCreationTokens:
            existing.cacheCreationTokens + allocation.tokens.cacheCreation,
          cacheReadTokens:
            existing.cacheReadTokens + allocation.tokens.cacheRead,
          reasoningTokens:
            existing.reasoningTokens + allocation.tokens.reasoning,
          costPico: (
            parseCostPico(existing.costPico, 'projected UsageRecord.costPico') +
            costPico
          ).toString(),
        })
      } else {
        byIdentity.set(identity, {
          source: row.source,
          date: row.date,
          project: target.dashboardKey,
          model: row.model,
          inputTokens: allocation.tokens.input,
          outputTokens: allocation.tokens.output,
          cacheCreationTokens: allocation.tokens.cacheCreation,
          cacheReadTokens: allocation.tokens.cacheRead,
          reasoningTokens: allocation.tokens.reasoning,
          costPico: costPico.toString(),
        })
      }
    }
  }

  const records = [...byIdentity.values()]
  const usedProjects = new Set(records.map((record) => record.project))
  const projects: Record<string, ProjectMeta> = {}
  for (const target of targets.values()) {
    if (
      usedProjects.has(target.dashboardKey) &&
      !(target.dashboardKey in projects)
    ) {
      projects[target.dashboardKey] = target.meta
    }
  }
  return { records, projects }
}

export function projectLedgerRowsToSnapshot(
  rows: readonly DurableLedgerRow[],
  projectMap: LedgerProjectMap,
): Snapshot {
  const projection = projectLedgerRows(rows, projectMap)
  return assembleSnapshot([projection.records], {
    projects: projection.projects,
  })
}

function projectionTargets(
  projectMap: LedgerProjectMap,
): Map<string, ProjectionTarget> {
  const out = new Map<string, ProjectionTarget>()
  for (const target of projectMap.targets) {
    if (!out.has(target.projectKey))
      out.set(target.projectKey, projectionTarget(target))
  }
  return out
}

function projectionTarget(target: LedgerProjectTarget): ProjectionTarget {
  if (target.kind === 'unattributed') {
    return {
      dashboardKey: UNATTRIBUTED,
      meta: RESERVED_PROJECTS[UNATTRIBUTED]!,
    }
  }
  return {
    dashboardKey: target.projectKey,
    meta: { kind: 'repo', label: labelForTarget(target) },
  }
}

function labelForTarget(target: LedgerProjectTarget): string {
  switch (target.kind) {
    case 'repo':
      return basename(target.key) || target.projectKey
    case 'direct':
      return target.key
    case 'meta':
      return target.key === 'workspace'
        ? 'Workspace Meta'
        : titleize(target.key)
    case 'scratch':
      return 'Scratch'
    case 'overhead':
      return 'Overhead'
    case 'unattributed':
      return 'Unattributed'
  }
}

function assertRowCostReconciles(row: DurableLedgerRow): void {
  let total: bigint
  try {
    total = parseCostPico(row.total_cost_pico, `${row.row_key}.total_cost_pico`)
  } catch (error) {
    throw new LedgerProjectionError(
      error instanceof Error ? error.message : 'invalid durable row total cost',
    )
  }
  const allocations = row.allocations.reduce(
    (sum, allocation) => sum + parseAllocationCost(allocation, row.row_key),
    0n,
  )
  if (total !== allocations) {
    throw new LedgerProjectionError(
      `${row.row_key} allocations do not reconcile to total_cost_pico`,
    )
  }
}

function assertRowTokensReconcile(row: DurableLedgerRow): void {
  const allocations = row.allocations.reduce(
    (sum, allocation) => ({
      input: sum.input + allocation.tokens.input,
      output: sum.output + allocation.tokens.output,
      cacheCreation: sum.cacheCreation + allocation.tokens.cacheCreation,
      cacheRead: sum.cacheRead + allocation.tokens.cacheRead,
      reasoning: sum.reasoning + allocation.tokens.reasoning,
    }),
    {
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
      reasoning: 0,
    },
  )
  const total = row.total_tokens
  for (const field of [
    'input',
    'output',
    'cacheCreation',
    'cacheRead',
    'reasoning',
  ] as const) {
    if (allocations[field] !== total[field]) {
      throw new LedgerProjectionError(
        `${row.row_key} allocation tokens do not reconcile to total_tokens.${field}`,
      )
    }
  }
}

function parseAllocationCost(
  allocation: DurableAllocation,
  rowKey: string,
): bigint {
  try {
    return parseCostPico(
      allocation.cost_pico,
      `${rowKey}.allocations[].cost_pico`,
    )
  } catch (error) {
    throw new LedgerProjectionError(
      error instanceof Error ? error.message : 'invalid allocation cost',
    )
  }
}

function basename(path: string): string {
  const stripped = path.replace(/\/+$/, '')
  const slash = stripped.lastIndexOf('/')
  return slash >= 0 ? stripped.slice(slash + 1) : stripped
}

function titleize(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}
