# agent-ledger

Activity-derived compute-attribution ledger. Re-keys AI-agent token cost to the project the work
**actually served** — derived from the breadcrumbs each session leaves (file edits, explicit Bash targets,
and per-turn `cwd`) in agent transcripts — instead of the directory a terminal happened to launch from.

**Why:** launch-directory attribution is _wrong_, not just weak — a session launched in one repo can do most
of its edits in another. The signal to fix it is already on disk: every transcript turn records its own
`cwd`, file activity, and Bash command text.

**What's here:** the deterministic classifier + allocator, exact-money pricing adapter, and a local
pull-backfill CLI. The derived **data** never lives in this repo — it is local, private, and rebuildable
from transcripts. See the repo-level [privacy contract](../../docs/privacy.md): opaque project keys in the
durable store, a separate local key-to-path map, public-safe exports only.

## Init

Discover git roots and write the private project map:

```sh
npm run ledger:init -- --projects-root "$HOME/projects"
```

The generated map lives at `~/.config/agent-observatory/project-map.json`. It is local config and must not be
committed.

## Backfill

Run one local pull-backfill pass:

```sh
npm run ledger:backfill -- --once
```

Defaults:

- transcripts: `~/.claude/projects/*/*.jsonl`
- store: `~/.local/share/agent-observatory/ledger/rows.jsonl`
- exceptions: `~/.local/share/agent-observatory/ledger/exceptions.jsonl`
- project map: `~/.config/agent-observatory/project-map.json`
- rate card: repo-root `rateCard.json`

The CLI takes a store lock, so an hourly `launchd` wrapper can safely skip overlapping runs.

Project-map shape:

```json
{
  "version": "map-v1",
  "workspaceRoot": "/Users/alex/.config/agent-observatory/workspace",
  "targets": [
    {
      "kind": "repo",
      "key": "/Users/alex/projects/example-repo",
      "projectKey": "p_0123456789abcdef"
    },
    { "kind": "direct", "key": "example-project", "projectKey": "p_0123456789abcdef" },
    { "kind": "meta", "key": "workspace", "projectKey": "workspace_meta" },
    { "kind": "scratch", "key": "scratch", "projectKey": "scratch" },
    { "kind": "overhead", "key": "other", "projectKey": "overhead_other" },
    { "kind": "unattributed", "key": "unattributed", "projectKey": "unattributed" }
  ]
}
```

Use explicit flags in tests or wrappers:

```sh
npm run ledger:backfill -- --once \
  --store /path/to/store \
  --transcripts-dir /path/to/.claude \
  --project-map /path/to/project-map.json \
  --rate-card /path/to/rateCard.json \
  --grace-minutes 5
```

## Ops

Install local macOS wrapper files for hourly backfill and daily selective backup:

```sh
npm run ledger:ops:install -- --projects-root "$HOME/projects"
```

The command prints the `launchctl bootstrap` commands to load the jobs. Templates live in `ops/ledger/`; longer
setup notes live in `docs/setup.md`.

## Gates

`npm run verify` = `typecheck` + `lint` (zero warnings) + `format:check` + `test`. Strict red→green TDD.
