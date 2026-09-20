import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './test'
import { mockApi, health } from './fixtures'

for (const width of [320, 390, 1440]) {
  test(`welcome page is keyboard accessible and contained at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/welcome')
    await expect(page.getByRole('heading', { name: 'Less noise. More evidence.' })).toBeVisible()
    const badge = page.getByRole('group', { name: 'Interactive operator badge' })
    await badge.focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: 'Reset badge position' }).click()
    await expect
      .poll(async () =>
        badge.evaluate((element) => {
          const box = element.getBoundingClientRect()
          const stage = element.closest('.badge-stage')!.getBoundingClientRect()
          return box.left >= stage.left && box.right <= stage.right
        }),
      )
      .toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(results.violations).toEqual([])
    await info.attach(`Welcome ${width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    await mockApi(page)
    await page.getByRole('link', { name: 'Enter workspace' }).click()
    await expect(page.getByRole('heading', { name: 'Security overview' })).toBeVisible()
  })
}

test('disabled monitoring makes no telemetry requests and cannot imply verified delivery', async ({
  page,
}) => {
  const telemetry: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/envelope/')) telemetry.push(request.url())
  })
  await mockApi(page)
  await page.goto('/integrations')
  await expect(page.getByText('Browser SDK: inactive')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send Sentry diagnostic' })).toBeDisabled()
  expect(telemetry).toEqual([])
})

test('API diagnostic is explicit and queued does not mean delivered', async ({ page }) => {
  await mockApi(page)
  await page.route('**/health/ready', (route) => route.fulfill({ json: { ...health, sentry_active: true } }))
  await page.route('**/api/v1/observability/check', (route) => {
    expect(route.request().method()).toBe('POST')
    return route.fulfill({
      json: {
        status: 'queued',
        event_id: 'synthetic-event',
        check_id: 'synthetic-check',
        delivery_verified: false,
      },
    })
  })
  await page.goto('/integrations')
  await page.getByRole('button', { name: 'Send Sentry diagnostic' }).click()
  await expect(page.getByRole('status')).toContainText('Confirm receipt in Sentry')
  await expect(page.getByRole('status')).toContainText('API event: synthetic-event')
})
