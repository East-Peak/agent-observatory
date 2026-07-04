# agent-ledger

Activity-derived compute-attribution ledger. Re-keys AI-agent token cost to the project the work
**actually served** — derived from the breadcrumbs each session leaves (file edits, explicit Bash targets,
and per-turn `cwd`) in agent transcripts — instead of the directory a terminal happened to launch from.

**Why:** launch-directory attribution is _wrong_, not just weak — a session launched in one repo can do all
its edits in another (verified: one session launched in `marin-monitor` did 121 edits in `marin-families`).
The signal to fix it is already on disk: every transcript turn records its own `cwd`, file activity, and
Bash command text. See the design decision in the East Peak workspace:
`decisions/2026-07-03-activity-derived-attribution.md`.

**What's here:** the deterministic classifier + allocator, exact-money pricing adapter, and a local
pull-backfill CLI. The derived **data** never lives in this repo — it is local, private, and rebuildable
from transcripts (per the decision's privacy contract: opaque project keys in the durable store, a
separate local key→path map, public-safe exports only).

## Backfill

Run one local pull-backfill pass:

```sh
npm --workspace packages/ledger run backfill -- --once
```

Defaults:

- transcripts: `~/.claude/projects/*/*.jsonl`
- store: `~/.local/share/agent-observatory/ledger/rows.jsonl`
- exceptions: `~/.local/share/agent-observatory/ledger/exceptions.jsonl`
- project map: `~/.config/agent-observatory/project-map.json`
- rate card: repo-root `rateCard.json`

The CLI takes a store lock, so an hourly `launchd` wrapper can safely skip overlapping runs. It does not
install or mutate `launchd` state.

Project-map shape:

```json
{
  "version": "map-v1",
  "workspaceRoot": "/Users/tammypais/.openclaw/workspace",
  "targets": [
    {
      "kind": "repo",
      "key": "/Users/tammypais/projects/agent-observatory",
      "projectKey": "agent_observatory"
    },
    { "kind": "meta", "key": "workspace", "projectKey": "workspace_meta" },
    { "kind": "scratch", "key": "scratch", "projectKey": "scratch" },
    { "kind": "overhead", "key": "other", "projectKey": "overhead_other" },
    { "kind": "unattributed", "key": "unattributed", "projectKey": "unattributed" }
  ]
}
```

Use explicit flags in tests or wrappers:

```sh
npm --workspace packages/ledger run backfill -- --once \
  --store /path/to/store \
  --transcripts-dir /path/to/.claude \
  --project-map /path/to/project-map.json \
  --rate-card /path/to/rateCard.json \
  --grace-minutes 5
```

## Gates

`npm run verify` = `typecheck` + `lint` (zero warnings) + `format:check` + `test`. Strict red→green TDD.
