import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

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
    setupFiles: ['./tests/setup.ts'],
    // The frozen panel oracle (tests/oracle/**) is the verifier's own gate: it runs under the
    // frozen vitest.oracle.config.ts that scripts/verify.mjs invokes, not the general test gate.
    exclude: ['node_modules/**', 'dist/**', 'tests/oracle/**'],
  },
})
