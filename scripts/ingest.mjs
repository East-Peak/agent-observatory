#!/usr/bin/env node
// scripts/ingest.mjs — the real-data ingest: ccusage → decoders → canonical snapshot.
//
// Modes (parsed by scripts/ingestArgs.ts):
//   node scripts/ingest.mjs                          real run: invoke the pinned ccusage for
//                                                    {claude,codex,openclaw} daily --json, decode,
//                                                    reconcile, remap, assemble, validate, and write
//                                                    the gitignored data/snapshot.json the SPA reads.
//   node scripts/ingest.mjs --from-fixture --check   run the SAME pipeline over the committed
//                                                    frozen decoder fixtures and validate it — the
//                                                    envelope/assembly drift guard; writes nothing.
//   node scripts/ingest.mjs --argv-selfcheck         offline argv-parser + command-table self-test.
//
// It imports the REAL, contract-tested decoders + snapshot builders straight from src/ (Node
// strips the TS types natively), so there is exactly one decode/assemble implementation: the
// ingest path and the frozen `ccusage-decoder-contract` gate can never drift apart.
//
// Output uses process.stdout/stderr.write to stay clean under the no-console lint rule.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseIngestArgs, DEFAULT_OUT } from './ingestArgs.ts';
import { decodeClaudeDaily, decodeCodexDaily, decodeOpenclawDaily } from '../src/domain/decode.ts';
import {
  remapOpenclawAll,
  assembleSnapshot,
  validateSnapshot,
  reconcileTotals,
  OPENCLAW_ALL_MARKER,
} from '../src/domain/buildSnapshot.ts';
import { selectBand } from '../src/domain/normalizeCost.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CCUSAGE_BIN = resolve(ROOT, 'node_modules/.bin/ccusage');

/** The three sources: name, the exact ccusage subcommand, decoder, and committed decoder fixture. */
const SOURCES = [
  { name: 'claude', args: ['claude', 'daily', '--json'], decode: decodeClaudeDaily, fixture: 'data/fixtures/decoder/claude-daily.json' },
  { name: 'codex', args: ['codex', 'daily', '--json'], decode: decodeCodexDaily, fixture: 'data/fixtures/decoder/codex-daily.json' },
  { name: 'openclaw', args: ['openclaw', 'daily', '--json'], decode: decodeOpenclawDaily, fixture: 'data/fixtures/decoder/openclaw-daily.json' },
];

/** The exact ccusage command each source must invoke — asserted offline by --argv-selfcheck so a
 * typo in the real-run command table is caught even though fixture mode never shells out. */
const EXPECTED_COMMANDS = { claude: 'claude daily --json', codex: 'codex daily --json', openclaw: 'openclaw daily --json' };

const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);

const rateCard = () => JSON.parse(readFileSync(resolve(ROOT, 'rateCard.json'), 'utf8'));

/** Point-in-time priceability: a record is priceable iff a rate band covers its (model, date). */
function priceableWith(card) {
  return (model, date) => {
    try {
      selectBand(card, model, date);
      return true;
    } catch {
      return false;
    }
  };
}

/** Assert the local ccusage binary is exactly the pinned version before trusting its envelopes. */
function assertCcusageVersion() {
  const pinned = JSON.parse(readFileSync(resolve(ROOT, 'data/fixtures/ccusage.version.json'), 'utf8')).ccusage;
  const reported = execFileSync(CCUSAGE_BIN, ['--version'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const version = reported.split(/\s+/).pop();
  if (version !== pinned) {
    throw new Error(`ccusage version mismatch: binary reports "${version}", pinned is "${pinned}" (run \`npm install\`)`);
  }
}

/** Run the pinned ccusage binary for one source and return its parsed JSON envelope. */
function runCcusage(args) {
  if (!existsSync(CCUSAGE_BIN)) {
    throw new Error(`ccusage binary not found at ${CCUSAGE_BIN} — run \`npm install\` first`);
  }
  const raw = execFileSync(CCUSAGE_BIN, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return JSON.parse(raw);
}

/**
 * Gather every source as `{ name, records, totals }` from its envelope (live ccusage, or the
 * committed fixture). Keeping the envelope's own `totals` lets us reconcile per source.
 */
function gather(readEnvelope) {
  return SOURCES.map((s) => {
    const env = readEnvelope(s);
    return { name: s.name, records: s.decode(env), totals: env?.totals };
  });
}

const fromFixtures = () => gather((s) => JSON.parse(readFileSync(resolve(ROOT, s.fixture), 'utf8')));
function fromCcusage() {
  assertCcusageVersion();
  return gather((s) => runCcusage(s.args));
}

/**
 * Build a validated snapshot from per-source decoded groups: reconcile each source's sums against
 * ccusage's own totals, warn on empty sources, remap openclaw `(all)` days (logged, not silent),
 * assemble, and validate band coverage. Throws on any reconciliation/validation problem.
 */
function buildValidated(groups) {
  const card = rateCard();
  const problems = [];
  for (const g of groups) {
    problems.push(...reconcileTotals(g.name, g.records, g.totals));
    if (g.records.length === 0) {
      err(`warning: source "${g.name}" returned zero records (no usage in range, or a partial ingest)`);
    }
  }

  const allRecords = groups.flatMap((g) => g.records);
  const allDays = allRecords.filter((r) => r.source === 'openclaw' && r.model === OPENCLAW_ALL_MARKER).length;
  if (allDays > 0) {
    err(`note: remapped ${allDays} openclaw multi-model "(all)" day(s) → the openclaw default model for pricing`);
  }

  const snapshot = assembleSnapshot([remapOpenclawAll(allRecords)]);
  problems.push(...validateSnapshot(snapshot, priceableWith(card)));
  if (problems.length > 0) {
    throw new Error(`ingest validation failed:\n  - ${problems.join('\n  - ')}`);
  }
  return snapshot;
}

function writeSnapshot(path, snapshot) {
  const abs = resolve(ROOT, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(snapshot, null, 2)}\n`);
  return abs;
}

function summarize(snapshot) {
  const counts = ['claude', 'codex', 'openclaw']
    .map((s) => `${s}=${snapshot.records.filter((r) => r.source === s).length}`)
    .join(' ');
  return `${snapshot.records.length} records (${counts}) · asOf ${snapshot.asOf}`;
}

/** Offline proof the CLI contract + command table are correct — fails closed on bad input. */
function argvSelfcheck() {
  const ok = [
    [[], { kind: 'ingest', source: 'ccusage', check: false, out: DEFAULT_OUT }],
    [['--from-fixture', '--check'], { kind: 'ingest', source: 'fixture', check: true, out: DEFAULT_OUT }],
    [['--check'], { kind: 'ingest', source: 'ccusage', check: true, out: DEFAULT_OUT }],
    [['--out', 'x.json'], { kind: 'ingest', source: 'ccusage', check: false, out: 'x.json' }],
    [['--argv-selfcheck'], { kind: 'selfcheck', source: 'ccusage', check: false, out: DEFAULT_OUT }],
  ];
  const mustThrow = [['--out'], ['--bogus'], ['stray']];
  const fails = [];
  for (const [argv, want] of ok) {
    let got;
    try {
      got = parseIngestArgs(argv);
    } catch (e) {
      got = { error: String(e?.message ?? e) };
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(`${JSON.stringify(argv)} => ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
    }
  }
  for (const argv of mustThrow) {
    let threw = false;
    try {
      parseIngestArgs(argv);
    } catch {
      threw = true;
    }
    if (!threw) fails.push(`${JSON.stringify(argv)} should have been rejected`);
  }
  for (const s of SOURCES) {
    const got = s.args.join(' ');
    if (got !== EXPECTED_COMMANDS[s.name]) {
      fails.push(`command table for ${s.name} is "${got}" (want "${EXPECTED_COMMANDS[s.name]}")`);
    }
  }
  if (fails.length > 0) {
    err(`argv-selfcheck FAILED:\n  - ${fails.join('\n  - ')}`);
    return 1;
  }
  out(`argv-selfcheck OK (${ok.length + mustThrow.length} argv cases + ${SOURCES.length} commands)`);
  return 0;
}

function main(argv) {
  const plan = parseIngestArgs(argv);
  if (plan.kind === 'selfcheck') return argvSelfcheck();

  const snapshot = buildValidated(plan.source === 'fixture' ? fromFixtures() : fromCcusage());

  if (plan.source === 'fixture' && plan.check) {
    // Determinism: decoding + assembling the same frozen input twice must be byte-identical.
    if (JSON.stringify(buildValidated(fromFixtures())) !== JSON.stringify(snapshot)) {
      err('ingest --from-fixture --check FAILED: pipeline is non-deterministic');
      return 1;
    }
    out(`ingest --from-fixture --check OK: ${summarize(snapshot)}`);
    return 0;
  }

  if (plan.check) {
    out(`ingest --check OK: ${summarize(snapshot)} (not written)`);
    return 0;
  }

  out(`ingest OK: ${summarize(snapshot)} → ${writeSnapshot(plan.out, snapshot)}`);
  return 0;
}

// Run only when invoked directly (so importing this module for a test has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    err(`ingest FAILED: ${e?.message ?? e}`);
    process.exit(1);
  }
}
