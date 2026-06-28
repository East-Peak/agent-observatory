#!/usr/bin/env node
// FROZEN loop-safety guard for the autonomous /goal run.
//
// WHY: an unattended loop that keeps failing the SAME gate the same way is stuck — it
// will burn budget re-trying a fix that never works. This guard reads the machine-readable
// failure history that scripts/verify.mjs appends on each `--demo-ready` run and, if the
// SAME required app-logic gate failed in the last 3 consecutive runs, prints a terminal
// `===BLOCKED===` certificate so the loop stops and reports BLOCKED.
//
// It is FAIL-SAFE: it can only ever STOP a run (exit non-zero on a real livelock). It never
// reports success, never edits state, and so can never cause a false "complete". With fewer
// than 3 runs, or no gate failing in all 3, it exits 0.
//
// This file is FROZEN (scripts/verify.mjs `verifier-integrity`). Output uses
// process.stdout.write (not console.log) to stay clean under the no-console lint rule.
//
// Usage: node scripts/livelock-guard.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const HISTORY = join(ROOT, '.verify-logs', 'failure-history.json');
const STRIKES = 3;

function emit(lines) {
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** Read the appended failure history; tolerate a missing/corrupt file (treat as empty). */
function readHistory() {
  if (!existsSync(HISTORY)) return [];
  try {
    const parsed = JSON.parse(readFileSync(HISTORY, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const history = readHistory();
const last = history.slice(-STRIKES);

// A livelock = some gate name present in the `failures` array of EACH of the last 3 runs.
let stuck = [];
if (last.length === STRIKES) {
  const sets = last.map((e) => new Set(Array.isArray(e?.failures) ? e.failures : []));
  stuck = [...(sets[0] ?? new Set())].filter((name) => sets.every((s) => s.has(name)));
}

if (stuck.length > 0) {
  emit([
    '===BLOCKED===',
    `livelock-guard: BLOCKED after ${STRIKES} identical consecutive failures`,
    `stuck gate(s): ${stuck.join(', ')}`,
    'STOP and report BLOCKED — do not keep retrying the same fix. See .verify-logs/ for the gate logs.',
    'RESULT: BLOCKED',
    '===BLOCKED===',
  ]);
  process.exit(2);
}

emit([
  '===VERIFY:LIVELOCK:BEGIN===',
  `livelock-guard: OK (${history.length} run(s) recorded; no gate failed ${STRIKES}x consecutively)`,
  'RESULT: PASS',
  '===VERIFY:LIVELOCK:END===',
]);
process.exit(0);
