import { chmod, lstat, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { LedgerProjectMap } from '../domain/durable.js';

export async function readLedgerProjectMap(path: string): Promise<LedgerProjectMap | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as LedgerProjectMap;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function discoverGitRoots(searchRoots: readonly string[]): Promise<string[]> {
  const roots = new Set<string>();
  for (const root of searchRoots) {
    if (await isGitRoot(root)) roots.add(root);
    for (const child of await readDirs(root)) {
      const path = join(root, child);
      const linkStat = await lstat(path);
      if (linkStat.isSymbolicLink()) continue;
      if (await isGitRoot(path)) roots.add(path);
    }
  }
  return [...roots].sort();
}

export async function discoverWorkspaceProjectNames(workspaceRoot: string): Promise<string[]> {
  const projectsDir = join(workspaceRoot, 'projects');
  const names = new Set<string>();
  for (const entry of await readProjectEntries(projectsDir)) {
    if (entry.kind === 'file' && entry.name.endsWith('.md')) names.add(basename(entry.name, '.md'));
    if (entry.kind === 'directory' && !entry.name.startsWith('.')) names.add(entry.name);
  }
  return [...names].sort();
}

export async function writeLedgerProjectMap(
  path: string,
  map: LedgerProjectMap,
  options: { readonly force: boolean },
): Promise<void> {
  await ensurePrivateDir(dirname(path));
  if (!options.force && (await exists(path))) throw new Error(`project map already exists: ${path}`);
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}

async function isGitRoot(path: string): Promise<boolean> {
  try {
    const git = await stat(join(path, '.git'));
    return git.isDirectory() || git.isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function readDirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function readProjectEntries(path: string): Promise<{ name: string; kind: 'file' | 'directory' }[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
