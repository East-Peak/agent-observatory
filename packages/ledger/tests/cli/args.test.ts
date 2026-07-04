import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBackfillArgs } from '../../src/cli/args.js';

describe('parseBackfillArgs', () => {
  it('defaults to the local pull-backfill paths and requires --once', () => {
    expect(parseBackfillArgs(['--once'])).toMatchObject({
      once: true,
      dryRun: false,
      storeDir: join(homedir(), '.local/share/agent-observatory/ledger'),
      transcriptsDir: join(homedir(), '.claude'),
      projectMapPath: join(homedir(), '.config/agent-observatory/project-map.json'),
      rateCardPath: expect.stringMatching(/rateCard\.json$/),
      graceMinutes: 5,
    });
  });

  it('accepts explicit local paths for tests and launchd wrappers', () => {
    expect(
      parseBackfillArgs([
        '--once',
        '--dry-run',
        '--store',
        '/tmp/store',
        '--transcripts-dir',
        '/tmp/claude',
        '--project-map',
        '/tmp/project-map.json',
        '--rate-card',
        '/tmp/rateCard.json',
        '--grace-minutes',
        '0',
        '--exceptions-out',
        '/tmp/exceptions.jsonl',
      ]),
    ).toMatchObject({
      once: true,
      dryRun: true,
      storeDir: '/tmp/store',
      transcriptsDir: '/tmp/claude',
      projectMapPath: '/tmp/project-map.json',
      rateCardPath: '/tmp/rateCard.json',
      graceMinutes: 0,
      exceptionsOut: '/tmp/exceptions.jsonl',
    });
  });

  it('fails closed on unknown flags and missing --once', () => {
    expect(() => parseBackfillArgs([])).toThrow(/--once/);
    expect(() => parseBackfillArgs(['--once', '--surprise'])).toThrow(/unknown option/);
  });
});
