/**
 * Pure argv parser for `scripts/ingest.mjs`. Kept separate (and TypeScript) so it is
 * type-checked and unit-tested like the rest of the codebase; the plain-Node ingest script
 * imports it via Node's native TS type-stripping. Fails closed on anything unrecognized so the
 * frozen `node scripts/ingest.mjs` invocation can never silently do the wrong thing.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where the records come from: real `ccusage` output, or the committed decoder fixtures. */
export type IngestSource = 'ledger' | 'ccusage' | 'fixture'

export interface IngestPlan {
  /** `selfcheck` runs the offline argv self-test and exits; `ingest` runs the pipeline. */
  readonly kind: 'selfcheck' | 'ingest'
  readonly source: IngestSource
  /** Validate only — do not write the snapshot. */
  readonly check: boolean
  /** Output path for the written snapshot. */
  readonly out: string
  /** Local durable ledger store. Used when `source === "ledger"`; still parsed in fixture mode for selfcheck stability. */
  readonly ledgerStore: string
  /** Local private ledger project map. Used when `source === "ledger"`; never committed. */
  readonly projectMap: string
}

/** The default snapshot output path (gitignored; rebuilt from ccusage on each ingest). */
export const DEFAULT_OUT = 'data/snapshot.json'
export const DEFAULT_LEDGER_STORE = join(
  homedir(),
  '.local/share/agent-observatory/ledger',
)
export const DEFAULT_PROJECT_MAP = join(
  homedir(),
  '.config/agent-observatory/project-map.json',
)

export class IngestArgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IngestArgError'
  }
}

export function parseIngestArgs(argv: readonly string[]): IngestPlan {
  // --argv-selfcheck is exclusive: it's the gate's offline self-test entry point and takes no other
  // arguments — reject extras so the fail-closed argv contract holds outside the fixed verifier command.
  if (argv.includes('--argv-selfcheck')) {
    if (argv.length !== 1) {
      throw new IngestArgError(
        '--argv-selfcheck does not accept other arguments',
      )
    }
    return {
      kind: 'selfcheck',
      source: 'ledger',
      check: false,
      out: DEFAULT_OUT,
      ledgerStore: DEFAULT_LEDGER_STORE,
      projectMap: DEFAULT_PROJECT_MAP,
    }
  }

  let source: IngestSource = 'ledger'
  let check = false
  let out = DEFAULT_OUT
  let ledgerStore = DEFAULT_LEDGER_STORE
  let projectMap = DEFAULT_PROJECT_MAP

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--from-fixture':
        source = 'fixture'
        break
      case '--from-ccusage':
        source = 'ccusage'
        break
      case '--check':
        check = true
        break
      case '--out': {
        const value = argv[i + 1]
        if (value === undefined || value.startsWith('-')) {
          throw new IngestArgError('--out requires a path argument')
        }
        out = value
        i++
        break
      }
      case '--ledger-store':
        ledgerStore = flagValue(argv, ++i, arg)
        break
      case '--project-map':
        projectMap = flagValue(argv, ++i, arg)
        break
      default:
        throw new IngestArgError(
          arg.startsWith('-')
            ? `unknown flag: ${arg}`
            : `unexpected positional argument: ${arg}`,
        )
    }
  }

  return { kind: 'ingest', source, check, out, ledgerStore, projectMap }
}

function flagValue(
  argv: readonly string[],
  index: number,
  flag: string,
): string {
  const value = argv[index]
  if (value === undefined || value.startsWith('-')) {
    throw new IngestArgError(`${flag} requires a path argument`)
  }
  return value
}
