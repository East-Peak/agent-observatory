import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_DIR = '.backfill.lock';
const LOCK_INFO = 'owner.json';
const DEFAULT_STALE_MS = 3 * 60 * 60 * 1000;

export interface StoreLockOptions {
  readonly staleMs?: number;
  readonly nowMs?: number;
}

export async function withStoreLock<T>(
  storeDir: string,
  fn: () => Promise<T>,
  options: StoreLockOptions = {},
): Promise<T> {
  await mkdir(storeDir, { recursive: true, mode: 0o700 });
  await chmod(storeDir, 0o700);

  const lockDir = join(storeDir, LOCK_DIR);
  await acquireLock(lockDir, options);

  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function acquireLock(lockDir: string, options: StoreLockOptions): Promise<void> {
  try {
    await mkdir(lockDir, { mode: 0o700 });
    await writeLockInfo(lockDir, options.nowMs ?? Date.now());
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (await isStale(lockDir, options)) {
      await rm(lockDir, { recursive: true, force: true });
      await mkdir(lockDir, { mode: 0o700 });
      await writeLockInfo(lockDir, options.nowMs ?? Date.now());
      return;
    }
    throw new Error('ledger backfill already running');
  }
}

async function writeLockInfo(lockDir: string, nowMs: number): Promise<void> {
  await writeFile(
    join(lockDir, LOCK_INFO),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date(nowMs).toISOString() })}\n`,
    { mode: 0o600 },
  );
}

async function isStale(lockDir: string, options: StoreLockOptions): Promise<boolean> {
  const lockStat = await stat(lockDir);
  return (options.nowMs ?? Date.now()) - lockStat.mtimeMs > (options.staleMs ?? DEFAULT_STALE_MS);
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}
