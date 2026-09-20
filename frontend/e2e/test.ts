import { test as base, expect } from '@playwright/test'

// Capture evidence for humans and fail on unexpected browser exceptions/console errors.
export const test = base.extend<{ browserEvidence: void }>({
  browserEvidence: [
    async ({ page }, use, info) => {
      const exceptions: string[] = []
      const consoleErrors: string[] = []
      const routeWarnings: string[] = []
      page.on('pageerror', (error) => exceptions.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
        if (message.type() === 'warning' && message.text().includes('HydrateFallback'))
          routeWarnings.push(message.text())
      })
      await use()
      if (!page.isClosed()) {
        await info.attach('Screen at completion', { body: await page.screenshot(), contentType: 'image/png' })
      }
      await info.attach('Browser errors', {
        body: JSON.stringify({ exceptions, consoleErrors }, null, 2),
        contentType: 'application/json',
      })
      expect(exceptions, 'Unexpected JavaScript exceptions').toEqual([])
      expect(routeWarnings, 'Lazy routes must render an explicit startup state').toEqual([])
      const expectedApiFailure = info.annotations.some((a) => a.type === 'expected-api-failure')
      const unexpected = consoleErrors.filter(
        (message) => !(expectedApiFailure && message.startsWith('Failed to load resource:')),
      )
      expect(unexpected, 'Unexpected browser console errors').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }
