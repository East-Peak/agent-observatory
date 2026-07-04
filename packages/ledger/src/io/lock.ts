import { chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_DIR = '.backfill.lock';

export async function withStoreLock<T>(storeDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(storeDir, { recursive: true, mode: 0o700 });
  await chmod(storeDir, 0o700);

  const lockDir = join(storeDir, LOCK_DIR);
  try {
    await mkdir(lockDir, { mode: 0o700 });
  } catch (error) {
    if (isAlreadyExists(error)) throw new Error('ledger backfill already running');
    throw error;
  }

  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}
