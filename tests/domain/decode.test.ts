import { describe, it, expect } from 'vitest';
import {
  decodeClaudeDaily,
  decodeCodexDaily,
  decodeOpenclawDaily,
  CcusageDecodeError,
} from '@/domain/decode';

describe('decodeClaudeDaily', () => {
  it('maps each day×model breakdown to a canonical record, dropping ccusage cost', () => {
    const env = {
      daily: [
        {
          date: '2026-06-01',
          modelBreakdowns: [
            {
              modelName: 'claude-sonnet-4-6',
              inputTokens: 92,
              outputTokens: 2651,
              cacheCreationTokens: 597397,
              cacheReadTokens: 1189016,
              cost: 3.9811277999999986,
            },
            {
              modelName: 'claude-opus-4-8',
              inputTokens: 10,
              outputTokens: 500,
              cacheCreationTokens: 1000,
              cacheReadTokens: 2000,
              cost: 1.23,
            },
          ],
        },
        {
          date: '2026-06-02',
          modelBreakdowns: [
            {
              modelName: 'claude-sonnet-4-6',
              inputTokens: 5,
              outputTokens: 100,
              cacheCreationTokens: 50,
              cacheReadTokens: 80,
              cost: 0.1,
            },
          ],
        },
      ],
      totals: {},
    };

    expect(decodeClaudeDaily(env)).toEqual([
      {
        source: 'claude',
        date: '2026-06-01',
        model: 'claude-sonnet-4-6',
        inputTokens: 92,
        outputTokens: 2651,
        cacheCreationTokens: 597397,
        cacheReadTokens: 1189016,
        reasoningTokens: 0,
      },
      {
        source: 'claude',
        date: '2026-06-01',
        model: 'claude-opus-4-8',
        inputTokens: 10,
        outputTokens: 500,
        cacheCreationTokens: 1000,
        cacheReadTokens: 2000,
        reasoningTokens: 0,
      },
      {
        source: 'claude',
        date: '2026-06-02',
        model: 'claude-sonnet-4-6',
        inputTokens: 5,
        outputTokens: 100,
        cacheCreationTokens: 50,
        cacheReadTokens: 80,
        reasoningTokens: 0,
      },
    ]);
  });
});

describe('decodeCodexDaily', () => {
  it('maps each day×model from the models dict, carrying reasoningOutputTokens', () => {
    const env = {
      daily: [
        {
          date: '2026-06-01',
          models: {
            'gpt-5.3-codex': {
              inputTokens: 710161,
              outputTokens: 45339,
              cacheCreationTokens: 0,
              cacheReadTokens: 7465728,
              reasoningOutputTokens: 20730,
              totalTokens: 8221228,
              isFallback: false,
            },
            'gpt-5.4-codex': {
              inputTokens: 100,
              outputTokens: 50,
              cacheCreationTokens: 5,
              cacheReadTokens: 200,
              reasoningOutputTokens: 10,
              totalTokens: 365,
              isFallback: false,
            },
          },
        },
        {
          date: '2026-06-02',
          models: {
            'gpt-5.3-codex': {
              inputTokens: 1,
              outputTokens: 2,
              cacheCreationTokens: 3,
              cacheReadTokens: 4,
              reasoningOutputTokens: 5,
              totalTokens: 15,
              isFallback: false,
            },
          },
        },
      ],
      totals: {},
    };

    expect(decodeCodexDaily(env)).toEqual([
      {
        source: 'codex',
        date: '2026-06-01',
        model: 'gpt-5.3-codex',
        inputTokens: 710161,
        outputTokens: 45339,
        cacheCreationTokens: 0,
        cacheReadTokens: 7465728,
        reasoningTokens: 20730,
      },
      {
        source: 'codex',
        date: '2026-06-01',
        model: 'gpt-5.4-codex',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 5,
        cacheReadTokens: 200,
        reasoningTokens: 10,
      },
      {
        source: 'codex',
        date: '2026-06-02',
        model: 'gpt-5.3-codex',
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
        reasoningTokens: 5,
      },
    ]);
  });
});

describe('decodeOpenclawDaily', () => {
  it('emits one day-level record (no per-model split): strips [openclaw] when single, (all) when multiple', () => {
    const env = {
      daily: [
        {
          date: '2026-06-01',
          inputTokens: 2178,
          outputTokens: 73152,
          cacheCreationTokens: 9244019,
          cacheReadTokens: 12391714,
          totalTokens: 21711063,
          modelsUsed: ['[openclaw] claude-sonnet-4-6'],
          totalCost: 39.48639945,
        },
        {
          date: '2026-06-02',
          inputTokens: 10,
          outputTokens: 20,
          cacheCreationTokens: 30,
          cacheReadTokens: 40,
          totalTokens: 100,
          modelsUsed: ['[openclaw] claude-sonnet-4-6', '[openclaw] claude-opus-4-8'],
          totalCost: 1,
        },
      ],
      totals: {},
    };

    expect(decodeOpenclawDaily(env)).toEqual([
      {
        source: 'openclaw',
        date: '2026-06-01',
        model: 'claude-sonnet-4-6',
        inputTokens: 2178,
        outputTokens: 73152,
        cacheCreationTokens: 9244019,
        cacheReadTokens: 12391714,
        reasoningTokens: 0,
      },
      {
        source: 'openclaw',
        date: '2026-06-02',
        model: '(all)',
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 30,
        cacheReadTokens: 40,
        reasoningTokens: 0,
      },
    ]);
  });
});

describe('decode wire-boundary validation (fail closed on drift)', () => {
  it('throws CcusageDecodeError when the daily array is missing or wrong-typed', () => {
    expect(() => decodeClaudeDaily({})).toThrow(CcusageDecodeError);
    expect(() => decodeCodexDaily({ daily: 'nope' })).toThrow(CcusageDecodeError);
    expect(() => decodeOpenclawDaily(null)).toThrow(CcusageDecodeError);
  });

  it('throws CcusageDecodeError when a required token field is missing (not a silent NaN)', () => {
    const driftedClaude = {
      daily: [
        {
          date: '2026-06-01',
          modelBreakdowns: [
            // inputTokens renamed/dropped — drift
            { modelName: 'claude-sonnet-4-6', outputTokens: 1, cacheCreationTokens: 1, cacheReadTokens: 1 },
          ],
        },
      ],
    };
    expect(() => decodeClaudeDaily(driftedClaude)).toThrow(CcusageDecodeError);
  });
});
