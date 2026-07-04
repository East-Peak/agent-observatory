# Privacy Contract

Agent Observatory is local-first. Normal setup does not send transcript, project-map, ledger, or dashboard data to
any external service.

## What It Reads

- Claude Code transcript JSONL files under `~/.claude/projects/`.
- The project map you configure at `~/.config/agent-observatory/project-map.json`.
- The repo-local `rateCard.json`.
- Optional `ccusage` daily summaries for Codex/OpenClaw tool-level rows.

It does **not** read your notes, memories, documents, email, browser data, chat history outside Claude Code
transcripts, or the contents of your repos.

## What It Writes

- Durable ledger rows under `~/.local/share/agent-observatory/ledger/`.
- A private project map under `~/.config/agent-observatory/`.
- Optional local backups under `~/.local/share/agent-observatory/ledger-backups/`.
- Gitignored dashboard artifacts: `data/snapshot.json`, `data/status.json`, and `data/trust.json`.

## What Stays Private

The project map is the only normal file with raw local repo paths. Durable ledger rows use opaque project keys and
hashed transcript identifiers. The dashboard snapshot uses project keys and display labels; it does not include raw
session IDs, transcript hashes, transcript text, prompts, or commands.

Optional workspace taxonomy only reads project filenames/directories under a configured `projects/` directory. It is
not required, and it does not copy note contents.

## Public Repo Rule

Do not commit generated local data, raw transcript captures, project maps, backups, or machine-specific paths.
The verifier includes a tracked private-leak scan, and the generated local artifacts are gitignored.
