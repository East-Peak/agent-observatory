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
  it('maps every "/" and "." to "-" and preserves literal hyphens (the irreversible Claude scheme)', () => {
    // Verified against the real ~/.claude/projects dir names on this machine.
    expect(encodeClaudeDir('/Users/dev/projects/yard-ops')).toBe('-Users-dev-projects-yard-ops');
    expect(encodeClaudeDir('/Users/dev/.openclaw/workspace')).toBe('-Users-dev--openclaw-workspace');
    expect(encodeClaudeDir('/Users/dev/projects/family-tree-toolkit')).toBe('-Users-dev-projects-family-tree-toolkit');
  });
});

describe('resolveProject — frozen attribution contract', () => {
  const cases = (attribution as { cases: AttributionCase[] }).cases;

  it('covers the required case shapes', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
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
