import { readFile } from 'node:fs/promises';
import { backfillOnce } from '../backfill.js';
import { parseBackfillArgs } from './args.js';
import type { LedgerProjectMap } from '../domain/durable.js';
import type { RateCard } from '../../../pricing/src/index.js';
import { withStoreLock } from '../io/lock.js';

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  const [projectMap, rateCard] = await Promise.all([
    readJson<LedgerProjectMap>(args.projectMapPath),
    readJson<RateCard>(args.rateCardPath),
  ]);

  const summary = await withStoreLock(args.storeDir, () =>
    backfillOnce({
      transcriptsDir: args.transcriptsDir,
      storeDir: args.storeDir,
      projectMap,
      rateCard,
      graceMs: args.graceMinutes * 60_000,
      dryRun: args.dryRun,
      exceptionsOut: args.exceptionsOut,
    }),
  );

  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

await main();
