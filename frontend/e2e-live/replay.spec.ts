import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import type {
  Dataset,
  EventRow,
  EventsPage,
  FactResponse,
  Health,
  IncidentDetail,
  IncidentsPage,
  Run,
} from '../src/api'

const sequence = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/known_sequence.json', import.meta.url), 'utf8'),
) as {
  dataset_sha256: string
  events: { line: number; expect_rule: string | null }[]
}

test('canonical completed replay matches the documented evidence through the real UI', async ({
  page,
  request,
  baseURL,
}, info) => {
  const runId = process.env.VERIFY_RUN_ID
  expect(
    runId,
    'Set VERIFY_RUN_ID to the completed replay to inspect. This test never creates data.',
  ).toBeTruthy()
  const target = new URL(baseURL!)
  expect(
    ['127.0.0.1', 'localhost', '[::1]'],
    'Live acceptance currently targets a local operator console only.',
  ).toContain(target.hostname)
  const prefix = `/api/v1/runs/${encodeURIComponent(runId!)}`
  const exceptions: string[] = []
  page.on('pageerror', (error) => exceptions.push(error.message))
  const writes: string[] = []
  page.on('request', (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) writes.push(req.method() + ' ' + req.url())
  })
  async function get<T>(path: string): Promise<T> {
    const response = await request.get(path, { timeout: 15_000 })
    expect(response.status(), `GET ${path}`).toBe(200)
    return response.json() as Promise<T>
  }

  await test.step('API readiness distinguishes optional integrations from core readiness', async () => {
    const health = await get<Health>('/health/ready')
    expect(health.status).toBe('ready')
    expect(health.database.ok).toBe(true)
    expect(health.migrations.ok).toBe(true)
    expect(health.config.ok).toBe(true)
  })

  let run: Run
  await test.step('Selected replay consumed the exact original dataset with the model active', async () => {
    run = await get<Run>(prefix)
    expect(run.mode).toBe('replay')
    expect(run.state, 'Resume the selected replay and let it finish before acceptance.').toBe('completed')
    expect(run.processed_seq).toBe(180800)
    expect(run.admitted_seq).toBe(180800)
    expect(run.backlog).toBe(0)
    expect(run.model_health, 'This gate verifies the model-active handoff, not rules-only fallback.').toBe(
      'active',
    )
    expect(run.model_id).toBeTruthy()
    expect(run.counts.visible?.high_risk).toBe(2)
    expect(run.counts.visible?.suspicious).toBe(36)
    const source = await get<Dataset>(`/api/v1/datasets/${encodeURIComponent(run.dataset_id!)}`)
    expect(source.content_sha256).toBe(sequence.dataset_sha256)
    expect(source.valid_count).toBe(180800)
    expect(source.rejected_count).toBe(0)
    expect(source.import_state).toBe('ready')
  })

  let incidents: IncidentsPage
  await test.step('Exactly three incidents, with the expected rule groups and severities', async () => {
    incidents = await get<IncidentsPage>(`${prefix}/incidents?limit=200`)
    expect(incidents.total).toBe(3)
    expect(incidents.items.map((item) => [...item.rule_ids].sort().join('+')).sort()).toEqual([
      'R1+R4',
      'R2+R5',
      'R3',
    ])
    expect(incidents.items.filter((item) => item.current_class === 'high_risk')).toHaveLength(2)
    expect(incidents.items.every((item) => item.phase === 'visible')).toBe(true)
  })

  await test.step('Rule matches land on the documented source lines, not every model-only marker', async () => {
    const rows: (EventRow & { line_number: number })[] = []
    for (const risk of ['suspicious', 'high_risk']) {
      let after = 0
      for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
        const result = await get<EventsPage>(
          `${prefix}/events?limit=200&threat_class=${risk}&after_seq=${after}`,
        )
        rows.push(...(result.items as (EventRow & { line_number: number })[]))
        if (!result.has_more) break
        expect(result.next_after_seq).toBeGreaterThan(after)
        after = result.next_after_seq
        expect(pageNumber, 'Bound the scan; do not silently accept incomplete pagination.').toBeLessThan(999)
      }
    }
    const matched = rows.filter((row) => row.rule_ids.length)
    const expectedLines = sequence.events
      .filter((row) => row.expect_rule)
      .map((row) => row.line)
      .sort((a, b) => a - b)
    expect(matched.map((row) => row.line_number).sort((a, b) => a - b)).toEqual(expectedLines)
    for (const expected of sequence.events.filter((row) => row.expect_rule)) {
      expect(matched.find((row) => row.line_number === expected.line)?.rule_ids).toContain(
        expected.expect_rule,
      )
    }
    expect(matched.find((row) => row.line_number === 168338)?.rule_ids.sort()).toEqual(['R2', 'R5'])
  })

  await test.step('Live connection and resumption endpoint expose the durable update cursor', async () => {
    const snapshot = await get<{ latest_seq: number }>(`${prefix}/updates/snapshot`)
    expect(snapshot.latest_seq).toBeGreaterThan(0)
    const response = await request.get(`${prefix}/updates?once=true&after=${snapshot.latest_seq}`, {
      timeout: 15_000,
    })
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/event-stream')
    expect(await response.text()).toContain('event: heartbeat')
    await page.goto(`/runs/${encodeURIComponent(runId!)}`)
    await expect(page.getByRole('heading', { name: run.name, exact: true })).toBeVisible()
    await expect(page.getByText('180,800', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.conn')).toContainText('Connected')
  })

  await test.step('The access-change fact recomputes 77 = 77 and renders in the evidence drawer', async () => {
    const incident = incidents.items.find((item) => item.rule_ids.includes('R2'))!
    const detail = await get<IncidentDetail>(
      `${prefix}/incidents/${encodeURIComponent(incident.incident_id)}`,
    )
    const fact = detail.packet?.facts.find((item) => item.kind === 'prior_denials_count' && item.value === 77)
    expect(fact, 'The 77 prior denials must be a real typed fact.').toBeTruthy()
    const query = new URLSearchParams({
      incident_id: incident.incident_id,
      version: String(detail.version.version),
    })
    const proof = await get<FactResponse>(`${prefix}/facts/${encodeURIComponent(fact!.fact_id)}?${query}`)
    expect(proof.aggregate_proof?.recomputed_count).toBe(77)
    expect(proof.aggregate_proof?.recorded_value).toBe(77)
    expect(proof.aggregate_proof?.matches_recorded).toBe(true)
    await page.goto(
      `/runs/${encodeURIComponent(runId!)}/incidents/${encodeURIComponent(incident.incident_id)}?view=evidence&fact=${encodeURIComponent(fact!.fact_id)}`,
    )
    await expect(page.getByRole('heading', { name: 'Recomputed aggregate proof' })).toBeVisible()
    await expect(page.getByText('✓ yes', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1')
    await info.attach('Real evidence proof (may contain sensitive log data)', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
  })

  expect(writes, 'Acceptance must not mutate a real execution.').toEqual([])
  expect(exceptions, 'No browser exceptions in the real workflow.').toEqual([])
  await info.attach('Verified execution identity', {
    body: JSON.stringify(
      {
        run_id: runId,
        dataset_sha256: sequence.dataset_sha256,
        model_id: run!.model_id,
        processed: run!.processed_seq,
        config_hash: run!.config_hash,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })
})
