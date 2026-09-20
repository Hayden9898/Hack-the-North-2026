import { expect, test } from '@playwright/test'

const health = {
  status: 'ready',
  database: { ok: true, detail: 'test' },
  migrations: { current: '0005', head: '0005', ok: true },
  config: { ok: true, hash: 'test' },
  models: { artifacts: [] },
  integrations: { sentry: 'disabled_no_dsn', llm: 'deterministic_only_no_key', slack: 'preview' },
  sentry_active: false,
  degraded_modes: [],
}

test('uploads an access-log file as multipart data and shows its queued import state', async ({ page }) => {
  let uploaded = false
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/health/ready', (route) => route.fulfill({ json: health }))
  await page.route('**/api/v1/models', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/runs', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/datasets', async (route) => {
    if (route.request().method() === 'POST') {
      const contentType = route.request().headers()['content-type'] ?? ''
      expect(contentType).toContain('multipart/form-data; boundary=')
      expect(route.request().postDataBuffer()?.toString()).toContain('POST /api/auth/login')
      uploaded = true
      await route.fulfill({
        status: 202,
        json: {
          dataset_id: 'dataset-upload-0001',
          content_sha256: 'a'.repeat(64),
          original_name: 'candidate.log',
          bytes: 91,
          import_state: 'pending',
          progress_line: 0,
          progress_bytes: 0,
          total_lines: null,
          valid_count: 0,
          rejected_count: 0,
          first_event_time: null,
          last_event_time: null,
          stats: {},
          error: null,
          created_at: '2026-09-20T00:00:00Z',
          job: 'queued',
        },
      })
      return
    }
    await route.fulfill({ json: uploaded ? [] : [] })
  })

  await page.goto('/')
  await page.getByLabel('Apache access-log file').setInputFiles({
    name: 'candidate.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('10.0.1.2 - acct [01/Aug/2025:08:00:00 -0400] "POST /api/auth/login HTTP/1.1" 401 88\n'),
  })
  await expect(page.getByText('candidate.log')).toBeVisible()
  await page.getByRole('button', { name: 'Upload and import' }).click()
  await expect(page.getByRole('status')).toContainText('Upload queued for import.')
  expect(uploaded).toBe(true)
  expect(consoleErrors).toEqual([])
})
