import { mkdir, mkdtemp, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { withStoreLock } from '../../src/io/lock.js';

describe('ledger store lock', () => {
  it('rejects overlapping runs and releases the lock afterward', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    let release: (() => void) | undefined;
    const first = withStoreLock(store, () => new Promise<void>((resolve) => (release = resolve)));
    while (!release) await delay(0);

    await expect(withStoreLock(store, () => Promise.resolve())).rejects.toThrow(/already running/);
    release();
    await first;

    await expect(withStoreLock(store, () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('keeps the store directory private while locking', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));

    await withStoreLock(store, () => Promise.resolve());

    expect((await stat(store)).mode & 0o777).toBe(0o700);
  });

  it('reclaims stale lock directories', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const lock = join(store, '.backfill.lock');
    await mkdir(lock);
    const old = new Date('2026-07-03T00:00:00.000Z');
    await utimes(lock, old, old);

    await expect(
      withStoreLock(store, () => Promise.resolve('ok'), {
        nowMs: Date.parse('2026-07-03T01:00:00.000Z'),
        staleMs: 1_000,
      }),
    ).resolves.toBe('ok');
  });
});
