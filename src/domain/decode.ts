import type { Source, UsageRecord } from './types';
// Explicit .ts extension: this VALUE import must resolve under Node-native type-stripping too (the
// ingest runs decode.ts directly via Node, which — unlike the bundler — requires the extension on a
// runtime relative import; the type-only `./types` import above is erased so it needs none).
import { UNATTRIBUTED, CODEX_PROJECT, OPENCLAW_PROJECT } from './projects.ts';

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

/**
 * Decode a `ccusage claude daily --instances --json` envelope (`{ projects: { <encodedDir>: [day…] } }`)
 * into canonical records, attributing each to a project via the injected pure `resolveFn` (encoded
 * dir-name → project key). Multiple encoded dirs can resolve to the SAME key (a repo + its nested cwds
 * + a worktree alias), so records are MERGED by (project, date, model) — keeping records unique by
 * identity, which the snapshot uniqueness invariant + the activity-feed carrier key both rely on.
 * `resolveFn` is injected so the decoder stays pure; the live-filesystem root discovery lives in the
 * ingest. Per-model tokens are summed; ccusage's float `cost` is discarded (re-derived downstream).
 */
export function decodeClaudeInstances(
  env: unknown,
  resolveFn: (encodedDir: string) => string,
): UsageRecord[] {
  const shell = asObject(env, 'claude --instances envelope');
  const projects = asObject(shell['projects'], 'claude --instances envelope.projects');
  const acc = new Map<string, UsageRecord>();
  for (const [encodedDir, daysU] of Object.entries(projects)) {
    const project = resolveFn(encodedDir);
    const days = asArray(daysU, `claude --instances projects[${encodedDir}]`);
    days.forEach((dayU, i) => {
      const where = `claude --instances ${encodedDir}[${i}]`;
      const day = asObject(dayU, where);
      const date = asString(day, 'date', where);
      const breakdowns = asArray(day['modelBreakdowns'], `${where}.modelBreakdowns`);
      breakdowns.forEach((mbU, j) => {
        const w = `${where} model[${j}]`;
        const mb = asObject(mbU, w);
        const model = asString(mb, 'modelName', w);
        const input = asNumber(mb, 'inputTokens', w);
        const output = asNumber(mb, 'outputTokens', w);
        const cacheCreation = asNumber(mb, 'cacheCreationTokens', w);
        const cacheRead = asNumber(mb, 'cacheReadTokens', w);
        // NUL-joined so a project key / model containing the separator can't forge a collision.
        const acckey = `${project}\u0000${date}\u0000${model}`;
        const existing = acc.get(acckey);
        if (existing) {
          acc.set(acckey, {
            ...existing,
            inputTokens: existing.inputTokens + input,
            outputTokens: existing.outputTokens + output,
            cacheCreationTokens: existing.cacheCreationTokens + cacheCreation,
            cacheReadTokens: existing.cacheReadTokens + cacheRead,
          });
        } else {
          acc.set(acckey, {
            source: 'claude',
            date,
            project,
            model,
            inputTokens: input,
            outputTokens: output,
            cacheCreationTokens: cacheCreation,
            cacheReadTokens: cacheRead,
            reasoningTokens: 0,
          });
        }
      });
    });
  }
  return [...acc.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.project !== b.project) return a.project < b.project ? -1 : 1;
    return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
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
