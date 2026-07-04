# Setup

This is the clone-to-live path for a new user who wants a local dashboard backed by their own Claude Code
transcripts.

## Prerequisites

- Node `>=23.6.0` and npm.
- git.
- Claude Code installed, logged in, and used at least once. The ledger reads local transcript JSONL files from
  `~/.claude/projects/`.
- A directory containing the git repos you want attributed, such as `~/projects`.

## Quickstart

```sh
git clone https://github.com/East-Peak/agent-observatory.git
cd agent-observatory
npm ci
```

Create the private project map:

```sh
npm run ledger:init -- --projects-root "$HOME/projects"
```

This writes `~/.config/agent-observatory/project-map.json` with:

- `repo` targets for direct git roots under `--projects-root`.
- required accounting buckets for `workspace`, `scratch`, `overhead`, and `unattributed`.
- optional `direct` targets from a workspace root if you pass `--workspace-root`.

Run one ledger backfill and project it into the dashboard:

```sh
npm run ledger:backfill -- --once
npm run ingest
npm run trust:sidecar
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open <http://127.0.0.1:4173>.

## Project Map

The project map is the only file that contains your local repo paths. It is private local config, not committed.
See [config/project-map.example.json](../config/project-map.example.json) for the schema.

If you add repos later, rerun init with `--force` to refresh discovered targets while preserving existing project
keys and any manual targets:

```sh
npm run ledger:init -- --projects-root "$HOME/projects" --force
```

If your repos are spread across multiple roots, either run init on the main root and edit the map manually, or run
with `--dry-run` first and merge the targets you want.

## Optional Workspace Taxonomy

The `workspaceRoot` field is optional taxonomy, not a requirement. If you keep project notes in a local workspace
with files like `projects/example.md`, pass that root:

```sh
npm run ledger:init -- \
  --projects-root "$HOME/projects" \
  --workspace-root "$HOME/workspace"
```

The init command reads names of files/directories under `projects/`; it does not copy note contents. If you do not
have this kind of workspace, omit `--workspace-root` and the default unused placeholder is harmless.

## Local Data Paths

- Project map: `~/.config/agent-observatory/project-map.json`
- Durable ledger store: `~/.local/share/agent-observatory/ledger/`
- Backups: `~/.local/share/agent-observatory/ledger-backups/`
- Ops wrappers/logs: `~/.local/share/agent-observatory/ops/`
- Dashboard artifacts: `data/snapshot.json`, `data/status.json`, and `data/trust.json` inside the repo; all are
  gitignored.

## Automation

On macOS, install local launchd wrapper files for hourly backfill and daily selective backup:

```sh
npm run ledger:ops:install -- --projects-root "$HOME/projects"
```

The command writes parameterized scripts and plists under the local paths above and prints the `launchctl bootstrap`
commands to load them. Re-running the same install is idempotent. To remove the generated wrapper files without
deleting the project map, ledger store, or backups:

```sh
npm run ledger:ops:uninstall
```

For Linux, use cron with the same underlying commands. A typical shape is:

```cron
0 * * * * cd /path/to/agent-observatory && npm run ledger:backfill -- --once >> "$HOME/.local/share/agent-observatory/ops/backfill.log" 2>&1
17 3 * * * mkdir -p "$HOME/.local/share/agent-observatory/ledger-backups" && tar -czf "$HOME/.local/share/agent-observatory/ledger-backups/ledger-$(date -u +\%Y\%m\%dT\%H\%M\%SZ).tgz" -C "$HOME/.local/share/agent-observatory" ledger
```

After a backfill, rerun `npm run ingest`, `npm run trust:sidecar`, and `npm run build` before serving a static
preview if you want the built dashboard bundle refreshed.

## Optional Inputs

- Codex/OpenClaw rows are optional tool-level sentinels from `ccusage`; Claude per-project allocation is the first
  class ledger path today.
- `npm run ingest -- --from-ccusage` is the legacy daily-only ingest path. It is useful for compatibility checks,
  but it does not produce Claude per-project allocation.
- `data/trust.json` from `npm run trust:sidecar` is optional UI metadata. The app fails open when it is absent.

## Troubleshooting

- `project map already exists`: rerun with `--force` when you intend to refresh it.
- `npm not found on PATH` in the ops log: make sure `npm` is available to non-interactive shells, or set `NPM_BIN`
  in the generated backfill wrapper.
- Empty dashboard: confirm Claude Code has local transcript files under `~/.claude/projects/`, then run
  `npm run ledger:backfill -- --once` and `npm run ingest` again.
