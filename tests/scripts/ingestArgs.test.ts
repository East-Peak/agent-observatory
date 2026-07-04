import { describe, it, expect } from 'vitest'
import {
  parseIngestArgs,
  IngestArgError,
  DEFAULT_OUT,
  DEFAULT_LEDGER_STORE,
  DEFAULT_PROJECT_MAP,
} from '../../scripts/ingestArgs'

describe('parseIngestArgs', () => {
  it('defaults to a local ledger ingest that writes data/snapshot.json', () => {
    expect(parseIngestArgs([])).toEqual({
      kind: 'ingest',
      source: 'ledger',
      check: false,
      out: DEFAULT_OUT,
      ledgerStore: DEFAULT_LEDGER_STORE,
      projectMap: DEFAULT_PROJECT_MAP,
    })
  })

  it('parses explicit legacy ccusage mode', () => {
    expect(parseIngestArgs(['--from-ccusage'])).toMatchObject({
      source: 'ccusage',
    })
  })

  it('parses the --from-fixture --check gate invocation', () => {
    expect(parseIngestArgs(['--from-fixture', '--check'])).toMatchObject({
      kind: 'ingest',
      source: 'fixture',
      check: true,
      out: DEFAULT_OUT,
    })
  })

  it('short-circuits to the selfcheck plan on --argv-selfcheck', () => {
    expect(parseIngestArgs(['--argv-selfcheck']).kind).toBe('selfcheck')
  })

  it('takes an --out <path> override', () => {
    expect(parseIngestArgs(['--out', '/tmp/x.json']).out).toBe('/tmp/x.json')
  })

  it('takes ledger store and project-map path overrides', () => {
    expect(
      parseIngestArgs([
        '--ledger-store',
        '/tmp/ledger',
        '--project-map',
        '/tmp/map.json',
      ]),
    ).toMatchObject({
      source: 'ledger',
      ledgerStore: '/tmp/ledger',
      projectMap: '/tmp/map.json',
    })
  })

  it('allows --check on a real run (validate without writing)', () => {
    expect(parseIngestArgs(['--check'])).toMatchObject({
      source: 'ledger',
      check: true,
    })
  })

  it('throws on a missing --out value', () => {
    expect(() => parseIngestArgs(['--out'])).toThrow(IngestArgError)
  })

  it('throws on an unknown flag (fail closed)', () => {
    expect(() => parseIngestArgs(['--bogus'])).toThrow(IngestArgError)
  })

  it('throws on a stray positional argument', () => {
    expect(() => parseIngestArgs(['snapshot.json'])).toThrow(IngestArgError)
  })
})
