// Explicit .ts extension on the VALUE import: the ingest resolves projects during a Node-native
// (type-stripping) run, which needs the extension on a runtime relative import (see decode.ts).
import { UNATTRIBUTED, RESERVED_PROJECTS, metaForKey } from './projects.ts';
import type { ProjectMeta } from './types';

/** A resolved project: its registry meta ({@link ProjectMeta}) plus the stable key it resolved to. */
export interface ResolvedProject extends ProjectMeta {
  readonly key: string;
}

/** Strip trailing path separators so a root with or without a trailing slash is treated identically. */
function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, '');
}

/**
 * Encode an absolute path to the Claude `~/.claude/projects/<encoded-cwd>` directory form. Matches
 * Claude Code's sanitizer (binary v2.1.195): every character outside `[A-Za-z0-9_-]` becomes `-`,
 * while alphanumerics, underscore, and hyphen are kept — so `/`, `.`, spaces, `@`, etc. all collapse
 * to `-`. A trailing separator is stripped first so `/a/b` and `/a/b/` encode identically.
 *
 * Intentionally LOSSY — `/a/b`, `/a.b`, and `/a-b` all become `-a-b` — which is precisely why
 * attribution must be a forward match (encode the known roots and compare) rather than a reverse
 * decode of the dir name. Deeper path canonicalization (realpath, Unicode NFC, Claude's >200-char
 * hash-truncation) is the ingest's job before it hands roots here; the resolver stays pure.
 */
export function encodeClaudeDir(absPath: string): string {
  return stripTrailingSlash(absPath).replace(/[^A-Za-z0-9_-]/g, '-');
}

/** The fail-closed result: work that resolves to no known repo is the `__unattributed__` sentinel. */
function unattributed(): ResolvedProject {
  return { key: UNATTRIBUTED, ...metaForKey(UNATTRIBUTED) };
}

/**
 * Resolve a Claude instance directory name (the ccusage `--instances` project field, already in
 * encoded form) to a stable project identity, by **segment-boundary longest-prefix forward match**.
 *
 * Each known git-toplevel root — and each alias path (a worktree / renamed dir) standing in for its
 * canonical root — is encoded the same way. The instance dir matches a candidate iff it equals the
 * candidate's encoded form OR continues it at a `-` boundary (every `/` became `-`, so `-` is the
 * only segment boundary we can see). The **longest** match wins, so a nested cwd attributes to its
 * enclosing repo. Resolution outcomes:
 *  - **0 matches → `__unattributed__`** (fail closed — never guess).
 *  - **A unique longest match → that repo.**
 *  - **Two DISTINCT roots tie at the longest length** (their lossy encodings collide, e.g. `/a-b`
 *    vs `/a.b`) → `__unattributed__`: we genuinely cannot tell which, so we refuse to guess.
 *
 * ACCEPTED LIMITATION (inherent to the lossy encoding, per the converged spec): an instance dir like
 * `-…-yard-ops-extra` is indistinguishable from a nested dir `…/yard-ops/extra`, so if a sibling repo
 * `yard-ops-extra` is NOT among `knownRoots` it attributes to the enclosing `yard-ops`. This is correct
 * when it really is a nested cwd and "confidently wrong" only when it is an undiscovered sibling repo —
 * which the design mitigates by passing the COMPLETE set of discovered git roots and surfacing the
 * Unattributed share as a report-only ingest signal (it never gates certification). Aliases must
 * resolve to a known, non-sentinel root; a stray alias is ignored (fail closed) rather than minting a
 * phantom key.
 *
 * PURE: the candidate root set is supplied by the caller (discovering the live roots is a separate,
 * impure ingest step), so the whole attribution contract is testable without the filesystem.
 */
export function resolveProject(
  encodedDir: string,
  opts: { readonly knownRoots: readonly string[]; readonly aliases?: Readonly<Record<string, string>> },
): ResolvedProject {
  const knownRoots = opts.knownRoots.map(stripTrailingSlash).filter((r) => r.length > 0);
  const rootSet = new Set(knownRoots);

  // An alias maps a worktree/renamed path to a canonical root. The target MUST be a known, non-sentinel
  // root — otherwise it is a config error (a typo could mint a phantom key or hit a tool sentinel), so
  // we drop it and let the dir fall through to a normal match / Unattributed.
  const aliasCandidates = Object.entries(opts.aliases ?? {})
    .map(([aliasPath, target]) => ({ aliasPath: stripTrailingSlash(aliasPath), target: stripTrailingSlash(target) }))
    .filter((a) => a.aliasPath.length > 0 && rootSet.has(a.target) && !(a.target in RESERVED_PROJECTS))
    .map((a) => ({ encoded: encodeClaudeDir(a.aliasPath), key: a.target }));

  const candidates: ReadonlyArray<{ readonly encoded: string; readonly key: string }> = [
    ...knownRoots.map((root) => ({ encoded: encodeClaudeDir(root), key: root })),
    ...aliasCandidates,
  ];

  const matches = candidates.filter(
    (c) => encodedDir === c.encoded || encodedDir.startsWith(`${c.encoded}-`),
  );
  if (matches.length === 0) return unattributed();

  const maxLen = Math.max(...matches.map((m) => m.encoded.length));
  const longest = matches.filter((m) => m.encoded.length === maxLen);
  const distinctKeys = new Set(longest.map((m) => m.key));
  if (distinctKeys.size > 1) return unattributed(); // colliding distinct roots — refuse to guess

  const key = longest[0]!.key;
  return { key, ...metaForKey(key) };
}
