import { defineConfig, devices } from '@playwright/test'

// No webServer and no mocked routes: this must inspect the operator's existing running app.
export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  outputDir: 'test-results-live',
  reporter: [
    ['list', { printSteps: true }],
    ['html', { outputFolder: 'playwright-live-report', open: 'never' }],
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || 'test-results-live/results.json' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.VERIFY_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1050 },
    screenshot: 'only-on-failure',
    // Live traces can contain raw HTTP logs. Off by default; never upload them implicitly.
    trace: 'off',
  },
})
