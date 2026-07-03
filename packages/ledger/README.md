# agent-ledger

Activity-derived compute-attribution ledger. Re-keys AI-agent token cost to the project the work
**actually served** — derived from the breadcrumbs each session leaves (file edits + per-turn `cwd`) in
agent transcripts — instead of the directory a terminal happened to launch from.

**Why:** launch-directory attribution is _wrong_, not just weak — a session launched in one repo can do all
its edits in another (verified: one session launched in `marin-monitor` did 121 edits in `marin-families`).
The signal to fix it is already on disk: every transcript turn records its own `cwd` and every file it
touched. See the design decision in the East Peak workspace:
`decisions/2026-07-03-activity-derived-attribution.md`.

**What's here:** the deterministic classifier + allocator (code only). The derived **data** never lives in
this repo — it is local, private, and rebuildable from transcripts (per the decision's privacy contract:
opaque project keys in the durable store, a separate local key→path map, public-safe exports only).

## Gates

`npm run verify` = `typecheck` + `lint` (zero warnings) + `format:check` + `test`. Strict red→green TDD.
