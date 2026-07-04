import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  discoverGitRoots,
  discoverWorkspaceProjectNames,
  writeLedgerProjectMap,
} from '../../src/io/projectMap.js';
import { buildLedgerProjectMap } from '../../src/domain/projectMap.js';

describe('project-map IO', () => {
  it('discovers only direct git roots under configured search roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ledger-projects-'));
    await mkdir(join(root, '.git'));
    await mkdir(join(root, 'repo-a', '.git'), { recursive: true });
    await mkdir(join(root, 'repo-b', '.git'), { recursive: true });
    await mkdir(join(root, 'not-a-repo'));
    await symlink(join(root, 'repo-a'), join(root, 'repo-a-link'));

    await expect(discoverGitRoots([root])).resolves.toEqual([
      root,
      join(root, 'repo-a'),
      join(root, 'repo-b'),
    ]);
  });

  it('discovers workspace project doc names without leaking document contents', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'workspace-'));
    await mkdir(join(workspace, 'projects'), { recursive: true });
    await mkdir(join(workspace, 'projects', 'paternity-leave-research'));
    await writeFile(join(workspace, 'projects', 'agent-observatory.md'), 'private notes');
    await writeFile(join(workspace, 'projects', 'README.txt'), 'ignore');

    await expect(discoverWorkspaceProjectNames(workspace)).resolves.toEqual([
      'agent-observatory',
      'paternity-leave-research',
    ]);
  });

  it('writes the private project map with restrictive permissions and refuses accidental overwrite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledger-config-'));
    await chmod(dir, 0o755);
    const path = join(dir, 'project-map.json');
    const map = buildLedgerProjectMap({ workspaceRoot: '/w', repoRoots: ['/p/a'] });

    await writeLedgerProjectMap(path, map, { force: false });
    const text = await readFile(path, 'utf8');

    expect(JSON.parse(text)).toMatchObject({ version: 'map-v1' });
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(writeLedgerProjectMap(path, map, { force: false })).rejects.toThrow(/already exists/);
    await expect(writeLedgerProjectMap(path, map, { force: true })).resolves.toBeUndefined();
  });
});
