#!/usr/bin/env node
// Build the gitignored trust sidecar from the local durable ledger. This is deliberately outside the
// frozen ingest/projection path: the dashboard can read it when present, and falls back to today's UI
// when absent or malformed.

import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { buildTrustSidecar } from '../src/domain/trustSidecar.ts'

const ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_LEDGER_STORE = join(
  homedir(),
  '.local/share/agent-observatory/ledger',
)
const DEFAULT_PROJECT_MAP = join(
  homedir(),
  '.config/agent-observatory/project-map.json',
)
const DEFAULT_BACKFILL_LOG = join(
  homedir(),
  '.local/share/agent-observatory/ops/backfill.log',
)
const DEFAULT_OUT = join(ROOT, 'data/trust.json')

class TrustSidecarArgError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TrustSidecarArgError'
  }
}

export function parseTrustSidecarArgs(argv) {
  const args = {
    ledgerStore: DEFAULT_LEDGER_STORE,
    projectMap: DEFAULT_PROJECT_MAP,
    backfillLog: DEFAULT_BACKFILL_LOG,
    out: DEFAULT_OUT,
    generatedAt: new Date().toISOString(),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    switch (flag) {
      case '--ledger-store':
        args.ledgerStore = requireValue(argv, (i += 1), flag)
        break
      case '--project-map':
        args.projectMap = requireValue(argv, (i += 1), flag)
        break
      case '--backfill-log':
        args.backfillLog = requireValue(argv, (i += 1), flag)
        break
      case '--out':
        args.out = requireValue(argv, (i += 1), flag)
        break
      case '--generated-at':
        args.generatedAt = requireValue(argv, (i += 1), flag)
        break
      default:
        throw new TrustSidecarArgError(`unknown argument: ${flag}`)
    }
  }

  return args
}

export async function buildTrustSidecarFile(args) {
  const [rows, exceptions, projectMap, lastBackfillAt] = await Promise.all([
    readJsonl(join(args.ledgerStore, 'rows.jsonl')),
    readJsonl(join(args.ledgerStore, 'exceptions-current.jsonl')),
    readJson(args.projectMap),
    readLastBackfillAt(args.backfillLog, join(args.ledgerStore, 'rows.jsonl')),
  ])

  const { sidecar, summary } = buildTrustSidecar({
    generatedAt: args.generatedAt,
    rows,
    projectMap,
    exceptionsCurrent: exceptions.length,
    lastBackfillAt,
  })

  await writeJsonAtomic(args.out, sidecar)
  return {
    out: args.out,
    projects: Object.keys(sidecar.perProject).length,
    generatedAt: sidecar.generatedAt,
    lastBackfillAt: sidecar.ledger.lastBackfillAt,
    directShare: summary.directShare,
    overheadShare: summary.overheadShare,
    directCostPico: summary.directCostPico,
    overheadCostPico: summary.overheadCostPico,
    exceptionsCurrent: summary.exceptionsCurrent,
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readJsonl(path) {
  const text = await readTextIfExists(path)
  if (!text.trim()) return []
  return text
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function readLastBackfillAt(logPath, rowsPath) {
  const log = await readTextIfExists(logPath)
  const matches = [...log.matchAll(/^\[([0-9T:-]+Z)\] ledger backfill ok$/gm)]
  const last = matches.at(-1)?.[1]
  if (last) return last

  try {
    return (await stat(rowsPath)).mtime.toISOString()
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function readTextIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return ''
    throw error
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, path)
  await chmod(path, 0o600)
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw new TrustSidecarArgError(`${flag} requires a value`)
  }
  return value
}

function isNotFound(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

async function main() {
  try {
    const report = await buildTrustSidecarFile(
      parseTrustSidecarArgs(process.argv.slice(2)),
    )
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main()
}
