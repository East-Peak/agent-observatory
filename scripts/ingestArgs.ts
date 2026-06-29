/**
 * Pure argv parser for `scripts/ingest.mjs`. Kept separate (and TypeScript) so it is
 * type-checked and unit-tested like the rest of the codebase; the plain-Node ingest script
 * imports it via Node's native TS type-stripping. Fails closed on anything unrecognized so the
 * frozen `node scripts/ingest.mjs` invocation can never silently do the wrong thing.
 */

/** Where the records come from: real `ccusage` output, or the committed decoder fixtures. */
export type IngestSource = 'ccusage' | 'fixture';

export interface IngestPlan {
  /** `selfcheck` runs the offline argv self-test and exits; `ingest` runs the pipeline. */
  readonly kind: 'selfcheck' | 'ingest';
  readonly source: IngestSource;
  /** Validate only — do not write the snapshot. */
  readonly check: boolean;
  /** Output path for the written snapshot. */
  readonly out: string;
}

/** The default snapshot output path (gitignored; rebuilt from ccusage on each ingest). */
export const DEFAULT_OUT = 'data/snapshot.json';

export class IngestArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestArgError';
  }
}

export function parseIngestArgs(argv: readonly string[]): IngestPlan {
  // --argv-selfcheck is exclusive: it's the gate's offline self-test entry point.
  if (argv.includes('--argv-selfcheck')) {
    return { kind: 'selfcheck', source: 'ccusage', check: false, out: DEFAULT_OUT };
  }

  let source: IngestSource = 'ccusage';
  let check = false;
  let out = DEFAULT_OUT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--from-fixture':
        source = 'fixture';
        break;
      case '--check':
        check = true;
        break;
      case '--out': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('-')) {
          throw new IngestArgError('--out requires a path argument');
        }
        out = value;
        i++;
        break;
      }
      default:
        throw new IngestArgError(
          arg.startsWith('-') ? `unknown flag: ${arg}` : `unexpected positional argument: ${arg}`,
        );
    }
  }

  return { kind: 'ingest', source, check, out };
}
