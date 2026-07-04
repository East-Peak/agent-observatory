import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInstallOpsArgs } from '../../src/cli/install-ops.js';

describe('parseInstallOpsArgs', () => {
  it('defaults to local-only ledger ops paths', () => {
    expect(parseInstallOpsArgs([])).toMatchObject({
      projectsRoot: join(homedir(), 'projects'),
      workspaceRoot: join(homedir(), '.config/agent-observatory/workspace'),
      opsDir: join(homedir(), '.local/share/agent-observatory/ops'),
      storeDir: join(homedir(), '.local/share/agent-observatory/ledger'),
      backupDir: join(homedir(), '.local/share/agent-observatory/ledger-backups'),
      projectMapPath: join(homedir(), '.config/agent-observatory/project-map.json'),
      backfillLabel: 'local.agent-observatory.ledger-backfill',
      backupLabel: 'local.agent-observatory.ledger-backup',
      force: false,
      dryRun: false,
    });
  });

  it('accepts explicit paths and fails closed on unknown flags', () => {
    expect(
      parseInstallOpsArgs([
        '--dry-run',
        '--force',
        '--projects-root',
        '/tmp/projects',
        '--workspace-root',
        '/tmp/workspace',
        '--ops-dir',
        '/tmp/ops',
        '--store',
        '/tmp/store',
        '--backup-dir',
        '/tmp/backups',
        '--project-map',
        '/tmp/project-map.json',
        '--grace-minutes',
        '0',
      ]),
    ).toMatchObject({
      dryRun: true,
      force: true,
      projectsRoot: '/tmp/projects',
      workspaceRoot: '/tmp/workspace',
      opsDir: '/tmp/ops',
      storeDir: '/tmp/store',
      backupDir: '/tmp/backups',
      projectMapPath: '/tmp/project-map.json',
      graceMinutes: 0,
    });
    expect(() => parseInstallOpsArgs(['--surprise'])).toThrow(/unknown option/);
  });
});
