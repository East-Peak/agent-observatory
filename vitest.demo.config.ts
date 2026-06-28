import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// FROZEN demo config: runs ONLY the verifier-owned per-panel smoke tests (the
// `*.demo.test.tsx` files that call describeLivePanel / describeScopePersistence). The
// `panel-smoke` gate in scripts/verify.mjs invokes this when any panel is `live`; at the
// zero-live baseline it is not run (the panel gates pass vacuously).
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
    include: ['src/**/*.demo.test.tsx'],
  },
})
