import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// FROZEN oracle config: runs ONLY the verifier-owned frozen panel oracle
// (tests/oracle/panelOracle.test.tsx). `scripts/verify.mjs` invokes this directly for the
// `panel-golden` / `pipeline-coupling` / `scope-persistence` gates when any panel is `live`;
// the oracle renders each live panel through the REAL <AppShell> route table, recomputes the
// expected raw DOM from the frozen synthetic snapshot via the verified domain pipeline, and
// writes a machine-readable result to .verify-logs/ that verify.mjs reads. It is the FROZEN
// thing the gate trusts — the loop-authored *.demo.test.tsx are dev-speed only.
//
// setupFiles points at the FROZEN ./tests/oracle/oracle.setup.ts — NOT the mutable
// ./tests/setup.ts — so the loop cannot smuggle a `vi.mock('@/App', …)` / global hook into the
// oracle's process and stub the AppShell out from under the gate (Codex r2 blocker #1).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/oracle/oracle.setup.ts'],
    include: ['tests/oracle/**/*.test.tsx'],
  },
})
