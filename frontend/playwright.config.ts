import { defineConfig } from '@playwright/test'

const reportDir = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? 'playwright-report'
const resultsFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? 'test-results/results.json'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: reportDir, open: 'never' }], ['json', { outputFile: resultsFile }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
