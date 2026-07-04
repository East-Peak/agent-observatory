#!/bin/bash
set -uo pipefail

CONFIG="{{PROJECT_MAP_PATH}}"
STORE="{{STORE_DIR}}"
BACKUP="{{BACKUP_DIR}}"
OPS="{{OPS_DIR}}"
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

mkdir -p "$stage/store"
chmod 700 "$stage"
cp "$CONFIG" "$stage/project-map.json"
for file in rows.jsonl exceptions.jsonl exceptions-current.jsonl exceptions-history.jsonl; do
  if [ -f "$STORE/$file" ]; then
    cp "$STORE/$file" "$stage/store/$file"
  fi
done

if tar -czf "$tmp" -C "$stage" .; then
  mv -f "$tmp" "$dest"
  chmod 600 "$dest"
  find "$BACKUP" -name 'ledger-*.tgz' -mtime +30 -delete
  echo "[$(ts)] backup ok: $dest" >> "$LOG"
else
  rc=$?
  rm -f "$tmp"
  echo "[$(ts)] backup failed rc=$rc" >> "$LOG"
  exit "$rc"
fi
