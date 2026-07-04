import type { AgentTurn, FileEvidence, FileKind, TokenUsage } from '../domain/types.js';

/**
 * The ClaudeTranscriptAdapter: raw Claude Code transcript lines → stable `AgentTurn`s. This is the ONLY
 * place that knows Claude's line shape (`message.usage`, `tool_use` inputs, the token-class field names);
 * the classifier downstream sees only `AgentTurn`, so a Claude schema change is contained here. Consumes
 * untrusted external JSON, so every field is guarded and malformed lines are skipped, not thrown on.
 *
 * A "turn" is one assistant message carrying token `usage` — the billable unit. Its file evidence comes
 * from the `tool_use` blocks in that same message (usage and the files it touched are co-located).
 */

const MUTATE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read']);

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function num(x: unknown): number {
  return typeof x === 'number' ? x : 0;
}

function toUsage(u: Record<string, unknown>): TokenUsage {
  return {
    input: num(u['input_tokens']),
    output: num(u['output_tokens']),
    cacheRead: num(u['cache_read_input_tokens']),
    cacheCreation: num(u['cache_creation_input_tokens']),
    reasoning: 0,
  };
}

function hasBillableTokens(usage: TokenUsage): boolean {
  return usage.input + usage.output + usage.cacheRead + usage.cacheCreation + usage.reasoning > 0;
}

function utcDateOf(timestamp: unknown): string | null {
  if (typeof timestamp !== 'string') return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function fileFromToolUse(block: Record<string, unknown>): FileEvidence | null {
  const name = typeof block['name'] === 'string' ? block['name'] : '';
  const kind: FileKind | null = MUTATE_TOOLS.has(name) ? 'mutate' : READ_TOOLS.has(name) ? 'read' : null;
  if (!kind) return null;
  const input = block['input'];
  const path = isObject(input) ? (input['file_path'] ?? input['notebook_path']) : undefined;
  return typeof path === 'string' ? { path, kind } : null;
}

function filesOf(message: Record<string, unknown>): FileEvidence[] {
  const content = message['content'];
  if (!Array.isArray(content)) return [];
  const files: FileEvidence[] = [];
  for (const block of content) {
    if (isObject(block) && block['type'] === 'tool_use') {
      const file = fileFromToolUse(block);
      if (file) files.push(file);
    }
  }
  return files;
}

function commandsOf(message: Record<string, unknown>): string[] {
  const content = message['content'];
  if (!Array.isArray(content)) return [];
  const commands: string[] = [];
  for (const block of content) {
    if (!isObject(block) || block['type'] !== 'tool_use' || block['name'] !== 'Bash') continue;
    const input = block['input'];
    const command = isObject(input) ? input['command'] : undefined;
    if (typeof command === 'string') commands.push(command);
  }
  return commands;
}

export function agentTurnsFromClaudeLines(lines: readonly unknown[]): AgentTurn[] {
  const turns: AgentTurn[] = [];
  for (const raw of lines) {
    if (!isObject(raw)) continue;
    const message = raw['message'];
    if (!isObject(message) || !isObject(message['usage'])) continue;
    const date = utcDateOf(raw['timestamp']);
    const model = typeof message['model'] === 'string' ? message['model'] : '';
    if (!date || !model) continue;
    const usage = toUsage(message['usage']);
    if (!hasBillableTokens(usage)) continue;

    turns.push({
      sessionId: typeof raw['sessionId'] === 'string' ? raw['sessionId'] : '',
      index: turns.length,
      source: 'claude',
      date,
      model,
      cwd: typeof raw['cwd'] === 'string' ? raw['cwd'] : null,
      usage,
      files: filesOf(message),
      commands: commandsOf(message),
    });
  }
  return turns;
}
