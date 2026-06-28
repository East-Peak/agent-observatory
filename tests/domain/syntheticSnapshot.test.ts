import { describe, it, expect } from 'vitest';
import { generateSnapshot } from '@/domain/syntheticSnapshot';

describe('generateSnapshot', () => {
  it('is deterministic — byte-identical across calls', () => {
    expect(JSON.stringify(generateSnapshot())).toBe(JSON.stringify(generateSnapshot()));
  });

  it('meets the data-richness thresholds', () => {
    const s = generateSnapshot();
    const sources = new Set(s.records.map((r) => r.source));
    const models = new Set(s.records.map((r) => r.model));
    const days = new Set(s.records.map((r) => r.date));

    expect(sources.size).toBeGreaterThanOrEqual(3);
    expect(models.size).toBeGreaterThanOrEqual(4);
    expect(days.size).toBeGreaterThanOrEqual(30);

    // every token type appears non-zero somewhere
    expect(s.records.some((r) => r.inputTokens > 0)).toBe(true);
    expect(s.records.some((r) => r.outputTokens > 0)).toBe(true);
    expect(s.records.some((r) => r.cacheCreationTokens > 0)).toBe(true);
    expect(s.records.some((r) => r.cacheReadTokens > 0)).toBe(true);

    // reasoning is Codex-only
    expect(s.records.some((r) => r.source === 'codex' && r.reasoningTokens > 0)).toBe(true);
    expect(s.records.every((r) => r.source === 'codex' || r.reasoningTokens === 0)).toBe(true);
  });

  it('anchors asOf, with every record dated on or before it', () => {
    const s = generateSnapshot();
    expect(s.asOf).toBe('2026-06-27');
    expect(s.records.every((r) => r.date <= s.asOf)).toBe(true);
  });
});
