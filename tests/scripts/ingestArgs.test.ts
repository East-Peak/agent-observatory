import { describe, it, expect } from 'vitest';
import { parseIngestArgs, IngestArgError, DEFAULT_OUT } from '../../scripts/ingestArgs';

describe('parseIngestArgs', () => {
  it('defaults to a real ccusage ingest that writes data/snapshot.json', () => {
    expect(parseIngestArgs([])).toEqual({ kind: 'ingest', source: 'ccusage', check: false, out: DEFAULT_OUT });
  });

  it('parses the --from-fixture --check gate invocation', () => {
    expect(parseIngestArgs(['--from-fixture', '--check'])).toEqual({
      kind: 'ingest',
      source: 'fixture',
      check: true,
      out: DEFAULT_OUT,
    });
  });

  it('short-circuits to the selfcheck plan on --argv-selfcheck', () => {
    expect(parseIngestArgs(['--argv-selfcheck']).kind).toBe('selfcheck');
  });

  it('takes an --out <path> override', () => {
    expect(parseIngestArgs(['--out', '/tmp/x.json']).out).toBe('/tmp/x.json');
  });

  it('allows --check on a real run (validate without writing)', () => {
    expect(parseIngestArgs(['--check'])).toMatchObject({ source: 'ccusage', check: true });
  });

  it('throws on a missing --out value', () => {
    expect(() => parseIngestArgs(['--out'])).toThrow(IngestArgError);
  });

  it('throws on an unknown flag (fail closed)', () => {
    expect(() => parseIngestArgs(['--bogus'])).toThrow(IngestArgError);
  });

  it('throws on a stray positional argument', () => {
    expect(() => parseIngestArgs(['snapshot.json'])).toThrow(IngestArgError);
  });
});
