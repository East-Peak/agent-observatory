import { readFile, stat } from 'node:fs/promises';
import { agentTurnsFromClaudeLines } from './adapters/claude.js';
import { allocateSession } from './domain/allocate.js';
import {
  encodeDurableRow,
  ledgerProjectMapToClassifierMap,
  prefixedSha256,
  versionsForRateCard,
  type LedgerProjectMap,
} from './domain/durable.js';
import { pricerFromRateCard } from './domain/pricing.js';
import type { RateCard } from '../../pricing/src/index.js';
import type { AgentTurn } from './domain/types.js';
import { scanClaudeTranscriptFiles } from './io/scan.js';
import {
  EXCEPTION_SCHEMA_VERSION,
  upsertDurableRows,
  writeCurrentExceptionRecords,
  writeExceptionRecords,
  type DurableLedgerRow,
  type LedgerExceptionRecord,
} from './io/store.js';

export interface BackfillOptions {
  readonly transcriptsDir: string;
  readonly storeDir: string;
  readonly projectMap: LedgerProjectMap;
  readonly rateCard: RateCard;
  readonly graceMs: number;
  readonly dryRun?: boolean;
  readonly exceptionsOut?: string;
}

export interface BackfillSummary {
  readonly scanned: number;
  readonly rowsWritten: number;
  readonly exceptionsWritten: number;
  readonly dryRun: boolean;
}

export async function backfillOnce(options: BackfillOptions): Promise<BackfillSummary> {
  const transcriptFiles = await scanClaudeTranscriptFiles({
    transcriptsDir: options.transcriptsDir,
    graceMs: options.graceMs,
  });
  const rows: DurableLedgerRow[] = [];
  const exceptions: LedgerExceptionRecord[] = [];

  for (const file of transcriptFiles) {
    const read = await readStableFile(file);
    const transcriptKey = prefixedSha256(file);
    if (!read.stable) {
      exceptions.push(exception('transcript-changed-during-read', transcriptKey, undefined, 'claude'));
      continue;
    }

    const transcriptHash = prefixedSha256(read.text);
    const parsed = parseJsonl(read.text, transcriptKey, transcriptHash);
    exceptions.push(...parsed.exceptions);

    const invalidBillable = invalidBillableRows(parsed.lines, transcriptKey, transcriptHash);
    exceptions.push(...invalidBillable);
    const fileFatal = parsed.fatal || invalidBillable.length > 0;

    const turns = agentTurnsFromClaudeLines(parsed.lines);
    if (turns.some((turn) => !turn.sessionId)) {
      exceptions.push(exception('missing-session-id', transcriptKey, transcriptHash, 'claude'));
      continue;
    }

    const fileRows: DurableLedgerRow[] = [];
    let groupFatal = false;
    for (const group of groupTurns(turns)) {
      try {
        const session = allocateSession(
          group.turns,
          ledgerProjectMapToClassifierMap(options.projectMap),
          pricerFromRateCard(options.rateCard),
        );
        const durable = encodeDurableRow(session, {
          source: group.source,
          date: group.date,
          model: group.model,
          transcriptHash,
          transcriptKey,
          projectMap: options.projectMap,
          versions: versionsForRateCard(options.rateCard),
        });
        fileRows.push(durable);
      } catch (error) {
        groupFatal = true;
        exceptions.push(exception(codeForGroupError(error), transcriptKey, transcriptHash, group.source));
      }
    }

    if (!fileFatal && !groupFatal) rows.push(...fileRows);
  }

  if (options.dryRun) {
    return {
      scanned: transcriptFiles.length,
      rowsWritten: rows.length,
      exceptionsWritten: exceptions.length,
      dryRun: true,
    };
  }

  const upsert = await upsertDurableRows(options.storeDir, rows);
  const allExceptions = [...exceptions, ...upsert.exceptions];
  const exceptionsWritten = await writeExceptionRecords(
    options.storeDir,
    allExceptions,
    options.exceptionsOut,
  );
  await writeCurrentExceptionRecords(options.storeDir, allExceptions);
  return {
    scanned: transcriptFiles.length,
    rowsWritten: upsert.rowsWritten,
    exceptionsWritten,
    dryRun: false,
  };
}

interface StableRead {
  readonly stable: boolean;
  readonly text: string;
}

async function readStableFile(file: string): Promise<StableRead> {
  const before = await stat(file);
  const text = await readFile(file, 'utf8');
  const after = await stat(file);
  return { stable: before.size === after.size && before.mtimeMs === after.mtimeMs, text };
}

interface ParsedJsonl {
  readonly lines: readonly unknown[];
  readonly exceptions: readonly LedgerExceptionRecord[];
  readonly fatal: boolean;
}

function parseJsonl(text: string, transcriptKey: string, transcriptHash: string): ParsedJsonl {
  const lines: unknown[] = [];
  const exceptions: LedgerExceptionRecord[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      exceptions.push(exception('malformed-json', transcriptKey, transcriptHash, 'claude'));
    }
  }
  return { lines, exceptions, fatal: exceptions.length > 0 };
}

function invalidBillableRows(
  lines: readonly unknown[],
  transcriptKey: string,
  transcriptHash: string,
): LedgerExceptionRecord[] {
  const exceptions: LedgerExceptionRecord[] = [];
  for (const line of lines) {
    if (!isRecord(line)) continue;
    const message = line['message'];
    if (!isRecord(message) || !isRecord(message['usage'])) continue;
    const model = message['model'];
    const timestamp = line['timestamp'];
    const date = typeof timestamp === 'string' ? new Date(timestamp) : null;
    if (typeof model !== 'string' || !model || !date || Number.isNaN(date.getTime())) {
      exceptions.push(exception('invalid-billable-row', transcriptKey, transcriptHash, 'claude'));
    } else if (!isValidClaudeUsage(message['usage'])) {
      exceptions.push(exception('invalid-usage-row', transcriptKey, transcriptHash, 'claude'));
    }
  }
  return exceptions;
}

const REQUIRED_CLAUDE_USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const;

function isValidClaudeUsage(
  value: unknown,
): value is Record<(typeof REQUIRED_CLAUDE_USAGE_FIELDS)[number], number> {
  if (!isRecord(value)) return false;
  return REQUIRED_CLAUDE_USAGE_FIELDS.every((field) => {
    const usageValue = value[field];
    return typeof usageValue === 'number' && Number.isInteger(usageValue) && usageValue >= 0;
  });
}

interface TurnGroup {
  readonly source: AgentTurn['source'];
  readonly date: string;
  readonly model: string;
  readonly turns: readonly AgentTurn[];
}

function groupTurns(turns: readonly AgentTurn[]): TurnGroup[] {
  const byKey = new Map<string, AgentTurn[]>();
  for (const turn of turns) {
    const key = `${turn.source}\t${turn.sessionId}\t${turn.date}\t${turn.model}`;
    const group = byKey.get(key);
    if (group) group.push(turn);
    else byKey.set(key, [turn]);
  }
  return [...byKey.values()]
    .map((group) => ({
      source: group[0]!.source,
      date: group[0]!.date,
      model: group[0]!.model,
      turns: group,
    }))
    .sort((a, b) => `${a.source}:${a.date}:${a.model}`.localeCompare(`${b.source}:${b.date}:${b.model}`));
}

function exception(
  code: string,
  transcriptKey: string,
  transcriptHash: string | undefined,
  source: AgentTurn['source'],
): LedgerExceptionRecord {
  return {
    schema_version: EXCEPTION_SCHEMA_VERSION,
    code,
    severity: 'error',
    source,
    transcript_key: transcriptKey,
    transcript_hash: transcriptHash,
    message: sanitizedMessage(code),
  };
}

function sanitizedMessage(code: string): string {
  switch (code) {
    case 'malformed-json':
      return 'transcript contains malformed JSON';
    case 'invalid-billable-row':
      return 'billable transcript row is missing required metadata';
    case 'invalid-usage-row':
      return 'billable transcript row has invalid usage metadata';
    case 'missing-session-id':
      return 'billable transcript rows are missing session id';
    case 'transcript-changed-during-read':
      return 'transcript changed while it was being read';
    case 'project-map-error':
      return 'allocation target is missing from the project map';
    case 'pricing-error':
      return 'pricing or allocation failed';
    default:
      return 'ledger backfill exception';
  }
}

function codeForGroupError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('missing project-map target')) {
    return 'project-map-error';
  }
  return 'pricing-error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
