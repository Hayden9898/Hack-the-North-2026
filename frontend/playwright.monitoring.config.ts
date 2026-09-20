import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testDir: './e2e-monitoring',
  webServer: {
    command: 'node scripts/preview-monitoring.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { ...process.env, VITE_SENTRY_DSN: 'http://public@127.0.0.1:9999/1' },
  },
})
