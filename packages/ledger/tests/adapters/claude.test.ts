import { describe, it, expect } from 'vitest';
import { agentTurnsFromClaudeLines } from '../../src/adapters/claude.js';

describe('agentTurnsFromClaudeLines — raw Claude transcript → stable AgentTurns', () => {
  it('emits one turn per assistant message with usage, mapping the four token classes', () => {
    const lines = [
      { type: 'user', message: { role: 'user', content: 'hi' } }, // no usage → not a turn
      {
        sessionId: 'S',
        cwd: '/p/repo',
        message: {
          role: 'assistant',
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
      cwd: '/p/repo',
      usage: { input: 10, output: 5, cacheRead: 100, cacheCreation: 2 },
      files: [],
    });
  });

  it('extracts file evidence from tool_use blocks with the right kind (mutate vs read)', () => {
    const lines = [
      {
        sessionId: 'S',
        cwd: '/p',
        message: {
          role: 'assistant',
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

  it('skips lines without usage and tolerates malformed lines (external schema)', () => {
    const lines = [null, 'garbage', {}, { message: {} }, { message: { usage: null } }];
    expect(agentTurnsFromClaudeLines(lines)).toEqual([]);
  });

  it('defaults missing token classes to 0, missing cwd to null, missing sessionId to empty', () => {
    const [turn] = agentTurnsFromClaudeLines([{ message: { usage: { output_tokens: 7 } } }]);
    expect(turn).toMatchObject({
      sessionId: '',
      cwd: null,
      usage: { input: 0, output: 7, cacheRead: 0, cacheCreation: 0 },
    });
  });
});
