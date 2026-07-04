import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ledgerOpsPaths, uninstallLedgerOps } from '../ops/install.js';
import { parseInstallOpsArgs } from './install-ops.js';

async function main(): Promise<void> {
  const args = parseInstallOpsArgs(process.argv.slice(2));
  if (args.dryRun) {
    const paths = ledgerOpsPaths(args);
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          filesWouldRemove: [
            paths.readme,
            paths.gitignore,
            paths.backfillScript,
            paths.backupScript,
            paths.backfillPlist,
            paths.backupPlist,
          ],
          bootoutCommands: [
            `launchctl bootout gui/$(id -u)/${args.backfillLabel}`,
            `launchctl bootout gui/$(id -u)/${args.backupLabel}`,
          ],
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const result = await uninstallLedgerOps(args);
  process.stdout.write(`${JSON.stringify({ dryRun: false, ...result }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
