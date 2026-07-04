# Ledger Ops Templates

Sanitized templates for the local ledger automation. The installer renders user-specific copies under
`~/.local/share/agent-observatory/ops/` and LaunchAgent plists under `~/Library/LaunchAgents/`.

Install from the repo root:

```sh
npm run ledger:ops:install -- --projects-root "$HOME/projects"
```

Uninstall generated wrappers without deleting the private project map, durable ledger store, or backups:

```sh
npm run ledger:ops:uninstall
```

These templates are macOS launchd-oriented. For Linux, use the cron shape in `docs/setup.md`.
