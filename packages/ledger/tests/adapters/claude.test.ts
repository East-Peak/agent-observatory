import { describe, it, expect } from 'vitest';
import { agentTurnsFromClaudeLines } from '../../src/adapters/claude.js';

describe('agentTurnsFromClaudeLines — raw Claude transcript → stable AgentTurns', () => {
  it('emits one turn per assistant message with usage, mapping the four token classes', () => {
    const lines = [
      { type: 'user', message: { role: 'user', content: 'hi' } }, // no usage → not a turn
      {
        sessionId: 'S',
        cwd: '/p/repo',
        timestamp: '2026-07-02T23:30:00-07:00',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 2,
          },
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    ];
    const turns = agentTurnsFromClaudeLines(lines);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      sessionId: 'S',
      index: 0,
      source: 'claude',
      date: '2026-07-03',
      model: 'claude-opus-4-8',
      cwd: '/p/repo',
      usage: { input: 10, output: 5, cacheRead: 100, cacheCreation: 2, reasoning: 0 },
      files: [],
    });
  });

  it('extracts file evidence from tool_use blocks with the right kind (mutate vs read)', () => {
    const lines = [
      {
        sessionId: 'S',
        cwd: '/p',
        timestamp: '2026-07-03T12:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          usage: { output_tokens: 1 },
          content: [
            { type: 'tool_use', name: 'Edit', input: { file_path: '/p/a.ts' } },
            { type: 'tool_use', name: 'Read', input: { file_path: '/p/b.ts' } },
            { type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: '/p/c.ipynb' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }, // no path → skipped
          ],
        },
      },
    ];
    const [turn] = agentTurnsFromClaudeLines(lines);
    expect(turn?.files).toEqual([
      { path: '/p/a.ts', kind: 'mutate' },
      { path: '/p/b.ts', kind: 'read' },
      { path: '/p/c.ipynb', kind: 'mutate' },
    ]);
  });

  it('extracts Bash commands as separate command evidence', () => {
    const [turn] = agentTurnsFromClaudeLines([
      {
        sessionId: 'S',
        cwd: '/p',
        timestamp: '2026-07-03T12:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          usage: { output_tokens: 1 },
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'git -C /p/a status' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'npm --prefix packages/ledger test' } },
            { type: 'tool_use', name: 'Bash', input: { command: 123 } },
          ],
        },
      },
    ]);

    expect(turn?.commands).toEqual(['git -C /p/a status', 'npm --prefix packages/ledger test']);
  });

  it('skips lines without usage and tolerates malformed lines (external schema)', () => {
    const lines = [null, 'garbage', {}, { message: {} }, { message: { usage: null } }];
    expect(agentTurnsFromClaudeLines(lines)).toEqual([]);
  });

  it('skips synthetic zero-token placeholder rows as non-billable transcript metadata', () => {
    expect(
      agentTurnsFromClaudeLines([
        {
          sessionId: 'S',
          cwd: '/p',
          timestamp: '2026-07-03T12:00:00.000Z',
          message: {
            role: 'assistant',
            model: '<synthetic>',
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        },
      ]),
    ).toEqual([]);
  });

  it('defaults missing token classes to 0, missing cwd to null, missing sessionId to empty', () => {
    const [turn] = agentTurnsFromClaudeLines([
      {
        timestamp: '2026-07-03T12:00:00.000Z',
        message: { model: 'claude-opus-4-8', usage: { output_tokens: 7 } },
      },
    ]);
    expect(turn).toMatchObject({
      sessionId: '',
      source: 'claude',
      date: '2026-07-03',
      model: 'claude-opus-4-8',
      cwd: null,
      usage: { input: 0, output: 7, cacheRead: 0, cacheCreation: 0, reasoning: 0 },
      commands: [],
    });
  });

  it('skips billable rows missing model or a parseable timestamp (fail closed, no silent defaults)', () => {
    expect(
      agentTurnsFromClaudeLines([
        { timestamp: '2026-07-03T12:00:00.000Z', message: { usage: { output_tokens: 1 } } },
        { message: { model: 'claude-opus-4-8', usage: { output_tokens: 1 } } },
        {
          timestamp: 'not-a-date',
          message: { model: 'claude-opus-4-8', usage: { output_tokens: 1 } },
        },
      ]),
    ).toEqual([]);
  });
});
