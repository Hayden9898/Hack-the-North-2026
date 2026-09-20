import { test, expect } from '../e2e/test'
import { mockApi } from '../e2e/fixtures'

test('real browser SDK emits scrubbed events, navigation traces and structured logs', async ({
  page,
}, info) => {
  const envelopes: string[] = []
  const propagated: string[] = []
  await page.route('**/api/1/envelope/**', async (route) => {
    envelopes.push(route.request().postData() || '')
    await route.fulfill({ json: { id: 'accepted-by-local-test-transport' } })
  })
  await mockApi(page)
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.headers()['sentry-trace'])
      propagated.push(request.url())
  })
  const secret = 'EVIDENCE_DO_NOT_EXPORT_92f3'
  await page.goto(`/events?run=run-march&account=${secret}`)
  await expect(page.getByRole('heading', { name: 'Event explorer', exact: true })).toBeVisible()
  // Wait for the pageload transaction before navigation; no arbitrary sleeps.
  await expect
    .poll(() => envelopes.some((body) => body.includes('"type":"transaction"')), { timeout: 20000 })
    .toBe(true)
  await page.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(page.getByText('Browser SDK: initialized')).toBeVisible()
  await page.getByRole('button', { name: 'Send Sentry diagnostic' }).click()
  await expect(page.getByRole('status')).toContainText('Confirm receipt in Sentry')
  await expect.poll(() => envelopes.some((body) => body.includes('"type":"event"'))).toBe(true)
  await expect.poll(() => envelopes.some((body) => body.includes('"type":"log"'))).toBe(true)
  await page.evaluate(
    (message) =>
      window.dispatchEvent(
        new ErrorEvent('error', {
          message,
          error: new Error(message),
        }),
      ),
    secret,
  )
  await expect.poll(() => envelopes.some((body) => body.includes('"exception"'))).toBe(true)
  const payload = envelopes.join('\n')
  expect(payload).not.toContain(secret)
  expect(payload).not.toContain('david_m')
  expect(payload).not.toContain('raw_line')
  expect(propagated.length, 'Same-origin API calls carry distributed trace headers').toBeGreaterThan(0)
  await info.attach('Synthetic SDK envelopes (local transport only)', {
    body: payload,
    contentType: 'text/plain',
  })
})
