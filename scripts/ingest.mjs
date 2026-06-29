#!/usr/bin/env node
// scripts/ingest.mjs — the real-data ingest: ccusage → decoders → canonical snapshot.
//
// Modes (parsed by scripts/ingestArgs.ts):
//   node scripts/ingest.mjs                          real run: invoke the pinned ccusage for claude
//                                                    daily + daily --instances (per-project) and codex/
//                                                    openclaw daily (all --timezone UTC), decode,
//                                                    resolve claude projects against discovered git
//                                                    roots, reconcile, remap, assemble, validate, write
//                                                    the gitignored data/snapshot.json + report-only
//                                                    data/status.json the SPA + ops layer read.
//   node scripts/ingest.mjs --from-fixture --check   run the SAME pipeline over the committed frozen
//                                                    decoder fixtures (synthetic project roots) and
//                                                    validate it — the envelope/assembly/attribution
//                                                    drift guard; writes nothing.
//   node scripts/ingest.mjs --argv-selfcheck         offline argv-parser + command-table self-test.
//
// It imports the REAL, contract-tested decoders + snapshot builders + project resolver straight from
// src/ (Node strips the TS types natively), so there is exactly one decode/assemble/resolve impl: the
// ingest path and the frozen gates can never drift apart.
//
// Output uses process.stdout/stderr.write to stay clean under the no-console lint rule.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { parseIngestArgs, DEFAULT_OUT } from './ingestArgs.ts';
import {
  decodeClaudeDaily,
  decodeClaudeInstances,
  decodeCodexDaily,
  decodeOpenclawDaily,
} from '../src/domain/decode.ts';
import {
  remapOpenclawAll,
  assembleSnapshot,
  validateSnapshot,
  reconcileTotals,
  reconcileInstancesDaily,
  OPENCLAW_ALL_MARKER,
} from '../src/domain/buildSnapshot.ts';
import { resolveProject } from '../src/domain/projectIdentity.ts';
import { UNATTRIBUTED } from '../src/domain/projects.ts';
import { selectBand } from '../src/domain/normalizeCost.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CCUSAGE_BIN = resolve(ROOT, 'node_modules/.bin/ccusage');

/** UTC is pinned on EVERY ccusage command so day buckets are stable + match the week/month bucketing. */
const TZ = ['--timezone', 'UTC'];

// Verifier-owned search bases for live git-root discovery. `~` expands to the running user's home, so
// no absolute path is hardcoded (and none leaks into committed data — discovered roots live only in the
// gitignored snapshot). A base that is itself a git repo is one root; else its immediate child repos are.
const SEARCH_BASES = ['~/projects', '~/.openclaw/workspace'];

// Frozen synthetic roots for offline --from-fixture mode — they forward-match the encoded dirs committed
// in claude-instances.json (no filesystem access, so the attribution path is deterministic + testable).
const SYNTHETIC_ROOTS = ['/Users/dev/projects/yard-ops', '/Users/dev/projects/marin-civic-graph'];

// Worktree / rename aliases (an absolute worktree path → its canonical git-toplevel root). None are
// configured yet; the resolver ignores a stray alias, so an empty map is safe.
const ALIASES = {};

const CLAUDE_DAILY_ARGS = ['claude', 'daily', '--json', ...TZ];
const CLAUDE_INSTANCES_ARGS = ['claude', 'daily', '--instances', '--json', ...TZ];
const CLAUDE_DAILY_FIXTURE = 'data/fixtures/decoder/claude-daily.json';
const CLAUDE_INSTANCES_FIXTURE = 'data/fixtures/decoder/claude-instances.json';

/** Daily-only sources (no per-project signal): each is one ccusage subcommand → one decoder → one fixture. */
const DAILY_SOURCES = [
  { name: 'codex', args: ['codex', 'daily', '--json', ...TZ], decode: decodeCodexDaily, fixture: 'data/fixtures/decoder/codex-daily.json' },
  { name: 'openclaw', args: ['openclaw', 'daily', '--json', ...TZ], decode: decodeOpenclawDaily, fixture: 'data/fixtures/decoder/openclaw-daily.json' },
];

/** The exact ccusage command each invocation must use — asserted offline by --argv-selfcheck so a typo
 * in the real-run command table is caught even though fixture mode never shells out. */
const EXPECTED_COMMANDS = {
  'claude-daily': 'claude daily --json --timezone UTC',
  'claude-instances': 'claude daily --instances --json --timezone UTC',
  codex: 'codex daily --json --timezone UTC',
  openclaw: 'openclaw daily --json --timezone UTC',
};

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

const expandHome = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isGitRoot = (p) => existsSync(join(p, '.git'));

/**
 * Discover the live git-toplevel roots under the frozen search bases (impure — the live half of
 * attribution). A base that is itself a git repo is a root; otherwise its immediate child repos are.
 * The pure forward-match resolver takes the result; raw paths never leave the gitignored snapshot.
 */
function discoverKnownRoots(bases = SEARCH_BASES) {
  const roots = new Set();
  for (const base of bases.map(expandHome)) {
    if (!isDir(base)) continue;
    if (isGitRoot(base)) {
      roots.add(base);
      continue;
    }
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && isGitRoot(join(base, entry.name))) roots.add(join(base, entry.name));
    }
  }
  return [...roots];
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

/** Run the pinned ccusage binary for one command and return its parsed JSON envelope. */
function runCcusage(args) {
  if (!existsSync(CCUSAGE_BIN)) {
    throw new Error(`ccusage binary not found at ${CCUSAGE_BIN} — run \`npm install\` first`);
  }
  const raw = execFileSync(CCUSAGE_BIN, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return JSON.parse(raw);
}

/**
 * Build the claude group: per-project records from `--instances` (attributed via the pure resolver over
 * `roots`), plus the matching daily records kept ONLY for the instances↔daily reconciliation. ccusage
 * cannot attribute Codex, so codex/openclaw stay daily (their decoders stamp their tool sentinels).
 */
function claudeGroup(dailyEnv, instancesEnv, roots) {
  const resolveFn = (encodedDir) => resolveProject(encodedDir, { knownRoots: roots, aliases: ALIASES }).key;
  return {
    name: 'claude',
    records: decodeClaudeInstances(instancesEnv, resolveFn),
    totals: instancesEnv?.totals,
    daily: decodeClaudeDaily(dailyEnv),
  };
}

function fromFixtures() {
  const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
  const claude = claudeGroup(read(CLAUDE_DAILY_FIXTURE), read(CLAUDE_INSTANCES_FIXTURE), SYNTHETIC_ROOTS);
  const daily = DAILY_SOURCES.map((s) => {
    const env = read(s.fixture);
    return { name: s.name, records: s.decode(env), totals: env?.totals };
  });
  return [claude, ...daily];
}

function fromCcusage() {
  assertCcusageVersion();
  const roots = discoverKnownRoots();
  err(`note: discovered ${roots.length} known git root(s) under the search bases for claude attribution`);
  const claude = claudeGroup(runCcusage(CLAUDE_DAILY_ARGS), runCcusage(CLAUDE_INSTANCES_ARGS), roots);
  const daily = DAILY_SOURCES.map((s) => {
    const env = runCcusage(s.args);
    return { name: s.name, records: s.decode(env), totals: env?.totals };
  });
  return [claude, ...daily];
}

/**
 * Build a validated snapshot from per-source groups: reconcile each source's sums against ccusage's
 * own totals, reconcile claude `--instances` against claude `daily` (the per-project split must recover
 * the daily totals), warn on empty sources, remap openclaw `(all)` days (logged, not silent), assemble,
 * and validate band coverage + registry + uniqueness. Throws on any reconciliation/validation problem.
 */
function buildValidated(groups) {
  const card = rateCard();
  const problems = [];
  for (const g of groups) {
    problems.push(...reconcileTotals(g.name, g.records, g.totals));
    if (g.name === 'claude' && g.daily) {
      problems.push(...reconcileInstancesDaily(g.records, g.daily).map((p) => `claude instances↔daily: ${p}`));
    }
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

const tokenTotal = (r) => r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.reasoningTokens;

/**
 * REPORT-ONLY attribution health: the claude Unattributed token share + repo count. This is written
 * for the ops layer / dashboard to surface; it NEVER gates certification (real-usage conditions the loop
 * can't control must not livelock it), and it carries no raw paths — only the sentinel + aggregate kinds.
 */
function attributionStatus(snapshot) {
  const claude = snapshot.records.filter((r) => r.source === 'claude');
  const total = claude.reduce((acc, r) => acc + tokenTotal(r), 0);
  const unattributed = claude
    .filter((r) => r.project === UNATTRIBUTED)
    .reduce((acc, r) => acc + tokenTotal(r), 0);
  const repoProjects = new Set(
    claude.filter((r) => snapshot.projects[r.project]?.kind === 'repo').map((r) => r.project),
  );
  return {
    asOf: snapshot.asOf,
    claudeTotalTokens: total,
    claudeUnattributedTokens: unattributed,
    claudeUnattributedShare: total > 0 ? unattributed / total : 0,
    claudeRepoProjectCount: repoProjects.size,
  };
}

function writeJson(path, value) {
  const abs = resolve(ROOT, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
  return abs;
}

/** The report-only status path sits beside the snapshot (gitignored), so ops can read freshness + share. */
const statusPathFor = (outPath) => join(dirname(outPath), 'status.json');

function summarize(snapshot) {
  const counts = ['claude', 'codex', 'openclaw']
    .map((s) => `${s}=${snapshot.records.filter((r) => r.source === s).length}`)
    .join(' ');
  const repos = new Set(
    snapshot.records.filter((r) => snapshot.projects[r.project]?.kind === 'repo').map((r) => r.project),
  ).size;
  return `${snapshot.records.length} records (${counts}) · ${repos} repo project(s) · asOf ${snapshot.asOf}`;
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
  const commands = [
    ['claude-daily', CLAUDE_DAILY_ARGS],
    ['claude-instances', CLAUDE_INSTANCES_ARGS],
    ...DAILY_SOURCES.map((s) => [s.name, s.args]),
  ];
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
  for (const [name, args] of commands) {
    const got = args.join(' ');
    if (got !== EXPECTED_COMMANDS[name]) {
      fails.push(`command table for ${name} is "${got}" (want "${EXPECTED_COMMANDS[name]}")`);
    }
  }
  if (fails.length > 0) {
    err(`argv-selfcheck FAILED:\n  - ${fails.join('\n  - ')}`);
    return 1;
  }
  out(`argv-selfcheck OK (${ok.length + mustThrow.length} argv cases + ${commands.length} commands)`);
  return 0;
}

function main(argv) {
  const plan = parseIngestArgs(argv);
  if (plan.kind === 'selfcheck') return argvSelfcheck();

  const snapshot = buildValidated(plan.source === 'fixture' ? fromFixtures() : fromCcusage());

  if (plan.source === 'fixture' && plan.check) {
    // Determinism: decoding + resolving + assembling the same frozen input twice must be byte-identical.
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

  const snapPath = writeJson(plan.out, snapshot);
  const status = attributionStatus(snapshot);
  const statusPath = writeJson(statusPathFor(plan.out), status);
  err(
    `note: claude attribution — ${(status.claudeUnattributedShare * 100).toFixed(1)}% Unattributed across ` +
      `${status.claudeRepoProjectCount} repo project(s) (report-only; see ${statusPath})`,
  );
  out(`ingest OK: ${summarize(snapshot)} → ${snapPath}`);
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
