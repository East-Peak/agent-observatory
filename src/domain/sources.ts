import type { Source } from './types';

/** The source-filter dimension: `all` (no filter) or one concrete {@link Source}. */
export type SourceKey = 'all' | Source;

export interface SourceOption {
  readonly key: SourceKey;
  readonly label: string;
}

/** House-style source options, in display order (the frozen smoke asserts these labels). */
export const SOURCE_OPTIONS: readonly SourceOption[] = [
  { key: 'all', label: 'All' },
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'openclaw', label: 'OpenClaw' },
];

/** The underlying {@link Source} a key selects, or `null` for the no-filter `all`. */
export function sourceOfKey(key: SourceKey): Source | null {
  return key === 'all' ? null : key;
}
