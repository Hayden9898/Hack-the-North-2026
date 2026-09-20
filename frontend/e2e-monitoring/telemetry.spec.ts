import { expect, test } from '@playwright/test'

const health = {
  status: 'ready',
  database: { ok: true, detail: 'test' },
  migrations: { current: '0005', head: '0005', ok: true },
  config: { ok: true, hash: 'test' },
  models: { artifacts: [] },
  integrations: { sentry: 'enabled', llm: 'deterministic_only_no_key', slack: 'preview' },
  sentry_active: true,
  degraded_modes: [],
}

test('queues only a synthetic browser Sentry diagnostic', async ({ page }) => {
  const envelopes: string[] = []
  await page.route('http://127.0.0.1:9999/**', async (route) => {
    envelopes.push(route.request().postData() ?? '')
    await route.fulfill({ status: 200, body: '' })
  })
  await page.route('**/health/ready', (route) => route.fulfill({ json: health }))
  await page.route('**/api/v1/runs', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/datasets', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/observability/check', (route) =>
    route.fulfill({ json: { status: 'queued', event_id: 'server-event', check_id: 'check-id', delivery_verified: false } }),
  )

  await page.goto('/')
  await page.getByRole('button', { name: 'Send Sentry diagnostic' }).click()
  await expect(page.getByRole('status')).toContainText('queued is not delivery verified')
  await expect.poll(() => envelopes.join('\n')).toContain('logorder.observability_check')
  expect(envelopes.join('\n')).not.toContain('raw_log')
})
