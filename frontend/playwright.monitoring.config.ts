import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-monitoring',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-monitoring-report' }],
    [
      'json',
      { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || 'test-results-monitoring/results.json' },
    ],
  ],
  outputDir: 'test-results-monitoring',
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command:
      'npx vite build --outDir dist-monitoring && npx vite preview --outDir dist-monitoring --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    env: {
      VITE_SENTRY_DSN: 'http://public@127.0.0.1:4175/1',
      VITE_SENTRY_TRACES_SAMPLE_RATE: '1',
      VITE_SENTRY_ENVIRONMENT: 'synthetic-test',
      VITE_SENTRY_RELEASE: 'synthetic-test',
    },
  },
})
