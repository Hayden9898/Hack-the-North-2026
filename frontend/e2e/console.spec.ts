import { test, expect } from './test'
import AxeBuilder from '@axe-core/playwright'
import { mockApi } from './fixtures'

test('overview uses execution data, accessible structure, and navigable resources', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Security overview' })).toBeVisible()
  await expect(page.getByText('168,338', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sensitive resource access after repeated denials', exact: true }),
  ).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, issue: n.failureSummary })),
    })),
  ).toEqual([])
  await page.screenshot({ path: 'e2e/screenshots/overview.png', fullPage: true })
})

test('event filters, pagination, evidence drawer, focus restoration, and reload', async ({ page }) => {
  await mockApi(page)
  await page.goto('/events?run=run-march')
  await page.getByRole('button', { name: 'Older', exact: true }).click()
  await expect(page).toHaveURL(/before=/)
  await page.getByRole('button', { name: 'Newer', exact: true }).click()
  await expect(page).not.toHaveURL(/before=/)
  await page.getByRole('textbox', { name: 'Filter by exact account' }).fill('david_m')
  await page.getByRole('button', { name: 'Apply account filter', exact: true }).click()
  await page.getByLabel('Risk classification').selectOption('high_risk')
  await expect(page).toHaveURL(/account=david_m/)
  await page.getByRole('button', { name: 'Inspect event 168338' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible()
  await expect(page).toHaveURL(/event=168338/)
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'e2e/screenshots/evidence.png' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Inspect event 168338' })).toBeFocused()
  await page.reload()
  await expect(page.getByLabel('Risk classification')).toHaveValue('high_risk')
  await expect(page.getByRole('textbox', { name: 'Filter by exact account' })).toHaveValue('david_m')
})

test('command menu is keyboard operable and creates an execution with the API', async ({ page }) => {
  const { mutations } = await mockApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Security overview' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog').getByRole('combobox').fill('Create execution')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Create execution', exact: true })).toBeVisible()
  await page.getByLabel('Execution name', { exact: false }).fill('April review')
  await page.getByRole('button', { name: 'Create execution', exact: true }).last().click()
  await expect(page).toHaveURL(/\/runs\/run-march/)
  expect(mutations.find((m) => m.path === '/runs')?.body).toMatchObject({
    name: 'April review',
    dataset_id: 'source-access',
    mode: 'replay',
    speed: 600,
  })
})

test('source upload sends multipart data and opens source detail', async ({ page }) => {
  const { mutations } = await mockApi(page)
  await page.goto('/sources?upload=1')
  await page.getByLabel('Log file', { exact: true }).setInputFiles({
    name: 'access.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('10.0.0.1 - user [20/Mar/2026:16:00:00 +0000] "GET / HTTP/1.1" 200 100'),
  })
  await page.getByRole('button', { name: 'Upload source', exact: true }).click()
  await expect(page).toHaveURL(/\/sources\/source-access/)
  expect(mutations.some((m) => m.path === '/datasets')).toBe(true)
  await expect(page.getByRole('heading', { name: 'Source details' })).toBeVisible()
})

test('execution controls and configuration preserve backend actions', async ({ page }) => {
  const { mutations } = await mockApi(page)
  await page.goto('/runs/run-march')
  await page.getByRole('button', { name: 'Resume execution' }).click()
  await expect(page.getByRole('button', { name: 'Pause execution' })).toBeVisible()
  await expect(page.getByText('641', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Configuration', exact: true }).click()
  await page.getByLabel('Speed multiplier').fill('120')
  await page.getByRole('button', { name: 'Apply speed' }).click()
  await expect(page.getByText('Speed updated', { exact: true })).toBeVisible()
  expect(mutations.map((m) => m.body)).toContainEqual({ action: 'resume' })
  expect(mutations.map((m) => m.body)).toContainEqual({ action: 'speed', speed: 120 })
})

test('incident evidence and historical versions remain inspectable', async ({ page }) => {
  await mockApi(page)
  await page.goto('/runs/run-march/incidents/inc-1')
  await page.getByRole('button', { name: 'Facts & evidence' }).click()
  await page.getByRole('button', { name: 'Show evidence' }).click()
  await expect(page.getByRole('heading', { name: 'Recomputed aggregate proof' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel('Evidence version', { exact: true }).selectOption('1')
  await expect(page.getByText('Historical version', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/version=1/)
  await page.screenshot({ path: 'e2e/screenshots/incident.png', fullPage: true })
  await page.getByRole('button', { name: 'Review & response' }).click()
  await expect(page.getByRole('button', { name: 'Record disposition' })).toBeDisabled()
  await page.getByRole('button', { name: 'Open current version' }).click()
  await expect(page).not.toHaveURL(/version=1/)
})

test('empty workspace has actionable onboarding', async ({ page }) => {
  await mockApi(page, 'empty')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Every investigation starts with evidence.' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Add a log source/ })).toBeVisible()
})

test(
  'API failures never display fabricated metrics or healthy status',
  {
    annotation: {
      type: 'expected-api-failure',
      description: 'Deliberate HTTP 503 responses exercise degraded state.',
    },
  },
  async ({ page }) => {
    await mockApi(page, 'error')
    await page.goto('/')
    await expect(page.getByText('Database unavailable', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('API connected', { exact: true })).not.toBeVisible()
    await expect(page.getByText('168,338', { exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible()
  },
)

test('mobile navigation, table containment, and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Event explorer' })
    .click()
  await expect(page.getByRole('heading', { name: 'Event explorer' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'e2e/screenshots/mobile.png' })
})

test('incident disposition appends an auditable review through the API', async ({ page }) => {
  const { mutations } = await mockApi(page)
  await page.goto('/runs/run-march/incidents/inc-1?view=review')
  await page.getByLabel('reviewer', { exact: true }).fill('Test analyst')
  await page.getByRole('combobox', { name: 'disposition', exact: true }).selectOption('needs_more_evidence')
  await page.getByLabel('reason', { exact: true }).fill('Reviewed raw events; request owner confirmation.')
  await page.getByRole('button', { name: 'Record disposition' }).click()
  await expect(page.getByText('recorded', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Reviewed raw events; request owner confirmation.', { exact: true }),
  ).toBeVisible()
  expect(mutations.find((m) => m.path.endsWith('/feedback'))?.body).toMatchObject({
    reviewer: 'Test analyst',
    disposition: 'needs_more_evidence',
    reason: 'Reviewed raw events; request owner confirmation.',
  })
})

test('resource pages and dialogs have no critical accessibility violations', async ({ page }) => {
  await mockApi(page)
  const routes = [
    ['/sources', 'Log sources'],
    ['/runs', 'Executions'],
    ['/findings?run=run-march&risk=normal', 'Findings'],
    ['/incidents?run=run-march', 'Incidents'],
    ['/detection', 'Detection'],
    ['/integrations', 'Integrations'],
    ['/settings', 'System status'],
  ]
  for (const [route, heading] of routes) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect
      .soft(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) })),
        route,
      )
      .toEqual([])
  }
  await page.goto('/events?run=run-march&event=168338')
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
  const evidence = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(evidence.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  )
  await page.getByRole('separator', { name: 'Resize detail panel' }).focus()
  const width = await page.getByRole('dialog').evaluate((element) => element.getBoundingClientRect().width)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('dialog')).toHaveCSS('width', `${width + 32}px`)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Search resources and commands/ }).click()
  await page.getByRole('dialog').getByRole('combobox').fill('Executions')
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
  const command = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(command.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual(
    [],
  )
})
