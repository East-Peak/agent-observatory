import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLedgerProjectMap } from '../../src/domain/projectMap.js';
import {
  installLedgerOps,
  ledgerOpsPaths,
  renderBackfillScript,
  renderBackupScript,
  renderLaunchAgentPlist,
  type LedgerOpsConfig,
} from '../../src/ops/install.js';

const config = (root: string): LedgerOpsConfig => ({
  repoDir: join(root, 'repo'),
  opsDir: join(root, 'ops'),
  configDir: join(root, 'config'),
  storeDir: join(root, 'store'),
  backupDir: join(root, 'backups'),
  launchAgentsDir: join(root, 'LaunchAgents'),
  transcriptsDir: join(root, 'claude'),
  rateCardPath: join(root, 'repo', 'rateCard.json'),
  projectMapPath: join(root, 'config', 'project-map.json'),
  graceMinutes: 5,
  backfillLabel: 'cc.eastpeak.agent-observatory.ledger-backfill',
  backupLabel: 'cc.eastpeak.agent-observatory.ledger-backup',
});

describe('ledger ops install', () => {
  it('renders launchd-safe backfill and backup scripts without mutating launchd state', () => {
    const cfg = config('/tmp/ledger ops');
    const backfill = renderBackfillScript(cfg);
    const backup = renderBackupScript(cfg);
    const plist = renderLaunchAgentPlist({
      label: cfg.backfillLabel,
      scriptPath: '/tmp/ledger ops/backfill.sh',
      stdoutPath: '/tmp/ledger ops/launchd.backfill.out',
      stderrPath: '/tmp/ledger ops/launchd.backfill.err',
      startIntervalSeconds: 3600,
      runAtLoad: true,
    });

    expect(backfill).toContain(
      '/opt/homebrew/bin/npm --workspace packages/ledger run --silent backfill -- --once',
    );
    expect(backfill).toContain("--project-map '/tmp/ledger ops/config/project-map.json'");
    expect(backfill).toContain('ledger backfill already running');
    expect(backfill).not.toContain('launchctl');
    expect(backup).toContain('cp "$CONFIG" "$stage/project-map.json"');
    expect(backup).toContain('rows.jsonl exceptions.jsonl exceptions-current.jsonl exceptions-history.jsonl');
    expect(backup).toContain('tar -czf "$tmp" -C "$stage" .');
    expect(backup).not.toContain('-C "$(dirname "$STORE")" "$(basename "$STORE")"');
    expect(backup).toContain("find '/tmp/ledger ops/backups' -name 'ledger-*.tgz' -mtime +30 -delete");
    expect(plist).toContain('<key>StartInterval</key>');
    expect(plist).toContain('<integer>3600</integer>');
    expect(plist).toContain('<key>RunAtLoad</key>');
  });

  it('installs private config, executable scripts, and LaunchAgent plists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ledger-ops-'));
    const cfg = config(root);
    const map = buildLedgerProjectMap({ workspaceRoot: join(root, 'workspace'), repoRoots: [cfg.repoDir] });

    const result = await installLedgerOps(cfg, map, { force: false });
    const paths = ledgerOpsPaths(cfg);

    expect([...result.filesWritten].sort()).toEqual(
      [
        paths.backfillPlist,
        paths.backfillScript,
        paths.backupPlist,
        paths.backupScript,
        paths.gitignore,
        paths.projectMap,
        paths.readme,
      ].sort(),
    );
    expect(await readFile(paths.projectMap, 'utf8')).toMatch(/"projectKey": "p_[a-f0-9]{16}"/);
    expect((await stat(paths.projectMap)).mode & 0o777).toBe(0o600);
    expect(await readFile(paths.gitignore, 'utf8')).toContain('*.log');
    expect((await stat(paths.backfillScript)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.backfillPlist)).mode & 0o777).toBe(0o644);
    await expect(installLedgerOps(cfg, map, { force: false })).rejects.toThrow(/already exists/);
  });
});
