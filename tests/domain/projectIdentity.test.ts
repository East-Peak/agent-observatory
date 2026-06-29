import { describe, it, expect } from 'vitest';
import { resolveProject, encodeClaudeDir } from '@/domain/projectIdentity';
import attribution from '../../data/fixtures/project-attribution.json';

interface AttributionCase {
  readonly name: string;
  readonly encodedDir: string;
  readonly knownRoots: string[];
  readonly aliases: Record<string, string>;
  readonly expected: { readonly kind: string; readonly key: string; readonly label: string };
}

describe('encodeClaudeDir', () => {
  it('sanitizes every char outside [A-Za-z0-9_-] to "-", preserving underscore and hyphen', () => {
    // Matches Claude Code's installed cwd sanitizer (binary v2.1.195): [^A-Za-z0-9_-] -> "-".
    expect(encodeClaudeDir('/Users/dev/projects/yard-ops')).toBe('-Users-dev-projects-yard-ops');
    expect(encodeClaudeDir('/Users/dev/.openclaw/workspace')).toBe('-Users-dev--openclaw-workspace'); // "." -> "-"
    expect(encodeClaudeDir('/Users/dev/My Projects/app')).toBe('-Users-dev-My-Projects-app'); // space -> "-"
    expect(encodeClaudeDir('/Users/dev/projects/data_pipeline')).toBe('-Users-dev-projects-data_pipeline'); // "_" kept
    expect(encodeClaudeDir('/Users/dev/projects/scope@v2')).toBe('-Users-dev-projects-scope-v2'); // "@" -> "-"
    expect(encodeClaudeDir('/Users/dev/projects/family-tree-toolkit')).toBe('-Users-dev-projects-family-tree-toolkit');
  });

  it('strips a trailing slash so /a/b and /a/b/ encode identically', () => {
    expect(encodeClaudeDir('/Users/dev/projects/yard-ops/')).toBe(encodeClaudeDir('/Users/dev/projects/yard-ops'));
  });
});

describe('resolveProject — frozen attribution contract', () => {
  const cases = (attribution as { cases: AttributionCase[] }).cases;

  it('pins the load-bearing case shapes (the contract cannot be gutted to happy-path-only)', () => {
    const names = cases.map((c) => c.name).join(' | ');
    for (const required of [
      'exact root',
      'nested cwd under a repo',
      'a run IN yard-ops-extra resolves to yard-ops-extra',
      'alias hit',
      'unresolvable',
      'underscore in the repo name is PRESERVED',
      'two distinct roots encode identically',
      'undiscovered sibling',
      'trailing slash',
      'alias whose target is a reserved sentinel is ignored',
    ]) {
      expect(names, `missing contract case: ${required}`).toContain(required);
    }
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length); // no duplicate case names
  });

  it.each(cases.map((c) => [c.name, c] as const))('resolves: %s', (_name, c) => {
    expect(resolveProject(c.encodedDir, { knownRoots: c.knownRoots, aliases: c.aliases })).toEqual(c.expected);
  });
});

describe('resolveProject — direct edge cases', () => {
  it('with no known roots, any cwd is unattributed (fail closed)', () => {
    expect(resolveProject('-Users-dev-projects-foo', { knownRoots: [] })).toEqual({
      kind: 'unattributed',
      key: '__unattributed__',
      label: 'Unattributed',
    });
  });

  it('aliases is optional', () => {
    expect(resolveProject('-Users-dev-projects-foo', { knownRoots: ['/Users/dev/projects/foo'] })).toEqual({
      kind: 'repo',
      key: '/Users/dev/projects/foo',
      label: 'foo',
    });
  });

  it('does not match a root that is only a NON-segment-boundary character prefix', () => {
    // root encodes to "-Users-dev-projects-yard"; the cwd "-Users-dev-projects-yardley" shares the
    // characters but not at a "-" boundary, so it must NOT attribute to yard.
    expect(
      resolveProject('-Users-dev-projects-yardley', { knownRoots: ['/Users/dev/projects/yard'] }),
    ).toEqual({ kind: 'unattributed', key: '__unattributed__', label: 'Unattributed' });
  });
});
