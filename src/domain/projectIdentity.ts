// Explicit .ts extension on the VALUE import: the ingest resolves projects during a Node-native
// (type-stripping) run, which needs the extension on a runtime relative import (see decode.ts).
import { UNATTRIBUTED, metaForKey } from './projects.ts';
import type { ProjectMeta } from './types';

/** A resolved project: its registry meta ({@link ProjectMeta}) plus the stable key it resolved to. */
export interface ResolvedProject extends ProjectMeta {
  readonly key: string;
}

/**
 * Encode an absolute path to the Claude `~/.claude/projects/<encoded-cwd>` directory form: every `/`
 * and `.` becomes `-`, and literal hyphens are preserved. Verified against the real scheme on disk
 * (`/Users/x/.openclaw/workspace` → `-Users-x--openclaw-workspace`). This is intentionally LOSSY —
 * `/a/b` and `/a.b` and `/a-b` all collapse to `-a-b` — which is precisely why attribution must be a
 * forward match (encode the known roots and compare) rather than a reverse decode of the dir name.
 */
export function encodeClaudeDir(absPath: string): string {
  return absPath.replace(/[./]/g, '-');
}

/**
 * Resolve a Claude instance directory name (the ccusage `--instances` project field, already in
 * encoded form) to a stable project identity, by **segment-boundary longest-prefix forward match**.
 *
 * Each known git-toplevel root — and each alias path (a worktree / renamed dir) standing in for its
 * canonical root — is encoded the same way. The instance dir matches a candidate iff it equals the
 * candidate's encoded form OR continues it at a `-` boundary (every `/` became `-`, so `-` is the
 * only segment boundary we can see). The **longest** matching candidate wins, so a nested cwd
 * attributes to its enclosing repo and a sibling like `yard-ops-extra` is never swallowed by
 * `yard-ops`. **Zero matches → the `__unattributed__` sentinel (fail closed)** — we never guess.
 *
 * PURE: the candidate root set is supplied by the caller (discovering the live roots is a separate,
 * impure ingest step), so the whole attribution contract is testable without the filesystem.
 */
export function resolveProject(
  encodedDir: string,
  opts: { readonly knownRoots: readonly string[]; readonly aliases?: Readonly<Record<string, string>> },
): ResolvedProject {
  const aliases = opts.aliases ?? {};
  // A candidate is an (encoded form → key) pair: a root maps to itself; an alias path maps to the
  // canonical root it stands for (so a worktree run lands on the real repo's key + label).
  const candidates: ReadonlyArray<{ readonly encoded: string; readonly key: string }> = [
    ...opts.knownRoots.map((root) => ({ encoded: encodeClaudeDir(root), key: root })),
    ...Object.entries(aliases).map(([aliasPath, canonicalRoot]) => ({
      encoded: encodeClaudeDir(aliasPath),
      key: canonicalRoot,
    })),
  ];

  let best: { readonly encoded: string; readonly key: string } | null = null;
  for (const c of candidates) {
    const matches = encodedDir === c.encoded || encodedDir.startsWith(`${c.encoded}-`);
    if (matches && (best === null || c.encoded.length > best.encoded.length)) best = c;
  }

  const key = best?.key ?? UNATTRIBUTED;
  return { key, ...metaForKey(key) };
}
