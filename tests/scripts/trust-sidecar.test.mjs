import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('trust-sidecar CLI', () => {
  it('writes data/trust.json from a durable ledger store and backfill metadata', async () => {
    const dir = join(
      tmpdir(),
      `agent-observatory-trust-${process.pid}-${Date.now()}`,
    )
    const store = join(dir, 'ledger')
    await mkdir(store, { recursive: true })

    await writeFile(
      join(store, 'rows.jsonl'),
      `${JSON.stringify({
        allocations: [
          { project_key: 'p_alpha', target_kind: 'repo', cost_pico: '3' },
          {
            project_key: 'overhead_other',
            target_kind: 'overhead',
            cost_pico: '1',
          },
        ],
      })}\n`,
    )
    await writeFile(
      join(store, 'exceptions-current.jsonl'),
      `${JSON.stringify({ code: 'pricing-error' })}\n${JSON.stringify({ code: 'pricing-error' })}\n`,
    )
    const projectMap = join(dir, 'project-map.json')
    await writeFile(
      projectMap,
      JSON.stringify({
        targets: [
          { kind: 'repo', projectKey: 'p_alpha' },
          { kind: 'overhead', projectKey: 'overhead_other' },
        ],
      }),
    )
    const backfillLog = join(dir, 'backfill.log')
    await writeFile(
      backfillLog,
      '[2026-07-04T12:34:00Z] ledger backfill start\n[2026-07-04T12:35:27Z] ledger backfill ok\n',
    )
    const out = join(dir, 'trust.json')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/trust-sidecar.mjs',
      '--ledger-store',
      store,
      '--project-map',
      projectMap,
      '--backfill-log',
      backfillLog,
      '--out',
      out,
      '--generated-at',
      '2026-07-04T12:40:00.000Z',
    ])

    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual({
      generatedAt: '2026-07-04T12:40:00.000Z',
      perProject: {
        p_alpha: { targetKind: 'repo', evidenceShare: 0.75 },
        overhead_other: { targetKind: 'overhead', evidenceShare: 0.25 },
      },
      ledger: {
        lastBackfillAt: '2026-07-04T12:35:27Z',
        exceptionsCurrent: 2,
      },
    })
    expect(JSON.parse(stdout)).toMatchObject({
      out,
      directShare: 0.75,
      overheadShare: 0.25,
      exceptionsCurrent: 2,
    })
  })
})
