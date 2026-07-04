import { mkdir, mkdtemp, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanClaudeTranscriptFiles } from '../../src/io/scan.js';

async function touchOld(path: string): Promise<void> {
  const old = new Date('2026-07-03T00:00:00.000Z');
  await utimes(path, old, old);
}

describe('Claude transcript scanner', () => {
  it('scans only ~/.claude/projects/*/*.jsonl style files, sorted and non-recursive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-projects-'));
    await mkdir(join(root, 'projects', 'b'), { recursive: true });
    await mkdir(join(root, 'projects', 'a', 'nested'), { recursive: true });
    await writeFile(join(root, 'projects', 'b', '2.jsonl'), '{}\n');
    await writeFile(join(root, 'projects', 'a', '1.jsonl'), '{}\n');
    await writeFile(join(root, 'projects', 'a', 'nested', 'ignored.jsonl'), '{}\n');
    await writeFile(join(root, 'projects', 'a', 'ignored.txt'), '{}\n');
    await Promise.all([
      touchOld(join(root, 'projects', 'b', '2.jsonl')),
      touchOld(join(root, 'projects', 'a', '1.jsonl')),
      touchOld(join(root, 'projects', 'a', 'nested', 'ignored.jsonl')),
      touchOld(join(root, 'projects', 'a', 'ignored.txt')),
    ]);

    await symlink(join(root, 'projects', 'a', '1.jsonl'), join(root, 'projects', 'b', 'link.jsonl'));

    await expect(scanClaudeTranscriptFiles({ transcriptsDir: root, graceMs: 0 })).resolves.toEqual([
      join(root, 'projects', 'a', '1.jsonl'),
      join(root, 'projects', 'b', '2.jsonl'),
    ]);
  });

  it('skips files modified inside the grace window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-projects-'));
    await mkdir(join(root, 'projects', 'a'), { recursive: true });
    await writeFile(join(root, 'projects', 'a', 'fresh.jsonl'), '{}\n');

    await expect(scanClaudeTranscriptFiles({ transcriptsDir: root, graceMs: 60_000 })).resolves.toEqual([]);
  });
});
