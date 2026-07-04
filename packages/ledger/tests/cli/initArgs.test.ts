import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initLedgerProjectMap, parseInitArgs } from '../../src/cli/init.js';

describe('parseInitArgs', () => {
  it('defaults to public local-only paths without assuming a private workspace', () => {
    expect(parseInitArgs([])).toMatchObject({
      projectsRoot: join(homedir(), 'projects'),
      workspaceRoot: join(homedir(), '.config/agent-observatory/workspace'),
      projectMapPath: join(homedir(), '.config/agent-observatory/project-map.json'),
      dryRun: false,
      force: false,
    });
  });

  it('accepts explicit paths and fails closed on unknown flags', () => {
    expect(
      parseInitArgs([
        '--dry-run',
        '--force',
        '--projects-root',
        '/tmp/repos',
        '--workspace-root',
        '/tmp/workspace',
        '--project-map',
        '/tmp/project-map.json',
      ]),
    ).toMatchObject({
      dryRun: true,
      force: true,
      projectsRoot: '/tmp/repos',
      workspaceRoot: '/tmp/workspace',
      projectMapPath: '/tmp/project-map.json',
    });
    expect(() => parseInitArgs(['--surprise'])).toThrow(/unknown option/);
  });
});

describe('initLedgerProjectMap', () => {
  it('discovers git roots and workspace project names into a private project map', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ledger-init-'));
    const projectsRoot = join(root, 'repos');
    const workspaceRoot = join(root, 'workspace');
    const projectMapPath = join(root, 'config', 'project-map.json');
    await mkdir(join(projectsRoot, 'alpha-repo', '.git'), { recursive: true });
    await mkdir(join(workspaceRoot, 'projects'), { recursive: true });
    await writeFile(join(workspaceRoot, 'projects', 'alpha-notes.md'), 'private notes never copied');

    const result = await initLedgerProjectMap({
      projectsRoot,
      workspaceRoot,
      projectMapPath,
      force: false,
      dryRun: false,
    });

    const text = await readFile(projectMapPath, 'utf8');
    expect(result).toMatchObject({
      dryRun: false,
      repoTargets: 1,
      directTargets: 1,
      totalTargets: 6,
      projectMapPath,
    });
    expect(text).toContain('"key": "alpha-notes"');
    expect(text).not.toContain('private notes');
  });
});
