import { describe, expect, it } from 'vitest';
import type { SessionLedgerRow, TokenUsage } from '../../src/domain/types.js';
import {
  encodeDurableRow,
  ledgerProjectMapToClassifierMap,
  type LedgerProjectMap,
} from '../../src/domain/durable.js';

const tokens = (output: number, overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 1,
  output,
  cacheRead: 2,
  cacheCreation: 3,
  reasoning: 4,
  ...overrides,
});

const projectMap: LedgerProjectMap = {
  version: 'map-v1',
  workspaceRoot: '/Users/tammypais/.openclaw/workspace',
  targets: [
    { kind: 'repo', key: '/Users/tammypais/projects/private-client', projectKey: 'proj_private_client' },
    { kind: 'overhead', key: 'other', projectKey: 'bucket_overhead' },
  ],
};

const row = (overrides: Partial<SessionLedgerRow> = {}): SessionLedgerRow => ({
  sessionId: 'raw-session-id',
  turns: 1,
  totalCostPico: 123n,
  totalTokens: tokens(7),
  allocations: [
    {
      target: { kind: 'repo', key: '/Users/tammypais/projects/private-client' },
      costPico: 123n,
      tokens: tokens(7),
      evidence: ['file-mutate', 'bash-target'],
    },
  ],
  ...overrides,
});

describe('durable ledger row encoding', () => {
  it('maps internal targets to opaque project keys and strips raw private identifiers', () => {
    const durable = encodeDurableRow(row(), {
      source: 'claude',
      date: '2026-07-03',
      model: 'claude-opus-4-8',
      transcriptHash: 'sha256:content',
      transcriptKey: 'sha256:path',
      projectMap,
      versions: {
        adapter: 'claude-v1',
        classifier: 'classifier-v1',
        allocator: 'allocator-v1',
        pricer: 'pricing-v1',
        rate_card: 'rate-card-v1',
      },
    });

    expect(durable).toMatchObject({
      schema_version: 'agent-ledger-row/v1',
      row_key: expect.stringMatching(/^claude:[a-f0-9]{64}:2026-07-03:claude-opus-4-8$/),
      source: 'claude',
      date: '2026-07-03',
      model: 'claude-opus-4-8',
      transcript_hash: 'sha256:content',
      transcript_key: 'sha256:path',
      total_cost_pico: '123',
      allocations: [
        {
          project_key: 'proj_private_client',
          target_kind: 'repo',
          cost_pico: '123',
          evidence: ['file-mutate', 'bash-target'],
        },
      ],
    });

    const json = JSON.stringify(durable);
    expect(json).not.toContain('/Users/tammypais');
    expect(json).not.toContain('private-client');
    expect(json).not.toContain('raw-session-id');
  });

  it('fails closed when a target is missing from the local project map', () => {
    expect(() =>
      encodeDurableRow(
        row({ allocations: [{ ...row().allocations[0]!, target: { kind: 'overhead', key: 'other' } }] }),
        {
          source: 'claude',
          date: '2026-07-03',
          model: 'claude-opus-4-8',
          transcriptHash: 'sha256:content',
          transcriptKey: 'sha256:path',
          projectMap: { ...projectMap, targets: projectMap.targets.filter((t) => t.kind !== 'overhead') },
          versions: {
            adapter: 'claude-v1',
            classifier: 'classifier-v1',
            allocator: 'allocator-v1',
            pricer: 'pricing-v1',
            rate_card: 'rate-card-v1',
          },
        },
      ),
    ).toThrow(/missing project-map target/);
  });

  it('derives the classifier map from local private target mappings only', () => {
    expect(ledgerProjectMapToClassifierMap(projectMap)).toEqual({
      workspaceRoot: '/Users/tammypais/.openclaw/workspace',
      projectRoots: ['/Users/tammypais/projects/private-client'],
    });
  });
});
