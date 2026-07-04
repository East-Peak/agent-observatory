import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { buildLedgerProjectMap, validateLedgerProjectMap } from '../domain/projectMap.js';
import { discoverGitRoots, discoverWorkspaceProjectNames, readLedgerProjectMap } from '../io/projectMap.js';
import { installLedgerOps, type LedgerOpsConfig } from '../ops/install.js';
import { defaultWorkspaceRoot } from './init.js';

interface InstallOpsArgs extends LedgerOpsConfig {
  readonly projectsRoot: string;
  readonly workspaceRoot: string;
  readonly force: boolean;
  readonly dryRun: boolean;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function main(): Promise<void> {
  const args = parseInstallOpsArgs(process.argv.slice(2));
  const [repoRoots, workspaceProjectNames] = await Promise.all([
    discoverGitRoots([args.projectsRoot]),
    discoverWorkspaceProjectNames(args.workspaceRoot),
  ]);
  const existingMap = await readLedgerProjectMap(args.projectMapPath);
  const projectMap = buildLedgerProjectMap({
    workspaceRoot: args.workspaceRoot,
    repoRoots,
    workspaceProjectNames,
    existingMap: existingMap ?? undefined,
  });
  const mapErrors = validateLedgerProjectMap(projectMap);
  if (mapErrors.length > 0) throw new Error(`invalid generated project map: ${mapErrors.join('; ')}`);

  if (args.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: true,
          repoTargets: projectMap.targets.filter((target) => target.kind === 'repo').length,
          directTargets: projectMap.targets.filter((target) => target.kind === 'direct').length,
          totalTargets: projectMap.targets.length,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const result = await installLedgerOps(args, projectMap, { force: args.force });
  process.stdout.write(`${JSON.stringify({ dryRun: false, ...result }, null, 2)}\n`);
}

export function parseInstallOpsArgs(argv: readonly string[]): InstallOpsArgs {
  const home = homedir();
  const defaults: InstallOpsArgs = {
    repoDir: rootDir,
    projectsRoot: join(home, 'projects'),
    workspaceRoot: defaultWorkspaceRoot(home),
    opsDir: join(home, '.local/share/agent-observatory/ops'),
    configDir: join(home, '.config/agent-observatory'),
    storeDir: join(home, '.local/share/agent-observatory/ledger'),
    backupDir: join(home, '.local/share/agent-observatory/ledger-backups'),
    launchAgentsDir: join(home, 'Library/LaunchAgents'),
    transcriptsDir: join(home, '.claude'),
    rateCardPath: join(rootDir, 'rateCard.json'),
    projectMapPath: join(home, '.config/agent-observatory/project-map.json'),
    graceMinutes: 5,
    backfillLabel: 'local.agent-observatory.ledger-backfill',
    backupLabel: 'local.agent-observatory.ledger-backup',
    force: false,
    dryRun: false,
  };
  const mutable = { ...defaults };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--force':
        mutable.force = true;
        break;
      case '--dry-run':
        mutable.dryRun = true;
        break;
      case '--projects-root':
        mutable.projectsRoot = valueOf(argv, ++i, arg);
        break;
      case '--workspace-root':
        mutable.workspaceRoot = valueOf(argv, ++i, arg);
        break;
      case '--ops-dir':
        mutable.opsDir = valueOf(argv, ++i, arg);
        break;
      case '--store':
        mutable.storeDir = valueOf(argv, ++i, arg);
        break;
      case '--backup-dir':
        mutable.backupDir = valueOf(argv, ++i, arg);
        break;
      case '--project-map':
        mutable.projectMapPath = valueOf(argv, ++i, arg);
        break;
      case '--grace-minutes':
        mutable.graceMinutes = nonNegativeInteger(valueOf(argv, ++i, arg), arg);
        break;
      default:
        throw new Error(`unknown option: ${arg ?? ''}`);
    }
  }

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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
