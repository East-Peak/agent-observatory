import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface BackfillCliArgs {
  readonly once: boolean;
  readonly dryRun: boolean;
  readonly storeDir: string;
  readonly transcriptsDir: string;
  readonly projectMapPath: string;
  readonly rateCardPath: string;
  readonly graceMinutes: number;
  readonly exceptionsOut?: string;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export function parseBackfillArgs(argv: readonly string[]): BackfillCliArgs {
  const args: BackfillCliArgs = {
    once: false,
    dryRun: false,
    storeDir: join(homedir(), '.local/share/agent-observatory/ledger'),
    transcriptsDir: join(homedir(), '.claude'),
    projectMapPath: join(homedir(), '.config/agent-observatory/project-map.json'),
    rateCardPath: join(rootDir, 'rateCard.json'),
    graceMinutes: 5,
  };

  const mutable: {
    once: boolean;
    dryRun: boolean;
    storeDir: string;
    transcriptsDir: string;
    projectMapPath: string;
    rateCardPath: string;
    graceMinutes: number;
    exceptionsOut?: string;
  } = { ...args };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--once':
        mutable.once = true;
        break;
      case '--dry-run':
        mutable.dryRun = true;
        break;
      case '--store':
        mutable.storeDir = valueOf(argv, ++i, arg);
        break;
      case '--transcripts-dir':
        mutable.transcriptsDir = valueOf(argv, ++i, arg);
        break;
      case '--project-map':
        mutable.projectMapPath = valueOf(argv, ++i, arg);
        break;
      case '--rate-card':
        mutable.rateCardPath = valueOf(argv, ++i, arg);
        break;
      case '--grace-minutes':
        mutable.graceMinutes = nonNegativeInteger(valueOf(argv, ++i, arg), arg);
        break;
      case '--exceptions-out':
        mutable.exceptionsOut = valueOf(argv, ++i, arg);
        break;
      default:
        throw new Error(`unknown option: ${arg ?? ''}`);
    }
  }

  if (!mutable.once) throw new Error('backfill requires --once');
  return mutable;
}

function valueOf(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
  return value;
}

function nonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}
