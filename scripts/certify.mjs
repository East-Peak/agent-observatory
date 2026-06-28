#!/usr/bin/env node
// Single completion artifact for the Agent Observatory /goal run.
//
// WHY: the /goal evaluator only reads the transcript. Rather than ask the loop to
// hand-assemble separate proofs, this runs `verify:complete` itself and prints ONE
// coherent block. The `OBSERVATORY-COMPLETE <HEAD_SHA>` token is emitted ONLY when the
// verifier exits 0 — it is bound to the real HEAD commit, so an honest run cannot declare
// done on a failing tree.
//
// ROOT OF TRUST — this file is a FROZEN arg-forwarder that embeds NO SHA (so it is not
// self-referential; Codex r5#1). The pinned baseline SHA lives in the immutable /goal
// contract; the loop passes it here as `--expected-baseline-sha <40-hex>`. certify echoes
// HEAD_SHA + EXPECTED_BASELINE_SHA into the transcript and calls
//   node scripts/verify.mjs --complete --expected-baseline-sha <arg>
// DIRECTLY (never via a loop-editable npm script), so the verifier the contract pins is the
// one that runs. verify.mjs's `verifier-integrity` / `baseline-tag` gates assert the
// frozen set matches the tag AND that the tag SHA == this forwarded arg.
//
// This file is FROZEN (scripts/verify.mjs `verifier-integrity`). Output uses
// process.stdout.write to stay clean under the no-console lint rule.
//
// Usage: node scripts/certify.mjs --expected-baseline-sha <40-hex>

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function emit(text) {
  process.stdout.write(`${text}\n`);
}

function fail(message) {
  emit('===CERTIFY:COMPLETE:BEGIN===');
  emit(`error: ${message}`);
  emit('NOT-COMPLETE (certify pre-flight failed)');
  emit('===CERTIFY:COMPLETE:END===');
  process.exit(1);
}

// Require EXACTLY one 40-hex --expected-baseline-sha argument (no embedded default).
const argv = process.argv.slice(2);
const flagIdx = argv.indexOf('--expected-baseline-sha');
if (flagIdx === -1 || typeof argv[flagIdx + 1] !== 'string') {
  fail('missing required --expected-baseline-sha <40-hex> (supplied by the /goal contract)');
}
const expectedSha = argv[flagIdx + 1];
if (!/^[0-9a-f]{40}$/.test(expectedSha)) {
  fail(`--expected-baseline-sha must be a 40-char lowercase hex SHA (got "${expectedSha}")`);
}

let headSha = '(unknown)';
try {
  headSha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  fail('could not resolve HEAD (is this a git repo with at least one commit?)');
}

// Run the full completion gate DIRECTLY (not via npm); capture its certificate whether it
// passes or fails. Pass the forwarded SHA so verifier-integrity / baseline-tag can bind to it.
function runComplete() {
  try {
    const out = execSync(`node scripts/verify.mjs --complete --expected-baseline-sha ${expectedSha}`, {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { cert: out, pass: /\nRESULT: PASS\n/.test(`\n${out}\n`) };
  } catch (e) {
    return { cert: `${e.stdout ?? ''}${e.stderr ?? ''}`, pass: false };
  }
}
const { cert, pass } = runComplete();

const lines = [
  cert.trimEnd(),
  '===CERTIFY:COMPLETE:BEGIN===',
  `HEAD_SHA: ${headSha}`,
  `EXPECTED_BASELINE_SHA: ${expectedSha}`,
  `verify:complete: ${pass ? 'PASS' : 'FAIL'}`,
  pass ? `OBSERVATORY-COMPLETE ${headSha}` : 'NOT-COMPLETE (verify:complete did not pass)',
  '===CERTIFY:COMPLETE:END===',
];
emit(lines.join('\n'));
process.exit(pass ? 0 : 1);
