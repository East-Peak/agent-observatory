#!/usr/bin/env node
// Deterministic, fail-closed verifier for the Agent Observatory /goal run.
//
// WHY: the /goal evaluator (a small model) only reads the conversation transcript — it
// cannot run commands, read files, or see screenshots. So "done" must be provable as text.
// This script runs the real checks and prints a compact PASS/FAIL certificate between
// sentinels; the /goal condition keys off that exact output. Full logs go to .verify-logs/
// (gitignored), so the certificate stays small enough to survive the evaluator's context.
//
// Every external command has a bounded timeout so a hung test/build can never stall the
// unattended run forever (a timeout records FAIL). Gates fail CLOSED: anything unreadable,
// missing, or ambiguous is a FAIL, never a silent pass.
//
// Anti-gaming gates that must exercise the app's TypeScript (normalization-golden,
// ccusage-decoder-contract) do so by writing a FROZEN emitter snippet (a string literal in
// THIS file) to a temp .mts and running it through tsx — so the real app code runs, while
// the assertions stay frozen here where the loop may not edit them.
//
// This file is FROZEN (the `verifier-integrity` gate byte-matches it against the
// `observatory-verifier-baseline` tag). Output uses process.stdout.write (not console.log)
// to stay clean under the no-console lint rule.
//
// Tiers:
//   node scripts/verify.mjs                         -> STEP (fast): tests, lint, tsc, identity
//   node scripts/verify.mjs --demo-ready            -> DEMO-READY: + the full deterministic bar,
//                                                      live-panel gates, loop-safety, git/baseline
//   node scripts/verify.mjs --complete \
//        --expected-baseline-sha <40-hex>           -> COMPLETE: + required-panels-live; binds the
//                                                      baseline tag to the supplied contract SHA
//
// Exit 0 iff RESULT: PASS.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const LOG_DIR = join(ROOT, '.verify-logs');
const BASELINE_TAG = 'observatory-verifier-baseline';

const argv = process.argv.slice(2);
const COMPLETE = argv.includes('--complete');
const DEMO = argv.includes('--demo-ready') || COMPLETE;
const MODE = COMPLETE ? 'COMPLETE' : DEMO ? 'DEMO-READY' : 'STEP';
const shaIdx = argv.indexOf('--expected-baseline-sha');
const EXPECTED_SHA =
  shaIdx >= 0 && /^[0-9a-f]{40}$/.test(argv[shaIdx + 1] ?? '') ? argv[shaIdx + 1] : null;

mkdirSync(LOG_DIR, { recursive: true });

// ---- check registry (three states: pass / fail / pending) -------------------------------

const checks = [];
function record(name, ok, detail = '') {
  checks.push({ name, status: ok ? 'pass' : 'fail', detail });
}
function recordPending(name, detail) {
  checks.push({ name, status: 'pending', detail });
}

// Run a shell command; PASS iff exit 0 within timeout. Full output -> log file.
function runCheck(name, cmd, timeout = 420000) {
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout });
    writeFileSync(join(LOG_DIR, `${name}.log`), out);
    record(name, true);
  } catch (e) {
    writeFileSync(join(LOG_DIR, `${name}.log`), `${e.stdout ?? ''}\n${e.stderr ?? ''}`);
    const why = e.signal === 'SIGTERM' ? 'TIMEOUT' : 'exit != 0';
    record(name, false, `${why} — see .verify-logs/${name}.log`);
  }
}

// ---- small fs/string helpers ------------------------------------------------------------

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// Strip block + line comments so commented-out code can't satisfy a content grep.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Recursively collect files (relative paths) under `rel` whose name matches `extRe`.
function filesUnder(rel, extRe) {
  const abs = join(ROOT, rel);
  const acc = [];
  if (!existsSync(abs)) return acc;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const childRel = `${rel}/${e.name}`;
    if (e.isDirectory()) acc.push(...filesUnder(childRel, extRe));
    else if (extRe.test(e.name)) acc.push(childRel);
  }
  return acc;
}
const sourceFiles = () => filesUnder('src', /\.(ts|tsx)$/);
const scriptFiles = () => filesUnder('scripts', /\.(mjs|cjs|js|ts)$/);
const jsonFilesUnder = (rel) => filesUnder(rel, /\.json$/);

function q(p) {
  return JSON.stringify(p);
}

// Write a FROZEN emitter snippet to a temp .mts and run it via tsx; return parsed stdout
// JSON. The snippet imports the REAL app modules (absolute paths), so a broken app FAILs the
// gate, while the snippet text — and the assertions that consume it — stay frozen here.
function runEmitter(name, tsSource) {
  const file = join(LOG_DIR, `${name}.emitter.mts`);
  writeFileSync(file, tsSource);
  try {
    const out = execSync(`npx tsx ${q(file)}`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, data: JSON.parse(out) };
  } catch (e) {
    writeFileSync(join(LOG_DIR, `${name}.log`), `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`);
    return { ok: false };
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {
      /* best effort */
    }
  }
}

function git(cmd, timeout = 30000) {
  // stderr piped (captured on throw) rather than inherited, so expected pre-launch git
  // failures (missing tag / no upstream) don't leak noise into the transcript.
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitCheck(name, fn) {
  try {
    record(name, fn() === true);
  } catch (e) {
    // Collapse whitespace so a multi-line git error stays on the gate's single line.
    record(name, false, String(e.message ?? e).replace(/\s+/g, ' ').trim().slice(0, 70));
  }
}

// ---- STEP gates -------------------------------------------------------------------------

// identity: the scoped grep must find NOTHING. Exit-code aware, fails CLOSED:
// grep exit 1 = no matches (PASS); exit 0 = matches (FAIL); exit >1 = error (FAIL). The
// gitignored raw-* captures are excluded (they may legitimately contain project names);
// scripts/ is excluded (this file holds the denylist itself and would self-match).
function identityCheck() {
  const pattern = 'resolve[ ._-]?ai|resolveai|spot ai';
  const targets = ['src', 'config', 'data', 'PROGRESS.md', 'README.md'].filter((d) =>
    existsSync(join(ROOT, d)),
  );
  try {
    const out = execSync(`grep -rinE --exclude='raw-*' "${pattern}" ${targets.join(' ')}`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
    });
    writeFileSync(join(LOG_DIR, 'identity.log'), out);
    record('identity', false, `${out.trim().split('\n').length} forbidden-string hit(s)`);
  } catch (e) {
    if (e.status === 1) record('identity', true);
    else record('identity', false, `grep error (status ${e.status ?? '?'})`);
  }
}

// toolchain-integrity: the test/build toolchain the gates TRUST (vitest/tsx/vite) must be the
// EXACT versions pinned in the FROZEN package-lock.json, and the installed top-level dep tree must
// be consistent. WHY: node_modules is gitignored, so `git-clean` cannot see a tampered local
// `node_modules/.bin/vitest`; a fake binary could echo ORACLE_RUN_NONCE + write a forged oracle
// result and skip the real oracle entirely (Codex r3 blocker). We do NOT `npm ci` every run (slow/
// fragile); instead we (a) freeze package-lock.json (FROZEN_FILES) so the pins can't move, and
// (b) refuse to trust any resolved binary whose `--version` != the locked version, or a dep tree
// npm reports as missing/invalid/extraneous. OPERATOR ASSUMPTION (documented in PROGRESS.md): deps
// are installed from the frozen lockfile (`npm ci`); this gate verifies that, rather than trusting
// whatever happens to sit in node_modules.
const TOOLCHAIN_PINS = ['vitest', 'tsx', 'vite'];
function lockedVersion(lock, name) {
  return lock?.packages?.[`node_modules/${name}`]?.version ?? null;
}
function resolvedBinVersion(name) {
  const bin = join(ROOT, 'node_modules', '.bin', name);
  if (!existsSync(bin)) return { error: `node_modules/.bin/${name} missing (run \`npm ci\`)` };
  try {
    const out = execSync(`${q(bin)} --version`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // First semver-shaped token is the tool's own version (vitest/4.1.9 …, tsx v4.22.4, vite/8.1.0).
    const m = out.match(/\d+\.\d+\.\d+[-\w.]*/);
    return m ? { version: m[0] } : { error: `${name} --version unparseable` };
  } catch {
    return { error: `${name} --version failed (corrupt/incompatible binary?)` };
  }
}
function toolchainIntegrityCheck() {
  const lock = readJson(join(ROOT, 'package-lock.json'));
  if (!lock) {
    record('toolchain-integrity', false, 'package-lock.json unreadable');
    return;
  }
  const fails = [];
  const summary = [];
  for (const name of TOOLCHAIN_PINS) {
    const pin = lockedVersion(lock, name);
    if (!pin) {
      fails.push(`${name}: no version pinned in package-lock.json`);
      continue;
    }
    const got = resolvedBinVersion(name);
    if (got.error) {
      fails.push(got.error);
      continue;
    }
    if (got.version !== pin) fails.push(`${name} binary ${got.version} != locked ${pin}`);
    else summary.push(`${name}@${pin}`);
  }
  // Dep-tree consistency: `npm ls` exits non-zero if a listed dep is missing/invalid/extraneous.
  try {
    const out = execSync(`npm ls ${TOOLCHAIN_PINS.join(' ')} --depth=0`, {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120000,
    });
    writeFileSync(join(LOG_DIR, 'toolchain-integrity.log'), out);
  } catch (e) {
    writeFileSync(join(LOG_DIR, 'toolchain-integrity.log'), `${e.stdout ?? ''}\n${e.stderr ?? ''}`);
    fails.push('npm ls reports an inconsistent dep tree — see .verify-logs/toolchain-integrity.log');
  }
  record('toolchain-integrity', fails.length === 0, fails.slice(0, 3).join('; ') || summary.join(' · '));
}

// ---- DEMO-READY: deterministic data + static gates --------------------------------------

// data-richness: the committed synthetic snapshot must be substantial and fully priced.
function dataRichnessCheck() {
  const snap = readJson(join(ROOT, 'data/fixtures/synthetic-snapshot.json'));
  const card = readJson(join(ROOT, 'rateCard.json'));
  if (!snap || !card) {
    record('data-richness', false, 'snapshot or rateCard unreadable');
    return;
  }
  const recs = snap.records ?? [];
  const sources = new Set(recs.map((r) => r.source));
  const models = new Set(recs.map((r) => r.model));
  const days = new Set(recs.map((r) => r.date));
  const fails = [];
  if (sources.size < 3) fails.push(`sources ${sources.size}<3`);
  if (models.size < 4) fails.push(`models ${models.size}<4`);
  if (days.size < 30) fails.push(`days ${days.size}<30`);
  for (const t of ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens']) {
    if (!recs.some((r) => Number(r[t]) > 0)) fails.push(`no nonzero ${t}`);
  }
  const reasoningSources = new Set(recs.filter((r) => Number(r.reasoningTokens) > 0).map((r) => r.source));
  const nonCodex = [...reasoningSources].filter((s) => s !== 'codex');
  if (nonCodex.length) fails.push(`reasoning on non-codex source(s): ${nonCodex.join(',')}`);
  if (!reasoningSources.has('codex')) fails.push('codex carries no reasoning tokens');
  const priced = new Set(Object.keys(card.rates ?? {}));
  const unpriced = [...models].filter((m) => !priced.has(m));
  if (unpriced.length) fails.push(`unpriced model(s): ${unpriced.join(',')}`);
  record(
    'data-richness',
    fails.length === 0,
    fails.slice(0, 4).join('; ') || `${sources.size} sources · ${models.size} models · ${days.size} days`,
  );
}

// byte-stability: regenerate the snapshot, then it must be unchanged (deterministic output).
function byteStabilityCheck() {
  try {
    execSync('npm run data:generate', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 120000 });
  } catch (e) {
    writeFileSync(join(LOG_DIR, 'byte-stability.log'), `${e.stdout ?? ''}\n${e.stderr ?? ''}`);
    record('byte-stability', false, 'data:generate failed');
    return;
  }
  const diff = git('status --porcelain data/fixtures/synthetic-snapshot.json');
  record('byte-stability', diff === '', diff ? 'regeneration changed committed synthetic-snapshot.json' : '');
}

// clock-determinism: range/aggregation app logic must not read wall-clock or local-tz date
// APIs (ranges anchor to snapshot.asOf, UTC-only). Static ban over src/ app code; the
// synthetic data-generator and test-support are exempt (not range logic).
function clockDeterminismCheck() {
  const EXEMPT = new Set(['src/domain/syntheticSnapshot.ts']);
  const files = sourceFiles().filter(
    (rel) => !EXEMPT.has(rel) && !rel.startsWith('src/test-support/') && !/\.test\.|\.demo\.test\./.test(rel),
  );
  const BANNED = [
    [/\bDate\.now\s*\(/, 'Date.now()'],
    [/\bnew\s+Date\b/, 'new Date'],
    [/\bDate\.parse\b/, 'Date.parse'],
    [/\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds)\s*\(/, 'local Date getter'],
    [/toLocale(Date|Time)?String/, 'toLocale*String'],
    [/\bIntl\.DateTimeFormat\b/, 'Intl.DateTimeFormat'],
  ];
  const hits = [];
  for (const rel of files) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    for (const [re, label] of BANNED) if (re.test(code)) hits.push(`${rel}: ${label}`);
  }
  record('clock-determinism', hits.length === 0, hits.slice(0, 3).join('; '));
}

// money-encoding: no numeric money in our committed data JSON. rateCard rates must be
// base-10 integer strings; anywhere else, a numeric value under a cost/pico/usd key FAILs.
// The wire-format decoder envelopes are exempt (ccusage emits float cost; the decoder
// discards it), as is ccusage.version.json.
const MONEY_KEY_RE = /cost|pico|usd/i;
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function walkMoney(node, path, file, fails) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkMoney(v, `${path}[${i}]`, file, fails));
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [k, v] of Object.entries(node)) {
    const here = path ? `${path}.${k}` : k;
    if (typeof v === 'number' && MONEY_KEY_RE.test(k)) {
      fails.push(`${file}: "${here}" is numeric money (${v}) — use a base-10 integer string`);
    }
    walkMoney(v, here, file, fails);
  }
}
function moneyEncodingCheck() {
  const fails = [];
  const card = readJson(join(ROOT, 'rateCard.json'));
  if (!card) {
    fails.push('rateCard.json unreadable');
  } else {
    if (card.unit !== 'picoUsdPerToken') fails.push(`rateCard unit "${card.unit}" != picoUsdPerToken`);
    for (const [model, bands] of Object.entries(card.rates ?? {})) {
      for (const band of bands ?? []) {
        for (const f of ['input', 'output', 'cacheCreation', 'cacheRead', 'reasoning']) {
          const val = band?.[f];
          if (typeof val !== 'string' || !/^\d+$/.test(val)) {
            fails.push(`rateCard.${model}.${f} = ${JSON.stringify(val)} (must be a base-10 integer string)`);
          }
        }
      }
    }
  }
  const candidates = ['rateCard.json', ...jsonFilesUnder('data/fixtures'), ...jsonFilesUnder('config')].filter(
    (rel) =>
      rel === 'rateCard.json' ||
      rel.startsWith('config/') ||
      (rel.startsWith('data/fixtures/') &&
        // decoder/ + raw-* are wire-format captures (ccusage emits float cost, which the
        // decoder discards); ccusage.version.json is a version pin, not money data.
        !rel.startsWith('data/fixtures/decoder/') &&
        !/\/raw-[^/]*$/.test(rel) &&
        rel !== 'data/fixtures/ccusage.version.json'),
  );
  for (const rel of candidates) {
    const j = readJson(join(ROOT, rel));
    if (j) walkMoney(j, '', rel, fails);
  }
  record('money-encoding', fails.length === 0, fails.slice(0, 3).join('; '));
}

// import-boundary: src/** production code may not import any verifier fixture (goldens /
// oracle / scale), rateCard.json may be imported ONLY from the normalizer/data-provider path,
// and the frozen synthetic snapshot may be imported ONLY by the FixturesDataSource backend —
// so a panel can neither read the answer key, detect which card is active, nor bypass the
// injected `DataSource` seam by computing straight from the frozen fixture (Codex r3 major).
function importBoundaryCheck() {
  const FORBIDDEN_FIXTURE = /(expected-normalized|normalization-input|panel-golden|scale-factors|oracle-ledger)/;
  const RATECARD = /rateCard\.json/;
  const RATECARD_ALLOW = /^src\/(data|domain\/rateCard)/;
  // The committed synthetic snapshot is the data BEHIND the DataSource seam. Only the fixtures
  // backend may import it directly; every other src file must read snapshot data via the
  // injected `DataSource` (so the oracle's scaled/alternate sources actually reach the panel).
  const SNAPSHOT = /synthetic-snapshot\.json/;
  const SNAPSHOT_ALLOW = 'src/data/FixturesDataSource.ts';
  const fails = [];
  for (const rel of sourceFiles()) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    const specs = [...code.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specs) {
      if (FORBIDDEN_FIXTURE.test(s)) fails.push(`${rel} imports verifier fixture: ${s}`);
      if (RATECARD.test(s) && !RATECARD_ALLOW.test(rel)) {
        fails.push(`${rel} imports rateCard.json outside the normalizer/data-provider path`);
      }
      if (SNAPSHOT.test(s) && rel !== SNAPSHOT_ALLOW) {
        fails.push(`${rel} imports synthetic-snapshot.json outside the DataSource seam (only ${SNAPSHOT_ALLOW} may)`);
      }
    }
  }
  record('import-boundary', fails.length === 0, fails.slice(0, 3).join('; '));
}

// env-detection-ban: mutable src/** render code must NOT branch on the test/oracle environment.
// verify.mjs injects ORACLE_RUN_NONCE into the WHOLE vitest process and Node globals are exposed
// project-wide, so a panel/app file that reads process.env / import.meta.env / VITEST / NODE_ENV
// could render correct DOM only under the oracle while shipping something else (Codex r3 major).
// There is no legitimate need for env/test detection in panel or app render paths, so we ban it
// across src/** (test + demo-test files exempt) and fail CLOSED on any match.
function envDetectionBanCheck() {
  const BANNED = [
    [/process\.env/, 'process.env'],
    [/import\.meta\.env/, 'import.meta.env'],
    [/import\.meta\.vitest/, 'import.meta.vitest'],
    [/\bORACLE_RUN_NONCE\b/, 'ORACLE_RUN_NONCE'],
    [/\bVITEST\b/, 'VITEST'],
    [/\bNODE_ENV\b/, 'NODE_ENV'],
  ];
  const files = sourceFiles().filter((rel) => !/\.test\.|\.demo\.test\./.test(rel));
  const hits = [];
  for (const rel of files) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    for (const [re, label] of BANNED) if (re.test(code)) hits.push(`${rel}: ${label}`);
  }
  record('env-detection-ban', hits.length === 0, hits.slice(0, 3).join('; ') || `${files.length} src file(s) free of test-env detection`);
}

// no-egress: the app + ingest code may only read locally — no remote URLs / CDN imports /
// remote fonts / non-local fetch. Static scan of src, scripts (except the verifier's own
// git-origin checks), index.html, public. Scans RAW text (a URL in a comment counts too).
function noEgressCheck() {
  const VERIFIER_OWNED = new Set([
    'scripts/verify.mjs',
    'scripts/certify.mjs',
    'scripts/livelock-guard.mjs',
  ]);
  const files = [
    ...sourceFiles(),
    ...scriptFiles().filter((rel) => !VERIFIER_OWNED.has(rel)),
    ...filesUnder('public', /\.(ts|tsx|js|mjs|cjs|html|css)$/),
    ...(existsSync(join(ROOT, 'index.html')) ? ['index.html'] : []),
  ];
  const REMOTE_URL = /\bhttps?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^\s'"`)]+/i;
  const hits = [];
  for (const rel of files) {
    const m = readFileSync(join(ROOT, rel), 'utf8').match(REMOTE_URL);
    if (m) hits.push(`${rel}: ${m[0].slice(0, 50)}`);
  }
  record('no-egress', hits.length === 0, hits.slice(0, 3).join('; '));
}

// script-contract: the frozen package.json script bodies must match exactly (so certify
// can't be laundered through a re-pointed npm script).
const EXPECTED_SCRIPTS = {
  build: 'tsc -b && vite build',
  'test:run': 'vitest run',
  lint: 'eslint . --max-warnings 0',
  ingest: 'node scripts/ingest.mjs',
  'data:generate': 'tsx scripts/data-generate.ts',
  'verify:step': 'node scripts/verify.mjs',
  'verify:demo-ready': 'node scripts/verify.mjs --demo-ready',
  'verify:complete': 'node scripts/verify.mjs --complete',
  'certify:complete': 'node scripts/certify.mjs',
};
function scriptContractCheck() {
  const scripts = readJson(join(ROOT, 'package.json'))?.scripts ?? {};
  const fails = [];
  for (const [k, v] of Object.entries(EXPECTED_SCRIPTS)) {
    if (scripts[k] !== v) fails.push(`${k}: "${scripts[k] ?? '(missing)'}" != "${v}"`);
  }
  record('script-contract', fails.length === 0, fails.slice(0, 3).join('; '));
}

// ccusage-version: package.json + lockfile + ccusage.version.json must agree (pinned).
function ccusageVersionCheck() {
  const pin = readJson(join(ROOT, 'data/fixtures/ccusage.version.json'))?.ccusage;
  const pkg = readJson(join(ROOT, 'package.json'));
  const dep = pkg?.devDependencies?.ccusage ?? pkg?.dependencies?.ccusage;
  const lockV = readJson(join(ROOT, 'package-lock.json'))?.packages?.['node_modules/ccusage']?.version;
  const fails = [];
  if (!pin) fails.push('ccusage.version.json missing ccusage');
  if (dep !== pin) fails.push(`package.json ccusage ${dep} != ${pin}`);
  if (lockV !== pin) fails.push(`lockfile ccusage ${lockV} != ${pin}`);
  record('ccusage-version', fails.length === 0, fails.join('; ') || `pinned ${pin}`);
}

// normalization-golden: run the app's normalizeCost over the frozen input via tsx, and
// assert EXACT BigInt equality (per row + total) with the hand-derived expected golden.
function normalizationGoldenCheck() {
  const expected = readJson(join(ROOT, 'data/fixtures/expected-normalized.json'));
  if (!expected) {
    record('normalization-golden', false, 'expected-normalized.json unreadable');
    return;
  }
  const src = `
import { normalizeCost } from ${q(join(ROOT, 'src/domain/normalizeCost.ts'))};
import { readFileSync } from 'node:fs';
const card = JSON.parse(readFileSync(${q(join(ROOT, 'rateCard.json'))}, 'utf8'));
const input = JSON.parse(readFileSync(${q(join(ROOT, 'data/fixtures/normalization-input.json'))}, 'utf8'));
const rows = input.records.map((r) => ({ date: r.date, source: r.source, project: r.project, model: r.model, costPico: normalizeCost(r, card).toString() }));
const total = rows.reduce((a, r) => a + BigInt(r.costPico), 0n).toString();
process.stdout.write(JSON.stringify({ rows, total, version: card.version }));
`;
  const res = runEmitter('normalization-golden', src);
  if (!res.ok) {
    record('normalization-golden', false, 'normalizeCost emitter failed — see .verify-logs/normalization-golden.log');
    return;
  }
  const got = res.data;
  const fails = [];
  if (got.version !== expected.rateCardVersion) {
    fails.push(`card version ${got.version} != ${expected.rateCardVersion}`);
  }
  // Key by the FULL canonical identity (date, source, project, model) — the same tuple the snapshot
  // sort + carrier keys use — so the frozen gate enforces the same identity the mutable test does.
  const idKey = (r) => `${r.date}|${r.source}|${r.project}|${r.model}`;
  const want = new Map(expected.rows.map((r) => [idKey(r), r.costPico]));
  if (got.rows.length !== expected.rows.length) {
    fails.push(`row count ${got.rows.length} != ${expected.rows.length}`);
  }
  for (const row of got.rows) {
    const key = idKey(row);
    if (!want.has(key)) fails.push(`unexpected row ${key}`);
    else if (row.costPico !== want.get(key)) fails.push(`${key}: ${row.costPico} != ${want.get(key)}`);
  }
  if (got.total !== expected.totalPico) fails.push(`total ${got.total} != ${expected.totalPico}`);
  record('normalization-golden', fails.length === 0, fails.slice(0, 3).join('; ') || 'exact BigInt match');
}

// normalization-property: the finite golden (4 fixed rows) could be special-cased. This runs the
// app's normalizeCost over HUNDREDS of seeded-random (model, date, token-vector) records via tsx
// and checks each against an INDEPENDENT inline Σ tokensᵢ × rateᵢ formula — over the real card AND
// a scaled card (linearity) AND a synthetic TWO-band card (point-in-time band selection) — plus a
// fail-closed check that an unpriced model THROWS. So normalizeCost cannot price arbitrary records
// wrong while still matching the public golden rows.
function normalizationPropertyCheck() {
  const src = `
import { normalizeCost } from ${q(join(ROOT, 'src/domain/normalizeCost.ts'))};
import { readFileSync } from 'node:fs';
const card = JSON.parse(readFileSync(${q(join(ROOT, 'rateCard.json'))}, 'utf8'));

// Independent inline pricing — does NOT import the app's selectBand.
function priceWith(c, rec) {
  const bands = c.rates[rec.model];
  if (!bands) return null;
  const b = bands.find((bd) => bd.effectiveFrom <= rec.date && (bd.effectiveTo === null || rec.date < bd.effectiveTo));
  if (!b) return null;
  return BigInt(rec.inputTokens) * BigInt(b.input)
    + BigInt(rec.outputTokens) * BigInt(b.output)
    + BigInt(rec.cacheCreationTokens) * BigInt(b.cacheCreation)
    + BigInt(rec.cacheReadTokens) * BigInt(b.cacheRead)
    + BigInt(rec.reasoningTokens) * BigInt(b.reasoning);
}
function scaleCard(c, k) {
  const K = BigInt(k);
  const rates = {};
  for (const [m, bands] of Object.entries(c.rates)) {
    rates[m] = bands.map((b) => ({ ...b,
      input: (BigInt(b.input) * K).toString(), output: (BigInt(b.output) * K).toString(),
      cacheCreation: (BigInt(b.cacheCreation) * K).toString(), cacheRead: (BigInt(b.cacheRead) * K).toString(),
      reasoning: (BigInt(b.reasoning) * K).toString() }));
  }
  return { ...c, rates };
}
// mulberry32 — seeded, independent of the app's data generator.
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Representative dates across 2026 (no Date dependency).
const POOL = [];
for (const mo of ['01','02','03','04','05','06','07','08','09','10','11','12']) { POOL.push('2026-' + mo + '-05'); POOL.push('2026-' + mo + '-20'); }

const rng = mulberry32(0xC0FFEE);
const tok = () => Math.floor(rng() * 5000000);
const fails = [];
let n = 0;

// Part A — the REAL rate card: token linearity + scaling, over every priced model.
const models = Object.keys(card.rates);
for (let i = 0; i < 500; i++) {
  const model = models[Math.floor(rng() * models.length)];
  const date = POOL[Math.floor(rng() * POOL.length)];
  const rec = { source: 'codex', model, date, inputTokens: tok(), outputTokens: tok(), cacheCreationTokens: tok(), cacheReadTokens: tok(), reasoningTokens: tok() };
  const want = priceWith(card, rec);
  if (want === null) continue;
  n++;
  let got; try { got = normalizeCost(rec, card); } catch (e) { got = 'THROW:' + e.message; }
  if (typeof got !== 'bigint' || got !== want) fails.push('A ' + model + '@' + date + ': ' + got + ' != ' + want);
  for (const k of [2, 3, 7]) {
    const want2 = want * BigInt(k);
    let g2; try { g2 = normalizeCost(rec, scaleCard(card, k)); } catch (e) { g2 = 'THROW:' + e.message; }
    if (typeof g2 !== 'bigint' || g2 !== want2) fails.push('A x' + k + ' ' + model + '@' + date + ': ' + g2 + ' != ' + want2);
  }
}

// Part B — a synthetic TWO-band card (price change 2026-07-01): point-in-time band selection.
const twoBand = { version: 'prop-2band', asOf: '2026-12-31', unit: 'picoUsdPerToken', rates: {
  mA: [
    { effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01', input: '1000000', output: '2000000', cacheCreation: '500000', cacheRead: '100000', reasoning: '2000000' },
    { effectiveFrom: '2026-07-01', effectiveTo: null,        input: '3000000', output: '6000000', cacheCreation: '1500000', cacheRead: '300000', reasoning: '6000000' },
  ],
} };
for (let i = 0; i < 300; i++) {
  const date = POOL[Math.floor(rng() * POOL.length)];
  const rec = { source: 'codex', model: 'mA', date, inputTokens: tok(), outputTokens: tok(), cacheCreationTokens: tok(), cacheReadTokens: tok(), reasoningTokens: tok() };
  const want = priceWith(twoBand, rec);
  if (want === null) continue;
  n++;
  let got; try { got = normalizeCost(rec, twoBand); } catch (e) { got = 'THROW:' + e.message; }
  if (typeof got !== 'bigint' || got !== want) fails.push('B mA@' + date + ': ' + got + ' != ' + want);
}

// Fail-closed: an unpriced model must THROW (never silently 0).
let threw = false;
try { normalizeCost({ source: 'codex', model: 'no-such-model-xyz', date: '2026-06-01', inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 }, card); } catch { threw = true; }
if (!threw) fails.push('unpriced model did not throw (fail-open)');

process.stdout.write(JSON.stringify({ ok: fails.length === 0, n, fails: fails.slice(0, 6) }));
`;
  const res = runEmitter('normalization-property', src);
  if (!res.ok) {
    record('normalization-property', false, 'property emitter failed — see .verify-logs/normalization-property.log');
    return;
  }
  const d = res.data;
  record(
    'normalization-property',
    d.ok === true,
    d.ok === true
      ? `${d.n} seeded-random records match an independent formula (real + scaled + 2-band cards)`
      : (d.fails ?? []).slice(0, 3).join('; '),
  );
}

// ccusage-decoder-contract: decode the frozen scrubbed per-source envelopes through the
// app's real decoders (via tsx) and check every canonical field against an INDEPENDENT
// reconstruction from the raw envelope (guards PM-006 envelope drift).
// Reserved project sentinels the daily decoders stamp (mirror of src/domain/projects.ts — daily
// envelopes carry no per-project signal, so claude→Unattributed [reconciliation-only], codex/
// openclaw→their tool sentinel). Pinned here so the frozen gate fails on a wrong-project decoder.
const D_UNATTRIBUTED = '__unattributed__';
const D_CODEX = '__codex__';
const D_OPENCLAW = '__openclaw__';
const RECORD_FIELDS = [
  'source',
  'date',
  'project',
  'model',
  'inputTokens',
  'outputTokens',
  'cacheCreationTokens',
  'cacheReadTokens',
  'reasoningTokens',
];
function compareRecords(label, got, want, fails) {
  if (!Array.isArray(got)) {
    fails.push(`${label}: decoder returned no array`);
    return;
  }
  if (got.length !== want.length) {
    fails.push(`${label}: ${got.length} records != expected ${want.length}`);
    return;
  }
  for (let i = 0; i < want.length; i++) {
    for (const f of RECORD_FIELDS) {
      if (got[i][f] !== want[i][f]) fails.push(`${label}[${i}].${f}: ${got[i][f]} != ${want[i][f]}`);
    }
  }
}
function decoderContractCheck() {
  const dir = join(ROOT, 'data/fixtures/decoder');
  const envs = {
    claude: readJson(join(dir, 'claude-daily.json')),
    codex: readJson(join(dir, 'codex-daily.json')),
    openclaw: readJson(join(dir, 'openclaw-daily.json')),
  };
  if (!envs.claude || !envs.codex || !envs.openclaw) {
    record('ccusage-decoder-contract', false, 'decoder fixture(s) missing/unreadable');
    return;
  }
  const src = `
import { decodeClaudeDaily, decodeCodexDaily, decodeOpenclawDaily } from ${q(join(ROOT, 'src/domain/decode.ts'))};
import { readFileSync } from 'node:fs';
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
process.stdout.write(JSON.stringify({
  claude: decodeClaudeDaily(rd(${q(join(dir, 'claude-daily.json'))})),
  codex: decodeCodexDaily(rd(${q(join(dir, 'codex-daily.json'))})),
  openclaw: decodeOpenclawDaily(rd(${q(join(dir, 'openclaw-daily.json'))})),
}));
`;
  const res = runEmitter('ccusage-decoder-contract', src);
  if (!res.ok) {
    record('ccusage-decoder-contract', false, 'decoder emitter failed — see .verify-logs/ccusage-decoder-contract.log');
    return;
  }
  const got = res.data;
  const fails = [];
  // Independent expected reconstruction straight from the raw envelopes.
  const wantClaude = [];
  for (const day of envs.claude.daily) {
    for (const mb of day.modelBreakdowns) {
      wantClaude.push({
        source: 'claude',
        date: day.date,
        project: D_UNATTRIBUTED,
        model: mb.modelName,
        inputTokens: mb.inputTokens,
        outputTokens: mb.outputTokens,
        cacheCreationTokens: mb.cacheCreationTokens,
        cacheReadTokens: mb.cacheReadTokens,
        reasoningTokens: 0,
      });
    }
  }
  const wantCodex = [];
  for (const day of envs.codex.daily) {
    for (const [model, m] of Object.entries(day.models)) {
      wantCodex.push({
        source: 'codex',
        date: day.date,
        project: D_CODEX,
        model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheCreationTokens: m.cacheCreationTokens,
        cacheReadTokens: m.cacheReadTokens,
        reasoningTokens: m.reasoningOutputTokens,
      });
    }
  }
  const wantOpenclaw = [];
  for (const day of envs.openclaw.daily) {
    const model =
      day.modelsUsed.length === 1 ? String(day.modelsUsed[0]).replace('[openclaw] ', '') : '(all)';
    wantOpenclaw.push({
      source: 'openclaw',
      date: day.date,
      project: D_OPENCLAW,
      model,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheCreationTokens: day.cacheCreationTokens,
      cacheReadTokens: day.cacheReadTokens,
      reasoningTokens: 0,
    });
  }
  compareRecords('claude', got.claude, wantClaude, fails);
  compareRecords('codex', got.codex, wantCodex, fails);
  compareRecords('openclaw', got.openclaw, wantOpenclaw, fails);
  const total = wantClaude.length + wantCodex.length + wantOpenclaw.length;
  record('ccusage-decoder-contract', fails.length === 0, fails.slice(0, 3).join('; ') || `${total} records decoded field-by-field`);
}

// ingest gates: ingest is not built yet (Phase 2). Report PENDING rather than fabricate a
// pass; PENDING does not count as a failure. When scripts/ingest.mjs lands, the real drift
// guards run (the exact self-check CLI contract is finalized with ingest in Phase 2).
function ingestGates() {
  if (!existsSync(join(ROOT, 'scripts/ingest.mjs'))) {
    recordPending('ingest-fixture', 'ingest not built (scripts/ingest.mjs absent — Phase 2)');
    recordPending('ingest-argv', 'ingest not built (scripts/ingest.mjs absent — Phase 2)');
    return;
  }
  runCheck('ingest-fixture', 'npm run ingest -- --from-fixture --check', 120000);
  runCheck('ingest-argv', 'node scripts/ingest.mjs --argv-selfcheck', 120000);
}

// ---- DEMO-READY: panel gates (over LIVE panels only — zero at baseline => vacuous) -------

function panelsConfig() {
  const c = readJson(join(ROOT, 'config/panels.json'));
  return c && c.panels ? c : null;
}
// FROZEN required-panel set. verify.mjs is itself frozen (verifier-integrity), so this list
// cannot be shrunk by the loop. It is NOT read from config/panels.json, which the loop edits —
// otherwise the loop could set config.required = ["spendOverview"] and certify "done" with one
// panel (Codex impl-review blocker #1).
const REQUIRED_PANELS = ['spendOverview', 'bySourceModel', 'cacheEfficiency', 'activityFeed'];
const panelsRequired = () => REQUIRED_PANELS;
// FROZEN panel key -> { its canonical route, its source dir under src/panels/ }. The frozen oracle
// already asserts config.route == its frozen REGISTRY route; this binding lets `route-module-binding`
// additionally assert that the MUTABLE src/App.tsx route table renders that route from the panel's
// own module (src/panels/<dir>/…) — so a stray component emitting matching carriers at the route can
// no longer satisfy the gate (Codex r3 major: "frozen-bound to panel module" made real).
const PANEL_MODULE_BINDING = {
  spendOverview: { route: '/', dir: 'spend-overview' },
  bySourceModel: { route: '/by-source-model', dir: 'by-source-model' },
  cacheEfficiency: { route: '/cache-efficiency', dir: 'cache-efficiency' },
  activityFeed: { route: '/activity-feed', dir: 'activity-feed' },
};
function livePanels(cfg) {
  return Object.entries(cfg.panels)
    .filter(([, p]) => p.status === 'live')
    .map(([key, p]) => ({ key, ...p }));
}
function panelDemoFiles(dir) {
  const d = join(ROOT, 'src', 'panels', dir);
  if (!dir || !existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.demo.test.tsx'));
}
// True iff `text` REALLY imports `symbol` from the frozen smoke AND calls it (after
// stripping comments) — a commented-out line or a local shadow decl can't satisfy it.
function importsHarnessSymbol(text, symbol) {
  const s = stripComments(text);
  const imp = new RegExp(
    `import[^;]*\\b${symbol}\\b[^;]*from\\s*['"]@/test-support/observatoryPanelSmoke['"]`,
  );
  const call = new RegExp(`\\b${symbol}\\s*\\(`);
  const localDecl = new RegExp(`(?:function|const|let|var)\\s+${symbol}\\b`);
  return imp.test(s) && call.test(s) && !localDecl.test(s);
}

// Each live panel's demo test must run via the demo vitest config (strong assertions in
// describeLivePanel). Run it only when there is something live.
function panelSmokeCheck(live) {
  if (live.length === 0) {
    record('panel-smoke', true, 'no live panels (vacuous)');
    return;
  }
  runCheck('panel-smoke', 'npx vitest run -c vitest.demo.config.ts', 180000);
}

// Every live panel owns a *.demo.test.tsx (which panel-smoke then runs). Fails CLOSED.
function panelsHaveDemoCheck(live) {
  if (live.length === 0) {
    record('panels-have-demo', true, 'no live panels (vacuous)');
    return;
  }
  const missing = live.filter((p) => panelDemoFiles(p.dir).length === 0).map((p) => p.key);
  record(
    'panels-have-demo',
    missing.length === 0,
    missing.length ? `live panel(s) without *.demo.test.tsx: ${missing.join(', ')}` : `${live.length} live panel(s) gated`,
  );
}

// Each live panel's demo test must actually call describeLivePanel; required panels must
// additionally declare BOTH controls — a trivial passing test must not satisfy the gate.
function demoTestsUseHarnessCheck(live) {
  if (live.length === 0) {
    record('demo-tests-use-harness', true, 'no live panels (vacuous)');
    return;
  }
  const required = new Set(panelsRequired());
  const problems = [];
  for (const p of live) {
    const raws = panelDemoFiles(p.dir).map((f) => readFileSync(join(ROOT, 'src', 'panels', p.dir, f), 'utf8'));
    if (!raws.some((t) => importsHarnessSymbol(t, 'describeLivePanel'))) {
      problems.push(`${p.key} (no real describeLivePanel import+call)`);
      continue;
    }
    if (required.has(p.key)) {
      const both = raws.some((raw) => {
        const m = stripComments(raw).match(/controls\s*:\s*\{([^}]*)\}/);
        return Boolean(m) && /range\s*:\s*true/.test(m[1]) && /source\s*:\s*true/.test(m[1]);
      });
      if (!both) problems.push(`${p.key} (needs controls: { range: true, source: true })`);
    }
  }
  record(
    'demo-tests-use-harness',
    problems.length === 0,
    problems.length ? problems.join('; ') : `${live.length} live panel(s) use the harness`,
  );
}

// route-module-binding: the frozen oracle renders each live panel by NAVIGATING the REAL route
// table in the MUTABLE src/App.tsx, and trusts whatever component answers the route. This gate makes
// the "frozen-bound to panel module" claim real: it statically parses src/App.tsx and asserts that
// each LIVE panel's frozen route is wired to a <Route> whose element is imported from that panel's
// own module dir (src/panels/<dir>/…). So a different component emitting matching carriers at the
// route — without being the panel module — FAILs here (Codex r3 major). Fails CLOSED on any panel
// whose route is missing, points elsewhere, or whose element is not imported from src/panels/<dir>/.
function routeModuleBindingCheck(live) {
  if (live.length === 0) {
    record('route-module-binding', true, 'no live panels (vacuous)');
    return;
  }
  const appPath = join(ROOT, 'src/App.tsx');
  if (!existsSync(appPath)) {
    record('route-module-binding', false, 'src/App.tsx missing');
    return;
  }
  const code = stripComments(readFileSync(appPath, 'utf8'));
  // identifier -> import specifier (default + named, incl. `as` aliases).
  const imports = new Map();
  for (const m of code.matchAll(/import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[3];
    if (m[1]) imports.set(m[1].trim(), spec);
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.split(/\s+as\s+/).pop()?.trim();
        if (name) imports.set(name, spec);
      }
    }
  }
  // route path -> rendered component identifier (non-greedy to the inner element's `/>`).
  const routeComp = new Map();
  for (const tag of code.match(/<Route\b[\s\S]*?\/>/g) ?? []) {
    const pm = tag.match(/path=(?:"([^"]*)"|'([^']*)')/);
    const em = tag.match(/element=\{<\s*([A-Za-z0-9_$]+)/);
    if (pm && em) routeComp.set(pm[1] ?? pm[2], em[1]);
  }
  const fails = [];
  for (const p of live) {
    const bind = PANEL_MODULE_BINDING[p.key];
    if (!bind) {
      fails.push(`${p.key}: no frozen module binding (unknown live panel)`);
      continue;
    }
    if (p.route !== bind.route) {
      fails.push(`${p.key}: config route "${p.route}" != frozen "${bind.route}"`);
      continue;
    }
    const comp = routeComp.get(bind.route);
    if (!comp) {
      fails.push(`${p.key}: no <Route path="${bind.route}"> in src/App.tsx`);
      continue;
    }
    const spec = imports.get(comp);
    if (!spec) {
      fails.push(`${p.key}: route ${bind.route} renders <${comp}> not imported in src/App.tsx`);
      continue;
    }
    if (!new RegExp(`(^|/|@/)panels/${bind.dir}/`).test(spec)) {
      fails.push(`${p.key}: route ${bind.route} renders <${comp}> from "${spec}", not src/panels/${bind.dir}/`);
    }
  }
  record(
    'route-module-binding',
    fails.length === 0,
    fails.slice(0, 3).join('; ') || `${live.length} live route(s) bound to their panel module`,
  );
}

// The FROZEN panel oracle (vitest.oracle.config.ts → tests/oracle/panelOracle.test.tsx) is the
// thing the panel gates TRUST. For every LIVE panel it renders the REAL <AppShell> route at the
// FROZEN route, requires a single visible per-panel root, asserts the raw DOM values within it
// EQUAL an INDEPENDENT recompute from the frozen synthetic snapshot (native-Date windowing + the
// anchored normalizeCost + an independent inline band pick), and proves rate-card coupling + the
// shared-scope (range AND source) nav matrix. Run once per process and memoize, so the three gates
// share the single render pass.
//
// PROVENANCE / FAIL-CLOSED (Codex r2 blocker #1): the result file is written BY the test, so we do
// NOT trust it on its own. We (a) inject a fresh random nonce via ORACLE_RUN_NONCE that the frozen
// oracle echoes into the result, and (b) require the vitest process to EXIT 0. A gate may only go
// green when `ranClean` — exit 0 AND echoed nonce == injected nonce. A forged/stale result, or any
// non-zero oracle run, fails every panel gate closed regardless of the JSON's contents.
let PANEL_ORACLE;
function runPanelOracle(live) {
  if (PANEL_ORACLE !== undefined) return PANEL_ORACLE;
  if (live.length === 0) {
    PANEL_ORACLE = { vacuous: true, ranClean: true };
    return PANEL_ORACLE;
  }
  const resultPath = join(LOG_DIR, 'panel-oracle-result.json');
  try {
    rmSync(resultPath, { force: true });
  } catch {
    /* best effort */
  }
  const nonce = randomBytes(24).toString('hex');
  let exitOk = false;
  try {
    const out = execSync('npx vitest run -c vitest.oracle.config.ts', {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 240000,
      env: { ...process.env, ORACLE_RUN_NONCE: nonce },
    });
    writeFileSync(join(LOG_DIR, 'panel-oracle.log'), out);
    exitOk = true;
  } catch (e) {
    // Non-zero exit = a category failed, the oracle crashed, or the run was tampered with. We keep
    // the log for diagnosis but DO NOT trust any result it may have left behind.
    writeFileSync(join(LOG_DIR, 'panel-oracle.log'), `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`);
  }
  const data = readJson(resultPath);
  const nonceOk = Boolean(data) && data.nonce === nonce;
  PANEL_ORACLE = {
    ranClean: exitOk && nonceOk,
    exitOk,
    nonceOk,
    data: data ?? null,
  };
  return PANEL_ORACLE;
}

// Detail string for a panel gate that cannot trust the oracle run (fail-closed).
function oracleUntrustedDetail(oracle) {
  if (!oracle.exitOk) return 'oracle vitest run exited non-zero — see .verify-logs/panel-oracle.log';
  if (!oracle.nonceOk) return 'oracle result missing/forged (provenance nonce mismatch) — see .verify-logs/panel-oracle.log';
  return 'oracle did not run cleanly — see .verify-logs/panel-oracle.log';
}

// Did the oracle check every currently-live panel? (Guards against a live panel the frozen oracle
// has no spec for, or a crash that skipped one.)
function oracleCoverageGap(live, category) {
  const checked = new Set(category?.panelsChecked ?? []);
  return live.filter((p) => !checked.has(p.key)).map((p) => p.key);
}

// panel-golden: for every live panel, the raw house-style DOM values rendered through the REAL
// route EQUAL the independent snapshot recompute (and, where a hand-derived golden exists,
// equal that too). Real value-equality — NOT coverage — now lives in the frozen oracle.
function panelGoldenCheck(live, oracle) {
  if (live.length === 0) {
    record('panel-golden', true, 'no live panels (vacuous)');
    return;
  }
  if (!oracle.ranClean) {
    record('panel-golden', false, oracleUntrustedDetail(oracle));
    return;
  }
  const v = oracle.data ? oracle.data.values : null;
  if (!v) {
    record('panel-golden', false, 'frozen panel oracle produced no value-equality result — see .verify-logs/panel-oracle.log');
    return;
  }
  const gap = oracleCoverageGap(live, v);
  if (gap.length) {
    record('panel-golden', false, `oracle did not value-check live panel(s): ${gap.join(', ')}`);
    return;
  }
  record(
    'panel-golden',
    v.ok === true,
    v.ok === true ? `${live.length} live panel(s): real-route raw DOM == snapshot recompute` : (v.fails ?? []).slice(0, 3).join('; '),
  );
}

// pipeline-coupling: cost is linear in the rate card. The frozen oracle re-renders each live
// panel's REAL route with the card scaled by the frozen factors and asserts every cost/rate-kind
// raw value scales by exactly k while tokens/count/ratio/percent/date/label stay invariant. Real
// linearity — NOT a fixture length check — now lives in the frozen oracle.
function pipelineCouplingCheck(live, oracle) {
  if (live.length === 0) {
    record('pipeline-coupling', true, 'no live panels (vacuous)');
    return;
  }
  if (!oracle.ranClean) {
    record('pipeline-coupling', false, oracleUntrustedDetail(oracle));
    return;
  }
  const c = oracle.data ? oracle.data.coupling : null;
  if (!c) {
    record('pipeline-coupling', false, 'frozen panel oracle produced no coupling result — see .verify-logs/panel-oracle.log');
    return;
  }
  const gap = oracleCoverageGap(live, c);
  if (gap.length) {
    record('pipeline-coupling', false, `oracle did not couple-check live panel(s): ${gap.join(', ')}`);
    return;
  }
  record(
    'pipeline-coupling',
    c.ok === true,
    c.ok === true ? `${live.length} live panel(s): cost/rate scale with the card, others invariant` : (c.fails ?? []).slice(0, 3).join('; '),
  );
}

// scope-persistence: cross-panel shared scope can only be exercised with >=2 live panels. Below 2
// it is N/A by construction. At >=2, the frozen oracle navigates the REAL nav between EVERY ordered
// pair of live routes and asserts the selected range is SHARED (not per-panel) AND the destination
// is reachable and renders populated — the full matrix, not one demo's presence.
function scopePersistenceCheck(live, oracle) {
  if (live.length < 2) {
    record(
      'scope-persistence',
      true,
      live.length === 0
        ? 'no live panels (vacuous)'
        : 'n/a below 2 live panels (needs a 2nd live destination to test cross-panel scope)',
    );
    return;
  }
  if (!oracle.ranClean) {
    record('scope-persistence', false, oracleUntrustedDetail(oracle));
    return;
  }
  const s = oracle.data ? oracle.data.scopeMatrix : null;
  if (!s) {
    record('scope-persistence', false, 'frozen panel oracle produced no scope-matrix result — see .verify-logs/panel-oracle.log');
    return;
  }
  const gap = oracleCoverageGap(live, s);
  if (gap.length) {
    record('scope-persistence', false, `oracle did not scope-check live panel(s): ${gap.join(', ')}`);
    return;
  }
  record(
    'scope-persistence',
    s.ok === true && s.applicable === true,
    s.ok === true && s.applicable === true
      ? `shared scope persists across the real nav matrix (${live.length} live panels)`
      : (s.fails ?? []).slice(0, 3).join('; ') || 'scope matrix not applicable',
  );
}

// ---- DEMO-READY: loop-safety + provenance -----------------------------------------------

// progress-consistency: no REQUIRED panel may sit in PROGRESS.md's Blocked / Skipped section.
function progressConsistencyCheck() {
  const p = join(ROOT, 'PROGRESS.md');
  if (!existsSync(p)) {
    record('progress-consistency', false, 'PROGRESS.md missing');
    return;
  }
  const md = readFileSync(p, 'utf8');
  const m = md.match(/##\s*Blocked\s*\/\s*Skipped([\s\S]*?)(?:\n##\s|$)/i);
  const section = m ? m[1] : '';
  const parked = panelsRequired().filter((name) => new RegExp(`\\b${name}\\b`).test(section));
  record('progress-consistency', parked.length === 0, parked.length ? `required item(s) parked: ${parked.join(', ')}` : 'no required item parked');
}

const FROZEN_FILES = [
  'scripts/verify.mjs',
  'scripts/certify.mjs',
  'scripts/livelock-guard.mjs',
  // The ingest contract. The `ingest-fixture` / `ingest-argv` gates delegate their assertions to
  // `scripts/ingest.mjs` (which calls these), so freezing the trio stops the loop from weakening
  // the check inside its own toolchain (Codex ingest-review #1: the gate must not be self-certifying).
  // The decoders + normalizer they reuse are already pinned by `ccusage-decoder-contract` /
  // `normalization-golden`; these three were the unfrozen remainder of the real-data path.
  'scripts/ingest.mjs',
  'scripts/ingestArgs.ts',
  'src/domain/buildSnapshot.ts',
  // Frozen buildSnapshot.ts imports the reserved-project sentinels + their kinds/labels from here,
  // and validateSnapshot trusts that truth — so the registry constants must not drift post-baseline.
  'src/domain/projects.ts',
  // Frozen so the loop cannot move the toolchain version pins out from under `toolchain-integrity`
  // (node_modules is gitignored, so a tampered local binary is invisible to git-clean — the gate
  // instead pins vitest/tsx/vite to these locked versions). Codex r3 blocker.
  'package-lock.json',
  'src/test-support/observatoryPanelSmoke.tsx',
  'vitest.demo.config.ts',
  // The frozen panel oracle (the trusted value-equality / pipeline-coupling / scope-matrix gate)
  // + its frozen runner config + its frozen, dedicated setup (so the loop can't inject a
  // vi.mock('@/App')/global hook via the mutable tests/setup.ts — Codex r2 blocker #1). Codex
  // impl-review #2/#3/#4/#5/#6: real per-panel equality and coupling must live in verifier-owned
  // frozen code, not mutable per-panel tests.
  'vitest.oracle.config.ts',
  'tests/oracle/panelOracle.test.tsx',
  'tests/oracle/oracle.setup.ts',
  'rateCard.json',
  'data/fixtures/normalization-input.json',
  'data/fixtures/expected-normalized.json',
  'data/fixtures/panel-golden.json',
  'data/fixtures/scale-factors.json',
  'data/fixtures/oracle-ledger.md',
  'data/fixtures/ccusage.version.json',
  'data/fixtures/decoder/claude-daily.json',
  'data/fixtures/decoder/claude-instances.json',
  'data/fixtures/decoder/codex-daily.json',
  'data/fixtures/decoder/openclaw-daily.json',
  // The pure-resolver attribution contract (0-B) — frozen so the loop can't weaken the project-
  // attribution-contract gate (0-E) by editing its expectations.
  'data/fixtures/project-attribution.json',
  // Frozen so the loop can't edit the synthetic data + its generator together and still pass
  // byte-stability (Codex impl-review major #3).
  'data/fixtures/synthetic-snapshot.json',
  'src/domain/syntheticSnapshot.ts',
  'scripts/data-generate.ts',
];

// Resolve the baseline tag locally; require it pushed (same SHA on origin), an ancestor of
// HEAD, and — when a contract SHA is supplied — equal to it. Returns the local commit or a
// string error.
function resolveBaselineTag() {
  let local;
  try {
    local = git(`rev-parse ${BASELINE_TAG}^{commit}`);
  } catch {
    return { error: `${BASELINE_TAG} tag missing (create + push it pre-launch)` };
  }
  let remote = '';
  try {
    remote = execSync(
      `git ls-remote origin refs/tags/${BASELINE_TAG} "refs/tags/${BASELINE_TAG}^{}"`,
      { cwd: ROOT, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    /* no origin / no such tag — leave remote empty (treated as not pushed) */
  }
  const remoteShas = remote ? remote.split('\n').map((l) => l.split(/\s+/)[0]) : [];
  if (!remoteShas.includes(local)) return { error: `${BASELINE_TAG} not pushed / differs from origin` };
  try {
    execSync(`git merge-base --is-ancestor ${BASELINE_TAG} HEAD`, { cwd: ROOT, stdio: 'ignore' });
  } catch {
    return { error: `${BASELINE_TAG} is not an ancestor of HEAD` };
  }
  if (EXPECTED_SHA && local !== EXPECTED_SHA) {
    return { error: `${BASELINE_TAG} (${local.slice(0, 12)}) != supplied --expected-baseline-sha (${EXPECTED_SHA.slice(0, 12)})` };
  }
  return { local };
}

// baseline-tag: the tag exists, is pushed, is an ancestor of HEAD, and (if supplied) == the
// contract SHA.
function baselineTagCheck() {
  const r = resolveBaselineTag();
  record('baseline-tag', !r.error, r.error ?? (EXPECTED_SHA ? 'tag present, pushed, ancestor, == contract SHA' : 'tag present, pushed, ancestor'));
}

// verifier-integrity: the COMMITTED (HEAD) blob of every frozen file byte-matches the tag.
function verifierIntegrityCheck() {
  const r = resolveBaselineTag();
  if (r.error) {
    record('verifier-integrity', false, r.error);
    return;
  }
  const changed = [];
  for (const f of FROZEN_FILES) {
    try {
      if (git(`rev-parse HEAD:${f}`) !== git(`rev-parse ${BASELINE_TAG}:${f}`)) changed.push(f);
    } catch {
      changed.push(`${f} (missing)`);
    }
  }
  record('verifier-integrity', changed.length === 0, changed.length ? `frozen file(s) changed vs baseline: ${changed.slice(0, 3).join(', ')}` : 'frozen files unmodified');
}

// COMPLETE only: all four required panels must be live.
function requiredPanelsLiveCheck() {
  const cfg = panelsConfig();
  if (!cfg) {
    record('required-panels-live', false, 'config/panels.json unreadable');
    return;
  }
  // Defense: the bar uses the frozen REQUIRED_PANELS, but if the loop tampered config.required
  // to a different set, flag it rather than silently ignore.
  const cfgReq = (Array.isArray(cfg.required) ? [...cfg.required] : []).sort().join(',');
  if (cfgReq !== [...REQUIRED_PANELS].sort().join(',')) {
    record('required-panels-live', false, `config.required ${JSON.stringify(cfg.required)} != frozen REQUIRED_PANELS`);
    return;
  }
  const notLive = REQUIRED_PANELS.filter((k) => cfg.panels[k]?.status !== 'live');
  record('required-panels-live', notLive.length === 0, notLive.length ? `not live: ${notLive.join(', ')}` : 'all 4 required panels live');
}

// ---- livelock failure history -----------------------------------------------------------

// Environment/baseline-state gates are NOT app-logic livelocks: they are expected red until
// the loop commits/pushes/tags, so they never count toward the 3-strike guard.
const ENV_GATES = new Set([
  'git-clean',
  'git-author',
  'git-pushed',
  'baseline-tag',
  'verifier-integrity',
  'required-panels-live',
]);
function appendFailureHistory() {
  const file = join(LOG_DIR, 'failure-history.json');
  let hist = [];
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(j)) hist = j;
  } catch {
    /* start fresh */
  }
  const failures = checks.filter((c) => c.status === 'fail' && !ENV_GATES.has(c.name)).map((c) => c.name);
  hist.push({ ts: new Date().toISOString(), mode: MODE, failures });
  writeFileSync(file, `${JSON.stringify(hist.slice(-20), null, 2)}\n`);
}
function livelockGuardCheck() {
  try {
    execSync('node scripts/livelock-guard.mjs', { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    record('livelock-guard', true);
  } catch (e) {
    writeFileSync(join(LOG_DIR, 'livelock-guard.log'), `${e.stdout ?? ''}\n${e.stderr ?? ''}`);
    record('livelock-guard', false, 'livelock detected (===BLOCKED===) — see .verify-logs/livelock-guard.log');
  }
}

// ---- run --------------------------------------------------------------------------------

runCheck('tests', 'npm run test:run');
runCheck('lint', 'npm run lint', 180000);
runCheck('tsc', 'npx tsc --noEmit', 180000);
identityCheck();
toolchainIntegrityCheck();

if (DEMO) {
  runCheck('build', 'npm run build', 300000);
  dataRichnessCheck();
  byteStabilityCheck();
  clockDeterminismCheck();
  moneyEncodingCheck();
  importBoundaryCheck();
  envDetectionBanCheck();
  noEgressCheck();
  scriptContractCheck();
  ccusageVersionCheck();
  normalizationGoldenCheck();
  normalizationPropertyCheck();
  decoderContractCheck();
  ingestGates();

  const cfg = panelsConfig();
  const live = cfg ? livePanels(cfg) : [];
  panelSmokeCheck(live);
  panelsHaveDemoCheck(live);
  demoTestsUseHarnessCheck(live);
  routeModuleBindingCheck(live);
  const panelOracle = runPanelOracle(live);
  panelGoldenCheck(live, panelOracle);
  pipelineCouplingCheck(live, panelOracle);
  scopePersistenceCheck(live, panelOracle);

  progressConsistencyCheck();
  verifierIntegrityCheck();
  baselineTagCheck();
  gitCheck('git-clean', () => git('status --porcelain') === '');
  gitCheck('git-author', () => git('log -1 --format=%ae') === 'stuart@eastpeak.cc');
  gitCheck('git-pushed', () => git('rev-parse HEAD') === git('rev-parse @{u}'));
  if (COMPLETE) requiredPanelsLiveCheck();

  // Record this run's app-logic failures, then run the (frozen) livelock guard over them.
  appendFailureHistory();
  livelockGuardCheck();
}

const allPass = checks.every((c) => c.status !== 'fail');
const lines = [
  `===VERIFY:${MODE}:BEGIN===`,
  ...checks.map((c) => `${c.name}: ${c.status.toUpperCase()}${c.detail ? ` (${c.detail})` : ''}`),
  `RESULT: ${allPass ? 'PASS' : 'FAIL'}`,
  `===VERIFY:${MODE}:END===`,
];
process.stdout.write(`${lines.join('\n')}\n`);
process.exit(allPass ? 0 : 1);
