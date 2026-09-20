import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './test'
import { mockApi } from './fixtures'
import { buildCaseBrief } from '../src/caseBrief'
import type { IncidentDetail } from '../src/api'

test('investigation brief links measured claims to proof and exports the selected version', async ({
  page,
}) => {
  const { mutations } = await mockApi(page)
  await page.goto('/runs/run-march/incidents/inc-1?version=1')
  await expect(page.getByRole('heading', { name: 'Investigation brief', exact: true })).toBeVisible()
  await expect(page.getByText('Account identity is not human attribution.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What remains unproven' })).toBeVisible()
  await page.getByRole('button', { name: /5 prior 403 responses.*inspect evidence/ }).click()
  await expect(page.getByRole('heading', { name: 'Recomputed aggregate proof' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /5 prior 403 responses.*inspect evidence/ })).toBeFocused()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download evidence brief (.json)' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('logorder-inc-1-v1.json')
  const brief = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(brief.incident).toMatchObject({ version: 1, classification: 'suspicious', rule_ids: ['R2'] })
  expect(brief.packet_hash).toBe('sha256:abc1234')
  expect(brief.provenance.dataset_sha256).toBe('a'.repeat(64))
  expect(brief.evidence_cutoff_seq).toBe(168338)
  expect(brief.packet.facts[0].value).toBe(5)
  expect(brief).not.toHaveProperty('explanation')
  expect(brief).not.toHaveProperty('feedback')
  expect(brief).not.toHaveProperty('deliveries')
  expect(brief.incident).not.toHaveProperty('current_class')
  expect(brief.timeline[0]).not.toHaveProperty('threat_class')
  expect(mutations).toEqual([])
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations).toEqual([])
  await page.screenshot({ path: 'e2e/screenshots/investigation-brief.png', fullPage: true })
})

test('brief is readable on mobile with reduced motion and untrusted text remains inert', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const response = page.waitForResponse('**/api/v1/runs/run-march/incidents/inc-1')
  await page.goto('/runs/run-march/incidents/inc-1')
  const detail: IncidentDetail = await (await response).json()
  detail.packet!.facts[0].args.path = '<img src=x onerror="window.badEvidence=true">'
  await page.route('**/api/v1/runs/run-march/incidents/inc-1', (route) => route.fulfill({ json: detail }))
  await page.reload()
  await expect(page.getByRole('button', { name: /<img src=x/ })).toBeVisible()
  expect(await page.evaluate(() => Object.hasOwn(window, 'badEvidence'))).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(accessibility.violations).toEqual([])
  await page.screenshot({ path: 'e2e/screenshots/investigation-brief-mobile.png', fullPage: true })
})

test('case export excludes future state and distinguishes unavailable or truncated evidence', async ({
  page,
}) => {
  await mockApi(page)
  const response = page.waitForResponse('**/api/v1/runs/run-march/incidents/inc-1')
  await page.goto('/runs/run-march/incidents/inc-1')
  const detail: IncidentDetail = await (await response).json()
  detail.version.version = 1
  detail.version.rule_ids = ['R2']
  detail.packet!.completeness.listing_truncated = true
  detail.timeline.push({ ...detail.timeline[0], added_version: 2, event_id: 'later-membership' })
  detail.timeline.push({ ...detail.timeline[0], added_version: 1, run_seq: 999999, event_id: 'future-event' })
  detail.rule_matches.push({
    run_seq: 168338,
    rule_id: 'R5',
    event_id: 'same-event-new-rule',
    event_time: '',
    outcome: 'high_risk',
    key_type: '',
    key_value: '',
    legs: [],
    params: {},
  })
  detail.feedback.push({
    id: 10,
    version: 2,
    reviewer: 'PRIVATE-REVIEWER',
    disposition: 'closed',
    reason: 'UNRELATED-LATER-STATE',
    created_at: '',
  })
  const exported = buildCaseBrief(detail)
  expect(exported.timeline.every((event) => event.added_version <= 1 && event.run_seq <= 168338)).toBe(true)
  expect(exported.rule_matches).toEqual([])
  expect(exported.limitations.join(' ')).toContain('truncated')
  expect(JSON.stringify(exported)).not.toContain('PRIVATE-REVIEWER')
  detail.packet = null
  detail.packet_hash = null
  expect(() => buildCaseBrief(detail)).toThrow('An evidence packet is required')
  await page.route('**/api/v1/runs/run-march/incidents/inc-1', (route) => route.fulfill({ json: detail }))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Download evidence brief (.json)' })).toBeDisabled()
  await expect(page.getByText('No explanatory facts are available for this version.')).toBeVisible()
})
