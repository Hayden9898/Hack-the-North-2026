import { test, expect } from './test'
import { mockApi } from './fixtures'

test(
  'loading is explicit and a failed replay action never reports success',
  {
    annotation: {
      type: 'expected-api-failure',
      description: 'A deliberate 409 tests action failure and retry.',
    },
  },
  async ({ page }) => {
    await mockApi(page)
    let release: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/runs/run-march', async (route) => {
      await hold
      await route.fallback()
    })
    await page.goto('/runs/run-march')
    await expect(page.getByRole('status', { name: 'Loading execution' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resume execution' })).not.toBeVisible()
    release()
    await page.getByRole('button', { name: 'Resume execution' }).waitFor()
    await page.route('**/api/v1/runs/run-march/replay', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Execution transition rejected' }),
      }),
    )
    await page.getByRole('button', { name: 'Resume execution' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Execution transition rejected' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pause execution' })).not.toBeVisible()
    await expect(page.getByText('641', { exact: true })).toBeVisible()
    await page.unroute('**/api/v1/runs/run-march/replay')
    await page.getByRole('button', { name: 'Resume execution' }).click()
    await expect(page.getByRole('button', { name: 'Pause execution' })).toBeVisible()
  },
)

test('older filter responses cannot replace the latest query', async ({ page }) => {
  await mockApi(page)
  let release: () => void = () => {}
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/runs/run-march/events?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('threat_class') === 'high_risk') await hold
    await route.fallback()
  })
  await page.goto('/events?run=run-march&follow=off')
  await page.getByLabel('Risk classification').selectOption('high_risk')
  await expect(page.getByRole('status', { name: 'Loading events' })).toBeVisible()
  await page.getByLabel('Risk classification').selectOption('suspicious')
  await expect(page.locator('tbody tr').first()).toContainText(/suspicious/i)
  const staleResponse = page.waitForResponse((response) => response.url().includes('threat_class=high_risk'))
  release()
  await staleResponse
  await expect(page.getByLabel('Risk classification')).toHaveValue('suspicious')
  await expect(page.locator('tbody .badge-high_risk')).toHaveCount(0)
  await expect(page.locator('tbody tr').first()).toContainText(/suspicious/i)
})

test('evidence panels trap focus, support keyboard resize, and preserve browser history', async ({
  page,
}) => {
  await mockApi(page)
  await page.goto('/events?run=run-march&account=david_m')
  await page.getByRole('button', { name: 'Inspect event 168338' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCSS('opacity', '1')
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Inspect event 168338' })).toBeFocused()
  await page.goBack()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Filter by exact account' })).toHaveValue('david_m')
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1050 },
]) {
  test(`human review gallery and overflow checks at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mockApi(page)
    for (const [path, heading] of [
      ['/', 'Security overview'],
      ['/sources', 'Log sources'],
      ['/runs', 'Executions'],
      ['/runs/run-march', 'March access review'],
      ['/runs/run-march/incidents/inc-1', 'Sensitive resource access after repeated denials'],
    ]) {
      await test.step(heading, async () => {
        await page.goto(path)
        await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
        await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${path} must not overflow the viewport`,
        ).toBe(true)
        await info.attach(`${heading} — ${viewport.width}px — synthetic data`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      })
    }
  })
}
