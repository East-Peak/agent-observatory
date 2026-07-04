import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedgerProjectMap, validateLedgerProjectMap } from '../domain/projectMap.js';
import {
  discoverGitRoots,
  discoverWorkspaceProjectNames,
  readLedgerProjectMap,
  writeLedgerProjectMap,
} from '../io/projectMap.js';

export interface InitArgs {
  readonly projectsRoot: string;
  readonly workspaceRoot: string;
  readonly projectMapPath: string;
  readonly force: boolean;
  readonly dryRun: boolean;
}

export interface InitResult {
  readonly dryRun: boolean;
  readonly repoTargets: number;
  readonly directTargets: number;
  readonly totalTargets: number;
  readonly projectMapPath: string;
}

export function defaultWorkspaceRoot(home = homedir()): string {
  return join(home, '.config/agent-observatory/workspace');
}

export function parseInitArgs(argv: readonly string[]): InitArgs {
  const home = homedir();
  const mutable = {
    projectsRoot: join(home, 'projects'),
    workspaceRoot: defaultWorkspaceRoot(home),
    projectMapPath: join(home, '.config/agent-observatory/project-map.json'),
    force: false,
    dryRun: false,
  };

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
      case '--project-map':
        mutable.projectMapPath = valueOf(argv, ++i, arg);
        break;
      default:
        throw new Error(`unknown option: ${arg ?? ''}`);
    }
  }

  return mutable;
}

export async function initLedgerProjectMap(args: InitArgs): Promise<InitResult> {
  const [repoRoots, workspaceProjectNames, existingMap] = await Promise.all([
    discoverGitRoots([args.projectsRoot]),
    discoverWorkspaceProjectNames(args.workspaceRoot),
    readLedgerProjectMap(args.projectMapPath),
  ]);
  const projectMap = buildLedgerProjectMap({
    workspaceRoot: args.workspaceRoot,
    repoRoots,
    workspaceProjectNames,
    existingMap: existingMap ?? undefined,
  });
  const errors = validateLedgerProjectMap(projectMap);
  if (errors.length > 0) throw new Error(`invalid generated project map: ${errors.join('; ')}`);

  if (!args.dryRun) {
    await writeLedgerProjectMap(args.projectMapPath, projectMap, { force: args.force });
  }

  return {
    dryRun: args.dryRun,
    repoTargets: projectMap.targets.filter((target) => target.kind === 'repo').length,
    directTargets: projectMap.targets.filter((target) => target.kind === 'direct').length,
    totalTargets: projectMap.targets.length,
    projectMapPath: args.projectMapPath,
  };
}

function valueOf(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
  return value;
}

async function main(): Promise<void> {
  const result = await initLedgerProjectMap(parseInitArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
