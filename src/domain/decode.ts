import type { Source, UsageRecord } from './types';
import { UNATTRIBUTED, CODEX_PROJECT, OPENCLAW_PROJECT } from './projects';

/** Thrown at the ccusage wire boundary when an envelope is missing/shaped wrong. */
export class CcusageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CcusageDecodeError';
  }
}

// ---- wire-boundary validators (fail closed; never let drift become a silent NaN) ----

function asObject(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null) {
    throw new CcusageDecodeError(`${where}: expected an object (got ${v === null ? 'null' : typeof v})`);
  }
  return v as Record<string, unknown>;
}

function asNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new CcusageDecodeError(`${where}: field "${key}" must be a finite number (got ${typeof v})`);
  }
  return v;
}

function asString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new CcusageDecodeError(`${where}: field "${key}" must be a string (got ${typeof v})`);
  }
  return v;
}

function asArray(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new CcusageDecodeError(`${where}: expected an array (got ${typeof v})`);
  }
  return v;
}

/** Validate the common `{ daily: [...] }` envelope shell and return its days as objects. */
function dailyDays(env: unknown, source: Source): Record<string, unknown>[] {
  const shell = asObject(env, `${source} envelope`);
  const daily = asArray(shell['daily'], `${source} envelope.daily`);
  return daily.map((d, i) => asObject(d, `${source} daily[${i}]`));
}

const OPENCLAW_PREFIX = '[openclaw] ';

/** Decode a `ccusage claude daily --json` envelope into canonical records. */
export function decodeClaudeDaily(env: unknown): UsageRecord[] {
  return dailyDays(env, 'claude').flatMap((day, i) => {
    const date = asString(day, 'date', `claude daily[${i}]`);
    const breakdowns = asArray(day['modelBreakdowns'], `claude ${date}.modelBreakdowns`);
    return breakdowns.map((mbU, j) => {
      const where = `claude ${date} model[${j}]`;
      const mb = asObject(mbU, where);
      return {
        source: 'claude' as const,
        date,
        // Daily claude has no project signal (used only for the instances↔daily reconciliation,
        // which sums tokens and ignores project); real claude attribution comes from --instances.
        project: UNATTRIBUTED,
        model: asString(mb, 'modelName', where),
        inputTokens: asNumber(mb, 'inputTokens', where),
        outputTokens: asNumber(mb, 'outputTokens', where),
        cacheCreationTokens: asNumber(mb, 'cacheCreationTokens', where),
        cacheReadTokens: asNumber(mb, 'cacheReadTokens', where),
        reasoningTokens: 0,
      };
    });
  });
}

/** Decode a `ccusage codex daily --json` envelope into canonical records. */
export function decodeCodexDaily(env: unknown): UsageRecord[] {
  return dailyDays(env, 'codex').flatMap((day, i) => {
    const date = asString(day, 'date', `codex daily[${i}]`);
    const models = asObject(day['models'], `codex ${date}.models`);
    return Object.entries(models).map(([model, mU]) => {
      const where = `codex ${date} ${model}`;
      const m = asObject(mU, where);
      return {
        source: 'codex' as const,
        date,
        project: CODEX_PROJECT,
        model,
        inputTokens: asNumber(m, 'inputTokens', where),
        outputTokens: asNumber(m, 'outputTokens', where),
        cacheCreationTokens: asNumber(m, 'cacheCreationTokens', where),
        cacheReadTokens: asNumber(m, 'cacheReadTokens', where),
        reasoningTokens: asNumber(m, 'reasoningOutputTokens', where),
      };
    });
  });
}

/**
 * Decode a `ccusage openclaw daily --json` envelope. OpenClaw's daily output has
 * no per-model token split, so each day yields ONE record: model = the single
 * `modelsUsed` entry (with the redundant `[openclaw] ` prefix stripped), or `(all)`
 * when the day spans multiple models.
 */
export function decodeOpenclawDaily(env: unknown): UsageRecord[] {
  return dailyDays(env, 'openclaw').map((day, i) => {
    const where = `openclaw daily[${i}]`;
    const date = asString(day, 'date', where);
    const modelsUsed = asArray(day['modelsUsed'], `openclaw ${date}.modelsUsed`);
    const single = modelsUsed.length === 1 ? modelsUsed[0] : undefined;
    const model = typeof single === 'string' ? single.replace(OPENCLAW_PREFIX, '') : '(all)';
    return {
      source: 'openclaw' as const,
      date,
      project: OPENCLAW_PROJECT,
      model,
      inputTokens: asNumber(day, 'inputTokens', `openclaw ${date}`),
      outputTokens: asNumber(day, 'outputTokens', `openclaw ${date}`),
      cacheCreationTokens: asNumber(day, 'cacheCreationTokens', `openclaw ${date}`),
      cacheReadTokens: asNumber(day, 'cacheReadTokens', `openclaw ${date}`),
      reasoningTokens: 0,
    };
  });
}
