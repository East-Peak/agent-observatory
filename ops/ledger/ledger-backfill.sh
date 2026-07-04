#!/bin/bash
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="{{REPO_DIR}}"
OPS="{{OPS_DIR}}"
STORE="{{STORE_DIR}}"
TRANSCRIPTS="{{TRANSCRIPTS_DIR}}"
PROJECT_MAP="{{PROJECT_MAP_PATH}}"
RATE_CARD="{{RATE_CARD_PATH}}"
GRACE_MINUTES="{{GRACE_MINUTES}}"
LOG="$OPS/backfill.log"
RUN_LOG="$OPS/.backfill.$$.log"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

mkdir -p "$OPS"
chmod 700 "$OPS"

cd "$REPO" || { echo "[$(ts)] cannot cd $REPO" >> "$LOG"; exit 1; }
if [ -z "$NPM_BIN" ]; then
  echo "[$(ts)] npm not found on PATH" >> "$LOG"
  exit 127
fi

echo "[$(ts)] ledger backfill start" >> "$LOG"
if "$NPM_BIN" --workspace packages/ledger run --silent backfill -- --once \
  --store "$STORE" \
  --transcripts-dir "$TRANSCRIPTS" \
  --project-map "$PROJECT_MAP" \
  --rate-card "$RATE_CARD" \
  --grace-minutes "$GRACE_MINUTES" > "$RUN_LOG" 2>&1; then
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
