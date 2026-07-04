import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backfillOnce } from '../src/backfill.js';
import type { LedgerProjectMap } from '../src/domain/durable.js';
import { buildLedgerProjectMap, opaqueProjectKeyFromName } from '../src/domain/projectMap.js';
import type { RateCard } from '../../pricing/src/index.js';
import { readDurableRows } from '../src/io/store.js';

const card: RateCard = {
  version: 'rate-card-v1',
  asOf: '2026-07-03',
  unit: 'picoUsdPerToken',
  rates: {
    'priced-model': [
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        input: '10',
        output: '100',
        cacheCreation: '20',
        cacheRead: '1',
        reasoning: '100',
      },
    ],
    'other-model': [
      {
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        input: '1',
        output: '1',
        cacheCreation: '1',
        cacheRead: '1',
        reasoning: '1',
      },
    ],
  },
};

const assistantLine = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  sessionId: 'raw-session-id',
  cwd: '/tmp/repo-a',
  timestamp: '2026-07-03T12:00:00.000Z',
  message: {
    role: 'assistant',
    model: 'priced-model',
    usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 },
    content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/repo-a/file.ts' } }],
  },
  ...overrides,
});

const assistantMessageForRepo = (repoRoot: string, model = 'priced-model'): Record<string, unknown> => ({
  role: 'assistant',
  model,
  usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 },
  content: [{ type: 'tool_use', name: 'Edit', input: { file_path: join(repoRoot, 'file.ts') } }],
});

async function writeOldTranscript(root: string, rel: string, lines: readonly string[]): Promise<string> {
  const path = join(root, 'projects', 'proj', rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${lines.join('\n')}\n`);
  const old = new Date('2026-07-03T00:00:00.000Z');
  await utimes(path, old, old);
  return path;
}

describe('backfillOnce', () => {
  it('writes sanitized durable rows idempotently from Claude transcript files', async () => {
    const transcriptsDir = await mkdtemp(join(tmpdir(), 'claude-transcripts-'));
    const storeDir = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const repoRoot = join(transcriptsDir, 'repo-a');
    const projectMap: LedgerProjectMap = {
      version: 'map-v1',
      workspaceRoot: join(transcriptsDir, 'workspace'),
      targets: [{ kind: 'repo', key: repoRoot, projectKey: 'proj_a' }],
    };
    const transcript = JSON.stringify(
      assistantLine({ cwd: repoRoot, message: assistantMessageForRepo(repoRoot) }),
    );
    await writeOldTranscript(transcriptsDir, 'session.jsonl', [transcript]);

    const first = await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });
    const second = await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });
    const rows = await readDurableRows(storeDir);
    const text = await readFile(join(storeDir, 'rows.jsonl'), 'utf8');

    expect(first).toMatchObject({ scanned: 1, rowsWritten: 1, exceptionsWritten: 0 });
    expect(second).toMatchObject({ scanned: 1, rowsWritten: 1, exceptionsWritten: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'claude',
      date: '2026-07-03',
      model: 'priced-model',
      total_cost_pico: '274',
      allocations: [{ project_key: 'proj_a', cost_pico: '274' }],
    });
    expect(text).not.toContain(repoRoot);
    expect(text).not.toContain('raw-session-id');
  });

  it('persists separate durable rows for mixed date/model reconciliation shards', async () => {
    const transcriptsDir = await mkdtemp(join(tmpdir(), 'claude-transcripts-'));
    const storeDir = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const repoRoot = join(transcriptsDir, 'repo-a');
    const projectMap: LedgerProjectMap = {
      version: 'map-v1',
      workspaceRoot: join(transcriptsDir, 'workspace'),
      targets: [{ kind: 'repo', key: repoRoot, projectKey: 'proj_a' }],
    };
    await writeOldTranscript(transcriptsDir, 'session.jsonl', [
      JSON.stringify(assistantLine({ cwd: repoRoot, message: assistantMessageForRepo(repoRoot) })),
      JSON.stringify(
        assistantLine({
          cwd: repoRoot,
          timestamp: '2026-07-04T12:00:00.000Z',
          message: assistantMessageForRepo(repoRoot, 'other-model'),
        }),
      ),
    ]);

    await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });

    expect((await readDurableRows(storeDir)).map((r) => [r.date, r.model]).sort()).toEqual([
      ['2026-07-03', 'priced-model'],
      ['2026-07-04', 'other-model'],
    ]);
  });

  it('writes sanitized exceptions and no partial row for malformed JSON or unknown pricing', async () => {
    const transcriptsDir = await mkdtemp(join(tmpdir(), 'claude-transcripts-'));
    const storeDir = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const repoRoot = join(transcriptsDir, 'repo-a');
    const projectMap: LedgerProjectMap = {
      version: 'map-v1',
      workspaceRoot: join(transcriptsDir, 'workspace'),
      targets: [{ kind: 'repo', key: repoRoot, projectKey: 'proj_a' }],
    };
    await writeOldTranscript(transcriptsDir, 'bad.jsonl', [
      '{not json',
      JSON.stringify(
        assistantLine({
          cwd: repoRoot,
          message: assistantMessageForRepo(repoRoot, 'unpriced-model'),
        }),
      ),
    ]);

    const summary = await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });
    const exceptions = await readFile(join(storeDir, 'exceptions.jsonl'), 'utf8');

    expect(summary).toMatchObject({ scanned: 1, rowsWritten: 0, exceptionsWritten: 2 });
    await expect(readDurableRows(storeDir)).resolves.toEqual([]);
    expect(exceptions).toContain('malformed-json');
    expect(exceptions).toContain('pricing-error');
    expect(exceptions).not.toContain(repoRoot);
    expect(exceptions).not.toContain('unpriced-model');
  });

  it('quarantines malformed usage instead of writing zero-token durable rows', async () => {
    const transcriptsDir = await mkdtemp(join(tmpdir(), 'claude-transcripts-'));
    const storeDir = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const repoRoot = join(transcriptsDir, 'repo-a');
    const projectMap: LedgerProjectMap = {
      version: 'map-v1',
      workspaceRoot: join(transcriptsDir, 'workspace'),
      targets: [{ kind: 'repo', key: repoRoot, projectKey: 'proj_a' }],
    };
    await writeOldTranscript(transcriptsDir, 'bad-usage.jsonl', [
      JSON.stringify(
        assistantLine({
          cwd: repoRoot,
          message: {
            ...assistantMessageForRepo(repoRoot),
            usage: {
              inputTokens: 1,
              output_tokens: '2',
              cache_creation_input_tokens: 3,
              cache_read_input_tokens: 4,
            },
          },
        }),
      ),
    ]);

    const summary = await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });
    const exceptions = await readFile(join(storeDir, 'exceptions.jsonl'), 'utf8');

    expect(summary).toMatchObject({ scanned: 1, rowsWritten: 0, exceptionsWritten: 1 });
    await expect(readDurableRows(storeDir)).resolves.toEqual([]);
    expect(exceptions).toContain('invalid-usage-row');
    expect(exceptions).not.toContain(repoRoot);
    expect(exceptions).not.toContain('inputTokens');
  });

  it('fails closed for the whole transcript when one reconciliation shard cannot price', async () => {
    const transcriptsDir = await mkdtemp(join(tmpdir(), 'claude-transcripts-'));
    const storeDir = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const repoRoot = join(transcriptsDir, 'repo-a');
    const projectMap: LedgerProjectMap = {
      version: 'map-v1',
      workspaceRoot: join(transcriptsDir, 'workspace'),
      targets: [{ kind: 'repo', key: repoRoot, projectKey: 'proj_a' }],
    };
    await writeOldTranscript(transcriptsDir, 'mixed-pricing.jsonl', [
      JSON.stringify(assistantLine({ cwd: repoRoot, message: assistantMessageForRepo(repoRoot) })),
      JSON.stringify(
        assistantLine({
          cwd: repoRoot,
          timestamp: '2026-07-04T12:00:00.000Z',
          message: assistantMessageForRepo(repoRoot, 'unpriced-model'),
        }),
      ),
    ]);

    const summary = await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });
    const exceptions = await readFile(join(storeDir, 'exceptions.jsonl'), 'utf8');

    expect(summary).toMatchObject({ scanned: 1, rowsWritten: 0, exceptionsWritten: 1 });
    await expect(readDurableRows(storeDir)).resolves.toEqual([]);
    expect(exceptions).toContain('pricing-error');
    expect(exceptions).not.toContain('unpriced-model');
  });

  it('reports missing project-map targets separately from pricing errors', async () => {
    const transcriptsDir = await mkdtemp(join(tmpdir(), 'claude-transcripts-'));
    const storeDir = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const projectMap: LedgerProjectMap = {
      version: 'map-v1',
      workspaceRoot: join(transcriptsDir, 'workspace'),
      targets: [],
    };
    await writeOldTranscript(transcriptsDir, 'unmapped.jsonl', [
      JSON.stringify(
        assistantLine({
          cwd: '/var/private-work',
          message: {
            ...assistantMessageForRepo('/var/private-work'),
            content: [],
          },
        }),
      ),
    ]);

    const summary = await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });
    const exceptions = await readFile(join(storeDir, 'exceptions.jsonl'), 'utf8');

    expect(summary).toMatchObject({ scanned: 1, rowsWritten: 0, exceptionsWritten: 1 });
    await expect(readDurableRows(storeDir)).resolves.toEqual([]);
    expect(exceptions).toContain('project-map-error');
    expect(exceptions).not.toContain('/var/private-work');
  });

  it('allocates workspace project docs through generated direct targets', async () => {
    const transcriptsDir = await mkdtemp(join(tmpdir(), 'claude-transcripts-'));
    const storeDir = await mkdtemp(join(tmpdir(), 'ledger-store-'));
    const workspaceRoot = join(transcriptsDir, 'workspace');
    const projectMap = buildLedgerProjectMap({
      workspaceRoot,
      repoRoots: [],
      workspaceProjectNames: ['agent-observatory'],
    });
    const projectDoc = join(workspaceRoot, 'projects', 'agent-observatory.md');
    await writeOldTranscript(transcriptsDir, 'workspace-doc.jsonl', [
      JSON.stringify(
        assistantLine({
          cwd: workspaceRoot,
          message: {
            ...assistantMessageForRepo(workspaceRoot),
            content: [{ type: 'tool_use', name: 'Edit', input: { file_path: projectDoc } }],
          },
        }),
      ),
    ]);

    const summary = await backfillOnce({ transcriptsDir, storeDir, projectMap, rateCard: card, graceMs: 0 });
    const rows = await readDurableRows(storeDir);

    expect(summary).toMatchObject({ scanned: 1, rowsWritten: 1, exceptionsWritten: 0 });
    expect(rows[0]?.allocations).toEqual([
      expect.objectContaining({
        project_key: opaqueProjectKeyFromName('agent-observatory'),
        target_kind: 'direct',
      }),
    ]);
  });
});
