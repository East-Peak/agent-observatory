import { describe, it, expect } from 'vitest';
import { SOURCE_OPTIONS, sourceOfKey } from '@/domain/sources';

describe('sources — the source dimension + house-style filter options', () => {
  it('exposes the four house-style source options in order', () => {
    expect(SOURCE_OPTIONS.map((o) => o.label)).toEqual([
      'All',
      'Claude Code',
      'Codex',
      'OpenClaw',
    ]);
  });

  it('maps each option key to its underlying Source (or null for All)', () => {
    expect(sourceOfKey('all')).toBeNull();
    expect(sourceOfKey('claude')).toBe('claude');
    expect(sourceOfKey('codex')).toBe('codex');
    expect(sourceOfKey('openclaw')).toBe('openclaw');
  });
});
