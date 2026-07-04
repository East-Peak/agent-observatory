import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LedgerProjectMap } from '../domain/durable.js';
import { validateLedgerProjectMap } from '../domain/projectMap.js';
import { writeLedgerProjectMap } from '../io/projectMap.js';

export interface LedgerOpsConfig {
  readonly repoDir: string;
  readonly opsDir: string;
  readonly configDir: string;
  readonly storeDir: string;
  readonly backupDir: string;
  readonly launchAgentsDir: string;
  readonly transcriptsDir: string;
  readonly rateCardPath: string;
  readonly projectMapPath: string;
  readonly graceMinutes: number;
  readonly backfillLabel: string;
  readonly backupLabel: string;
}

export interface InstallLedgerOpsResult {
  readonly filesWritten: readonly string[];
  readonly bootstrapCommands: readonly string[];
}

interface LaunchAgentOptions {
  readonly label: string;
  readonly scriptPath: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly startIntervalSeconds?: number;
  readonly startCalendar?: { readonly hour: number; readonly minute: number };
  readonly runAtLoad?: boolean;
}

export function ledgerOpsPaths(config: LedgerOpsConfig): {
  readonly projectMap: string;
  readonly readme: string;
  readonly gitignore: string;
  readonly backfillScript: string;
  readonly backupScript: string;
  readonly backfillPlist: string;
  readonly backupPlist: string;
} {
  return {
    projectMap: config.projectMapPath,
    readme: join(config.opsDir, 'README.md'),
    gitignore: join(config.opsDir, '.gitignore'),
    backfillScript: join(config.opsDir, 'ledger-backfill.sh'),
    backupScript: join(config.opsDir, 'ledger-backup.sh'),
    backfillPlist: join(config.launchAgentsDir, `${config.backfillLabel}.plist`),
    backupPlist: join(config.launchAgentsDir, `${config.backupLabel}.plist`),
  };
}

export async function installLedgerOps(
  config: LedgerOpsConfig,
  projectMap: LedgerProjectMap,
  options: { readonly force: boolean },
): Promise<InstallLedgerOpsResult> {
  const mapErrors = validateLedgerProjectMap(projectMap);
  if (mapErrors.length > 0) throw new Error(`invalid project map: ${mapErrors.join('; ')}`);
  const paths = ledgerOpsPaths(config);
  await mkdir(config.opsDir, { recursive: true, mode: 0o700 });
  await chmod(config.opsDir, 0o700);
  await mkdir(config.launchAgentsDir, { recursive: true, mode: 0o755 });

  await writeLedgerProjectMap(paths.projectMap, projectMap, options);
  await writePrivateFile(paths.readme, renderOpsReadme(config), 0o600, options);
  await writePrivateFile(paths.gitignore, renderOpsGitignore(), 0o600, options);
  await writePrivateFile(paths.backfillScript, renderBackfillScript(config), 0o700, options);
  await writePrivateFile(paths.backupScript, renderBackupScript(config), 0o700, options);
  await writePrivateFile(
    paths.backfillPlist,
    renderLaunchAgentPlist({
      label: config.backfillLabel,
      scriptPath: paths.backfillScript,
      stdoutPath: join(config.opsDir, 'launchd.backfill.out'),
      stderrPath: join(config.opsDir, 'launchd.backfill.err'),
      startIntervalSeconds: 3600,
      runAtLoad: true,
    }),
    0o644,
    options,
  );
  await writePrivateFile(
    paths.backupPlist,
    renderLaunchAgentPlist({
      label: config.backupLabel,
      scriptPath: paths.backupScript,
      stdoutPath: join(config.opsDir, 'launchd.backup.out'),
      stderrPath: join(config.opsDir, 'launchd.backup.err'),
      startCalendar: { hour: 3, minute: 17 },
    }),
    0o644,
    options,
  );

  return {
    filesWritten: [
      paths.projectMap,
      paths.readme,
      paths.gitignore,
      paths.backfillScript,
      paths.backupScript,
      paths.backfillPlist,
      paths.backupPlist,
    ],
    bootstrapCommands: [
      `launchctl bootstrap gui/$(id -u) ${shellQuote(paths.backfillPlist)}`,
      `launchctl bootstrap gui/$(id -u) ${shellQuote(paths.backupPlist)}`,
    ],
  };
}

export function renderBackfillScript(config: LedgerOpsConfig): string {
  return `#!/bin/bash
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO=${shellQuote(config.repoDir)}
OPS=${shellQuote(config.opsDir)}
LOG="$OPS/backfill.log"
RUN_LOG="$OPS/.backfill.$$.log"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
mkdir -p "$OPS"
chmod 700 "$OPS"
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  mv -f "$LOG" "$LOG.1"
fi

cd "$REPO" || { echo "[$(ts)] cannot cd $REPO" >> "$LOG"; exit 1; }
echo "[$(ts)] ledger backfill start" >> "$LOG"
if /opt/homebrew/bin/npm --workspace packages/ledger run --silent backfill -- --once --store ${shellQuote(
    config.storeDir,
  )} --transcripts-dir ${shellQuote(config.transcriptsDir)} --project-map ${shellQuote(
    config.projectMapPath,
  )} --rate-card ${shellQuote(config.rateCardPath)} --grace-minutes ${String(config.graceMinutes)} > "$RUN_LOG" 2>&1; then
  cat "$RUN_LOG" >> "$LOG"
  rm -f "$RUN_LOG"
  echo "[$(ts)] ledger backfill ok" >> "$LOG"
else
  rc=$?
  cat "$RUN_LOG" >> "$LOG"
  if grep -q 'ledger backfill already running' "$RUN_LOG"; then
    rm -f "$RUN_LOG"
    echo "[$(ts)] ledger backfill already running; skipped" >> "$LOG"
    exit 0
  fi
  rm -f "$RUN_LOG"
  echo "[$(ts)] ledger backfill failed rc=$rc" >> "$LOG"
  exit "$rc"
fi
`;
}

export function renderBackupScript(config: LedgerOpsConfig): string {
  return `#!/bin/bash
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CONFIG=${shellQuote(config.projectMapPath)}
STORE=${shellQuote(config.storeDir)}
BACKUP=${shellQuote(config.backupDir)}
OPS=${shellQuote(config.opsDir)}
LOG="$OPS/backup.log"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
mkdir -p "$BACKUP" "$OPS"
chmod 700 "$BACKUP" "$OPS"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$BACKUP/.ledger-$stamp.stage"
tmp="$BACKUP/.ledger-$stamp.tgz.tmp"
dest="$BACKUP/ledger-$stamp.tgz"
cleanup() { rm -rf "$stage" "$tmp"; }
trap cleanup EXIT

if [ ! -f "$CONFIG" ]; then
  echo "[$(ts)] missing project map: $CONFIG" >> "$LOG"
  exit 1
fi
if [ ! -d "$STORE" ]; then
  echo "[$(ts)] missing ledger store: $STORE" >> "$LOG"
  exit 1
fi

mkdir -p "$stage"
chmod 700 "$stage"
cp "$CONFIG" "$stage/project-map.json"
mkdir -p "$stage/store"
for file in rows.jsonl exceptions.jsonl exceptions-current.jsonl exceptions-history.jsonl; do
  if [ -f "$STORE/$file" ]; then
    cp "$STORE/$file" "$stage/store/$file"
  fi
done

if tar -czf "$tmp" -C "$stage" .; then
  mv -f "$tmp" "$dest"
  chmod 600 "$dest"
  find ${shellQuote(config.backupDir)} -name 'ledger-*.tgz' -mtime +30 -delete
  echo "[$(ts)] backup ok: $dest" >> "$LOG"
else
  rc=$?
  rm -f "$tmp"
  echo "[$(ts)] backup failed rc=$rc" >> "$LOG"
  exit "$rc"
fi
`;
}

export function renderLaunchAgentPlist(options: LaunchAgentOptions): string {
  const schedule = options.startIntervalSeconds
    ? `<key>StartInterval</key>
  <integer>${options.startIntervalSeconds}</integer>`
    : `<key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${options.startCalendar?.hour ?? 3}</integer>
    <key>Minute</key>
    <integer>${options.startCalendar?.minute ?? 17}</integer>
  </dict>`;
  const runAtLoad = options.runAtLoad
    ? `<key>RunAtLoad</key>
  <true/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${escapeXml(options.scriptPath)}</string>
  </array>
  ${schedule}
  ${runAtLoad}
  <key>StandardOutPath</key>
  <string>${escapeXml(options.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.stderrPath)}</string>
</dict>
</plist>
`;
}

function renderOpsReadme(config: LedgerOpsConfig): string {
  return `# Agent Observatory ledger ops

Local-only automation for the activity-derived attribution ledger.

- Backfill job: ${config.backfillLabel}
- Backup job: ${config.backupLabel}
- Project map: ${config.projectMapPath}
- Store: ${config.storeDir}
- Backups: ${config.backupDir}

Bootstrap:

\`\`\`sh
launchctl bootstrap gui/$(id -u) ${shellQuote(join(config.launchAgentsDir, `${config.backfillLabel}.plist`))}
launchctl bootstrap gui/$(id -u) ${shellQuote(join(config.launchAgentsDir, `${config.backupLabel}.plist`))}
\`\`\`
`;
}

function renderOpsGitignore(): string {
  return `*.log
*.log.1
*.out
*.err
.backfill.*.log
`;
}

async function writePrivateFile(
  path: string,
  content: string,
  mode: number,
  options: { readonly force: boolean },
): Promise<void> {
  if (!options.force && (await fileExists(path))) throw new Error(`ops file already exists: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content, { mode });
  await chmod(tmp, mode);
  await rename(tmp, path);
  await chmod(path, mode);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
