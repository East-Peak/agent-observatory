import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Source } from '../domain/types.js';
import type { DurableLedgerRow } from '../domain/durable.js';

export type { DurableLedgerRow } from '../domain/durable.js';

export const EXCEPTION_SCHEMA_VERSION = 'agent-ledger-exception/v1';

export interface LedgerExceptionRecord {
  readonly schema_version: typeof EXCEPTION_SCHEMA_VERSION;
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly source?: Source;
  readonly transcript_key?: string;
  readonly transcript_hash?: string;
  readonly row_key?: string;
  /** Sanitized summary only: no raw paths, prompts, commands, model names, or transcript lines. */
  readonly message: string;
}

export interface UpsertResult {
  readonly rowsWritten: number;
  readonly exceptions: readonly LedgerExceptionRecord[];
}

const ROWS_FILE = 'rows.jsonl';
const EXCEPTIONS_FILE = 'exceptions.jsonl';

export async function readDurableRows(storeDir: string): Promise<DurableLedgerRow[]> {
  const text = await readTextIfExists(join(storeDir, ROWS_FILE));
  if (!text.trim()) return [];
  return text
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DurableLedgerRow);
}

export async function upsertDurableRows(
  storeDir: string,
  incoming: readonly DurableLedgerRow[],
): Promise<UpsertResult> {
  await ensurePrivateDir(storeDir);
  const byKey = new Map((await readDurableRows(storeDir)).map((row) => [row.row_key, row]));
  const exceptions: LedgerExceptionRecord[] = [];

  for (const row of incoming) {
    const existing = byKey.get(row.row_key);
    if (existing && existing.transcript_key !== row.transcript_key) {
      exceptions.push({
        schema_version: EXCEPTION_SCHEMA_VERSION,
        code: 'duplicate-session-conflict',
        severity: 'error',
        source: row.source,
        transcript_key: row.transcript_key,
        transcript_hash: row.transcript_hash,
        row_key: row.row_key,
        message: 'same row key appeared from a different transcript key',
      });
      continue;
    }
    byKey.set(row.row_key, row);
  }

  const rows = [...byKey.values()].sort((a, b) => a.row_key.localeCompare(b.row_key));
  await writeJsonlPrivate(join(storeDir, ROWS_FILE), rows);
  return { rowsWritten: rows.length, exceptions };
}

export async function writeExceptionRecords(
  storeDir: string,
  exceptions: readonly LedgerExceptionRecord[],
  filePath = join(storeDir, EXCEPTIONS_FILE),
): Promise<number> {
  if (exceptions.length === 0) return 0;
  await ensurePrivateDir(storeDir);
  await ensureParentDir(filePath);
  const existing = (await readTextIfExists(filePath))
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerExceptionRecord);
  const byJson = new Map<string, LedgerExceptionRecord>();
  for (const exception of [...existing, ...exceptions]) byJson.set(JSON.stringify(exception), exception);
  const rows = [...byJson.values()].sort((a, b) =>
    `${a.code}:${a.transcript_key ?? ''}:${a.row_key ?? ''}`.localeCompare(
      `${b.code}:${b.transcript_key ?? ''}:${b.row_key ?? ''}`,
    ),
  );
  await writeJsonlPrivate(filePath, rows);
  return exceptions.length;
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return '';
    throw error;
  }
}

async function writeJsonlPrivate(path: string, rows: readonly unknown[]): Promise<void> {
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, text ? `${text}\n` : '', { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}

async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
