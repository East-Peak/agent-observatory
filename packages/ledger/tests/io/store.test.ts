import { chmod, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readDurableRows,
  upsertDurableRows,
  writeExceptionRecords,
  writeCurrentExceptionRecords,
  type DurableLedgerRow,
  type LedgerExceptionRecord,
} from '../../src/io/store.js';

const row = (overrides: Partial<DurableLedgerRow> = {}): DurableLedgerRow => ({
  schema_version: 'agent-ledger-row/v1',
  row_key: 'claude:session:2026-07-03:model',
  source: 'claude',
  session_key: 'session',
  date: '2026-07-03',
  model: 'model',
  transcript_hash: 'sha256:content-a',
  transcript_key: 'sha256:path-a',
  versions: {
    adapter: 'claude-v1',
    classifier: 'classifier-v1',
    allocator: 'allocator-v1',
    pricer: 'pricing-v1',
    rate_card: 'rate-card-v1',
  },
  turns: 1,
  total_cost_pico: '10',
  total_tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, reasoning: 5 },
  allocations: [
    {
      project_key: 'proj_a',
      target_kind: 'repo',
      cost_pico: '10',
      tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, reasoning: 5 },
      evidence: ['cwd'],
    },
  ],
  ...overrides,
});

describe('durable ledger store', () => {
  it('upserts rows deterministically without duplicate append behavior', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    await upsertDurableRows(store, [row()]);
    const first = await readFile(join(store, 'rows.jsonl'), 'utf8');

    await upsertDurableRows(store, [row()]);
    const second = await readFile(join(store, 'rows.jsonl'), 'utf8');

    expect(second).toBe(first);
    expect(await readDurableRows(store)).toHaveLength(1);
  });

  it('replaces a growing transcript from the same transcript key', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    await upsertDurableRows(store, [row()]);
    await upsertDurableRows(store, [
      row({ transcript_hash: 'sha256:content-b', total_cost_pico: '20', total_tokens: row().total_tokens }),
    ]);

    const rows = await readDurableRows(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ transcript_hash: 'sha256:content-b', total_cost_pico: '20' });
  });

  it('quarantines same row key from a different transcript key instead of overwriting', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const result = await upsertDurableRows(store, [
      row(),
      row({ transcript_hash: 'sha256:content-b', transcript_key: 'sha256:path-b' }),
    ]);

    expect(result.rowsWritten).toBe(1);
    expect(result.exceptions).toEqual([
      expect.objectContaining({
        schema_version: 'agent-ledger-exception/v1',
        code: 'duplicate-session-conflict',
        row_key: 'claude:session:2026-07-03:model',
      }),
    ]);
    expect(await readDurableRows(store)).toHaveLength(1);
  });

  it('writes private files and sanitized exception records', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const exception: LedgerExceptionRecord = {
      schema_version: 'agent-ledger-exception/v1',
      code: 'unknown-rate',
      severity: 'error',
      source: 'claude',
      transcript_key: 'sha256:path',
      transcript_hash: 'sha256:content',
      message: 'no rate for model',
    };

    await writeExceptionRecords(store, [exception]);
    const text = await readFile(join(store, 'exceptions.jsonl'), 'utf8');
    const mode = (await stat(join(store, 'exceptions.jsonl'))).mode & 0o777;

    expect(text).toBe(`${JSON.stringify(exception)}\n`);
    expect(text).not.toContain('/Users/example');
    expect(mode).toBe(0o600);
  });

  it('does not chmod an existing external exceptions-out parent directory', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const external = await mkdtemp(join(tmpdir(), 'ledger-external-'));
    await chmod(external, 0o755);

    await writeExceptionRecords(
      store,
      [
        {
          schema_version: 'agent-ledger-exception/v1',
          code: 'unknown-rate',
          severity: 'error',
          message: 'sanitized',
        },
      ],
      join(external, 'exceptions.jsonl'),
    );

    expect((await stat(external)).mode & 0o777).toBe(0o755);
    expect((await stat(join(external, 'exceptions.jsonl'))).mode & 0o777).toBe(0o600);
  });

  it('overwrites current-run exceptions separately from history', async () => {
    const store = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const first: LedgerExceptionRecord = {
      schema_version: 'agent-ledger-exception/v1',
      code: 'first',
      severity: 'error',
      message: 'first',
    };
    const second: LedgerExceptionRecord = {
      schema_version: 'agent-ledger-exception/v1',
      code: 'second',
      severity: 'error',
      message: 'second',
    };

    await writeCurrentExceptionRecords(store, [first]);
    await writeCurrentExceptionRecords(store, [second]);

    const text = await readFile(join(store, 'exceptions-current.jsonl'), 'utf8');
    expect(text).toBe(`${JSON.stringify(second)}\n`);
    expect((await stat(join(store, 'exceptions-current.jsonl'))).mode & 0o777).toBe(0o600);
  });
});
