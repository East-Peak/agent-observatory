import { homedir } from 'node:os';
import { posix as path } from 'node:path';
import type { AgentTurn, ProjectMap, TurnAllocation } from './types.js';
import { resolveTarget } from './target.js';

const TARGET_PATH_PRECEDERS = new Set(['cd', '-C', '--prefix', '--cwd']);

/**
 * Classify one turn to an allocation target by the deterministic evidence hierarchy:
 *   file mutation / explicit Bash target (strong) → file read (contextual) → per-turn cwd (contextual)
 *   → none (unattributed).
 * Strong evidence overrides the cwd, which is what makes "cd-ed in repo A but editing repo B" attribute to B.
 * The per-turn cwd — present on ~100% of transcript turns — is the dense fallback that keeps reasoning /
 * bare-command turns from collapsing into an unattributed bucket.
 */
export function classifyTurn(turn: AgentTurn, map: ProjectMap): TurnAllocation {
  return (
    classifyTurnAllocations(turn, map)[0] ?? {
      target: { kind: 'unattributed', key: 'unattributed' },
      evidence: 'none',
      confidence: 'none',
      weight: 1,
    }
  );
}

export function classifyTurnAllocations(turn: AgentTurn, map: ProjectMap): TurnAllocation[] {
  const strong: TurnAllocation[] = [];

  for (const file of turn.files.filter((f) => f.kind === 'mutate')) {
    strong.push({
      target: resolveTarget(file.path, map),
      evidence: 'file-mutate',
      confidence: 'strong',
      weight: 1,
    });
  }

  for (const command of turn.commands) {
    for (const commandPath of pathsFromBashCommand(command, turn.cwd)) {
      const target = resolveTarget(commandPath, map);
      if (target.kind === 'overhead' || target.kind === 'direct') continue;
      strong.push({ target, evidence: 'bash-target', confidence: 'strong', weight: 1 });
    }
  }

  if (strong.length > 0) return strong;

  const reads = turn.files
    .filter((f) => f.kind === 'read')
    .map<TurnAllocation>((f) => ({
      target: resolveTarget(f.path, map),
      evidence: 'file-read',
      confidence: 'contextual',
      weight: 1,
    }));
  if (reads.length > 0) return reads;

  if (turn.cwd) {
    return [{ target: resolveTarget(turn.cwd, map), evidence: 'cwd', confidence: 'contextual', weight: 1 }];
  }

  return [
    {
      target: { kind: 'unattributed', key: 'unattributed' },
      evidence: 'none',
      confidence: 'none',
      weight: 1,
    },
  ];
}

function pathsFromBashCommand(command: string, cwd: string | null): string[] {
  const tokens = shellWords(command);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const previous = i > 0 ? tokens[i - 1] : undefined;
    const forcePath = previous ? TARGET_PATH_PRECEDERS.has(previous) : false;
    const parsed = pathFromToken(token, cwd, forcePath);
    if (parsed) paths.push(parsed);
  }
  return [...new Set(paths)];
}

function pathFromToken(token: string, cwd: string | null, forcePath: boolean): string | null {
  const cleaned = token.replace(/^[([{]+/, '').replace(/[),.;]+$/, '');
  if (!cleaned || cleaned.startsWith('-') || /[<>]/.test(cleaned) || /^[a-z][a-z+.-]*:\/\//i.test(cleaned)) {
    return null;
  }
  if (cleaned === '~') return homedir();
  if (cleaned.startsWith('~/')) return path.resolve(homedir(), cleaned.slice(2));
  if (cleaned.startsWith('/')) return path.normalize(cleaned);
  if (!cwd) return null;
  if (forcePath || cleaned.startsWith('./') || cleaned.startsWith('../') || cleaned.includes('/')) {
    return path.normalize(path.resolve(cwd, cleaned));
  }
  return null;
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  const push = () => {
    if (current) words.push(current);
    current = '';
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (!char) continue;

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && i + 1 < command.length) {
        i++;
        current += command[i] ?? '';
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      push();
    } else {
      current += char;
    }
  }

  push();
  return words;
}
