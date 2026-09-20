import type { Page, Route } from '@playwright/test'

// Synthetic, deterministic API fixtures used only by browser tests.
// The application never imports this module or falls back to these records.
export const source = {
  dataset_id: 'source-access',
  content_sha256: 'a'.repeat(64),
  original_name: 'cse-http-access.log',
  bytes: 29844212,
  import_state: 'ready',
  progress_line: 180800,
  progress_bytes: 29844212,
  total_lines: 180800,
  valid_count: 180800,
  rejected_count: 0,
  first_event_time: '2025-08-01T00:00:00Z',
  last_event_time: '2026-03-31T23:59:00Z',
  stats: { users: 124 },
  error: null,
  created_at: '2026-09-19T10:00:00Z',
  rejects_sample: [],
}
export const run = {
  run_id: 'run-march',
  name: 'March access review',
  dataset_id: source.dataset_id,
  source_id: null,
  mode: 'replay',
  phase: 'visible',
  state: 'paused',
  model_id: 'isolation-forest-v1',
  model_health: 'active',
  config_hash: 'f17b43a0b9dce106',
  reference_hash: 'bed418f271',
  feature_version: 'v1',
  visible_start: '2026-03-01T00:00:00Z',
  range_start: '2025-08-01T00:00:00Z',
  range_end: '2026-03-31T23:59:00Z',
  admitted_seq: 180800,
  processed_seq: 168338,
  backlog: 12462,
  last_admitted_time: '2026-03-20T16:31:00Z',
  last_processed_time: '2026-03-20T16:30:00Z',
  virtual_time: '2026-03-20T16:30:00Z',
  speed: 600,
  block_reason: null,
  blocked_seq: null,
  late_count: 0,
  notifications_sent: 0,
  pause_at_visible_start: false,
  integrations: { sentry: 'disabled_no_dsn', llm: 'deterministic_only_no_key', slack: 'preview' },
  counts: {
    visible: { normal: 12585, suspicious: 641, high_risk: 28 },
    incidents: { high_risk: 4, suspicious: 8 },
  },
  created_at: '2026-09-19T11:26:00Z',
  updated_at: '2026-09-19T12:48:00Z',
}
export const health = {
  status: 'ready',
  database: { ok: true, detail: 'Connected' },
  migrations: { current: '0003', head: '0003', ok: true },
  config: { ok: true, hash: run.config_hash },
  models: { artifacts: ['isolation-forest-v1'] },
  integrations: run.integrations,
  sentry_active: false,
  degraded_modes: ['sentry_disabled', 'llm_deterministic_only', 'slack_preview'],
}
export const events = Array.from({ length: 160 }, (_, i) => ({
  run_seq: 168338 - i,
  event_id: `event-${168338 - i}`,
  event_time: new Date(Date.parse('2026-03-20T16:30:00Z') - i * 45000).toISOString(),
  phase: i < 150 ? 'visible' : 'warmup',
  threat_class: i % 13 === 0 ? 'high_risk' : i % 3 === 0 ? 'suspicious' : 'normal',
  processing_status: 'processed',
  model_score: 0.71 - i * 0.001,
  anomaly_percentile: i % 3 === 0 ? 99.94 : 32.7,
  model_flagged: i % 3 === 0,
  model_health: 'active',
  reason_codes: i % 3 === 0 ? ['access_change'] : [],
  rule_ids: i % 13 === 0 ? ['R2', 'R5'] : i % 3 === 0 ? ['R1'] : [],
  top_deviations: [],
  username: ['david_m', 'sarah_j', 'alex_chen', 'emily_w', 'michael_k'][i % 5],
  ip_raw: `10.0.0.${17 + (i % 6)}`,
  method: i % 4 === 0 ? 'POST' : 'GET',
  path: ['/admin/users', '/api/documents/financial-report', '/login', '/forum/thread/1442', '/api/profile'][
    i % 5
  ],
  status: i % 6 === 0 ? 403 : i % 4 === 0 ? 401 : 200,
  response_bytes: 2451,
  route_family: 'sensitive',
  object_id: null,
  line_number: 168338 - i,
}))
const titles = [
  'Sensitive resource access after repeated denials',
  'Unfamiliar source authentication sequence',
  'Administrative access following forum activity',
  'Repeated failed logins from a new source',
  'Linked account access pattern',
]
export const incidents = Array.from({ length: 12 }, (_, i) => ({
  run_id: run.run_id,
  incident_id: `inc-${i + 1}`,
  key_type: 'account',
  key_value: ['david_m', 'sarah_j', 'alex_chen'][i % 3],
  primary_rule_id: ['R5', 'R4', 'R3', 'R1', 'R2'][i % 5],
  status: i < 8 ? 'open' : 'closed',
  current_version: 2,
  current_class: i < 4 ? 'high_risk' : 'suspicious',
  first_seq: 168290 - i,
  last_seq: 168338 - i,
  first_event_time: '2026-03-20T16:01:00Z',
  last_event_time: new Date(Date.parse('2026-03-20T16:30:00Z') - i * 300000).toISOString(),
  account: ['david_m', 'sarah_j', 'alex_chen'][i % 3],
  ip_raw: '10.0.0.17',
  created_at: run.created_at,
  updated_at: run.updated_at,
  phase: 'visible',
  summary: {
    headline: titles[i % 5],
    class: i < 4 ? 'high_risk' : 'suspicious',
    qualifier: 'A detector identified a change in access behavior. Intent has not been established.',
    lines: ['The account received five denied responses before a successful request to the same resource.'],
    trigger_events: [],
    unknowns: ['authorized_change_record_unavailable'],
  },
  rule_ids: i === 0 ? ['R2', 'R5'] : [['R4'], ['R1'], ['R3']][i % 3],
  evidence_strength: {
    legs_present: true,
    evaluation_incomplete: false,
    missing_evidence: [],
    distinct_evidence_events: 6 + i,
  },
  evidence_count: 6 + i,
  delivery_states: 'preview',
  explanation_state: 'fallback',
}))
const fact = {
  fact_id: 'fact-denials',
  role: 'trigger',
  kind: 'prior_denials_count',
  args: { account: 'david_m', path: '/admin/users' },
  value: 5,
  cutoff_seq: 168338,
  evidence_event_ids: ['event-168338'],
  query: { id: 'prior_denials', params: {} },
  provenance_hash: 'abc1234f',
}

export async function mockApi(page: Page, mode: 'normal' | 'empty' | 'error' = 'normal') {
  const mutations: { path: string; body: unknown }[] = []
  const currentRun = structuredClone(run)
  const feedback: unknown[] = []
  const fulfill = (route: Route, data: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  await page.route('**/health/ready', (route) =>
    mode === 'error' ? fulfill(route, { detail: 'Database unavailable' }, 503) : fulfill(route, health),
  )
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const params = url.searchParams
    if (mode === 'error') return fulfill(route, { detail: 'Database unavailable' }, 503)
    if (request.method() === 'POST') {
      const body = request.headers()['content-type']?.includes('application/json')
        ? request.postDataJSON()
        : request.postData()
      mutations.push({ path, body })
      if (path === '/runs') return fulfill(route, { ...currentRun, ...body, state: 'created' }, 201)
      if (path === '/datasets') return fulfill(route, source, 202)
      if (path.endsWith('/replay')) {
        if (body.action === 'speed') currentRun.speed = body.speed
        else currentRun.state = body.action === 'pause' ? 'paused' : 'running'
        return fulfill(route, { ...currentRun, counts: {} })
      }
      if (path.endsWith('/feedback')) {
        const item = { ...body, id: 1, version: 2, created_at: run.updated_at }
        feedback.push(item)
        return fulfill(route, item)
      }
      if (path.endsWith('/analytics/refresh'))
        return fulfill(route, {
          refreshed: true,
          buckets: 20,
          duration_ms: 12,
          refreshed_through: run.last_processed_time,
        })
    }
    if (path === '/datasets')
      return fulfill(
        route,
        mode === 'empty'
          ? []
          : [
              source,
              {
                ...source,
                dataset_id: 'source-auth',
                original_name: 'authentication-archive.log',
                valid_count: 48290,
                bytes: 7210300,
              },
            ],
      )
    if (path.startsWith('/datasets/')) return fulfill(route, source)
    if (path === '/runs')
      return fulfill(
        route,
        mode === 'empty'
          ? []
          : [
              currentRun,
              {
                ...run,
                run_id: 'run-baseline',
                name: 'Baseline calibration',
                state: 'completed',
                processed_seq: 156000,
                admitted_seq: 156000,
                created_at: '2026-09-18T08:00:00Z',
              },
              {
                ...run,
                run_id: 'run-archive',
                name: 'Authentication archive',
                state: 'created',
                model_health: 'rules_only',
                processed_seq: 0,
                admitted_seq: 0,
                dataset_id: 'source-auth',
                created_at: '2026-09-17T08:00:00Z',
              },
            ],
      )
    if (path.endsWith('/updates/snapshot')) return fulfill(route, { latest_seq: 0 })
    if (path.endsWith('/updates'))
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: heartbeat\ndata: {}\n\n',
      })
    if (path.endsWith('/analytics/timeseries'))
      return fulfill(route, {
        cutoff_seq: run.processed_seq,
        source: {
          mode: 'aggregate_plus_raw_tail',
          bucket_minutes: 1440,
          materialized_through: '2026-03-19T00:00:00Z',
          refreshed_at: run.updated_at,
          materialized_buckets: 18,
          raw_tail_buckets: 2,
          stale: false,
          last_processed_time: run.last_processed_time,
        },
        rows: Array.from({ length: 35 }, (_, i) => ({
          bucket: new Date(Date.parse('2026-02-14T00:00:00Z') + i * 86400000).toISOString(),
          account: null,
          events:
            2800 +
            Math.round(Math.sin(i * 1.7) * 350) +
            i * 35 +
            (i === 23 ? 2600 : 0) +
            (i === 29 ? 900 : 0),
          c401: 11 + (i % 7),
          c403: 5 + (i % 5),
          response_bytes: '2300291',
          high_risk: i % 5 === 0 ? 2 : 0,
          suspicious: 8 + (i % 9),
        })),
      })
    if (path.endsWith('/analytics/benchmark'))
      return fulfill(route, {
        rows: 35,
        identical_results: true,
        raw_ms: { median: 30, min: 25, max: 34 },
        aggregate_ms: { median: 3, min: 2, max: 4 },
        repeats: 5,
        watermark: run.updated_at,
      })
    if (path.endsWith('/events')) {
      let items = events.filter(
        (e) =>
          (!params.get('account') || e.username === params.get('account')) &&
          (!params.get('threat_class') || e.threat_class === params.get('threat_class')) &&
          (!params.get('phase') || e.phase === params.get('phase')) &&
          (!params.get('before_seq') || e.run_seq < Number(params.get('before_seq'))),
      )
      const limit = Number(params.get('limit') || 50)
      const has_more = items.length > limit
      items = items.slice(0, limit)
      return fulfill(route, {
        cutoff_seq: run.processed_seq,
        items,
        has_more,
        next_after_seq: items.at(-1)?.run_seq ?? 0,
      })
    }
    const eventSeq = path.match(/\/events\/(\d+)$/)?.[1]
    if (eventSeq) {
      const event = events.find((e) => e.run_seq === Number(eventSeq))
      if (!event) return fulfill(route, { detail: 'Event not found' }, 404)
      return fulfill(route, {
        ...event,
        run_id: run.run_id,
        model_id: run.model_id,
        raw_line: `${event.ip_raw} - ${event.username} [20/Mar/2026:16:30:00 +0000] "${event.method} ${event.path} HTTP/1.1" ${event.status} 2451`,
        raw_target: event.path,
        query_keys: [],
        original_time: event.event_time,
        offset_minutes: 0,
        dataset_id: source.dataset_id,
        observed_context: { previous_denials: 5 },
        feature_version: 'v1',
        features: { failure_rate: 0.72 },
        incident_memberships: [{ incident_id: 'inc-1', relation_type: 'trigger', rule_id: 'R5' }],
      })
    }
    if (path.endsWith('/incidents')) {
      const items = incidents.filter(
        (i) =>
          (!params.get('threat_class') || i.current_class === params.get('threat_class')) &&
          (!params.get('status') || i.status === params.get('status')) &&
          (!params.get('phase') || i.phase === params.get('phase')),
      )
      const offset = Number(params.get('offset') || 0)
      return fulfill(route, {
        cutoff_seq: run.processed_seq,
        total: items.length,
        items: items.slice(offset, offset + Number(params.get('limit') || 15)),
      })
    }
    if (path.includes('/facts/'))
      return fulfill(route, {
        fact,
        evidence: [
          {
            ...events[0],
            raw_line: '10.0.0.17 - david_m [20/Mar/2026:16:30:00 +0000] "GET /admin/users HTTP/1.1" 403 2451',
            raw_target: '/admin/users',
            original_time: events[0].event_time,
            dataset_id: source.dataset_id,
          },
        ],
        aggregate_proof: {
          query: fact.query,
          recomputed_count: 5,
          recorded_value: 5,
          matches_recorded: true,
          rows: events.slice(0, 5),
          limit: 50,
          offset: 0,
        },
      })
    const incidentId = path.match(/\/incidents\/(inc-\d+)$/)?.[1]
    if (incidentId) {
      const incident = incidents.find((i) => i.incident_id === incidentId)!
      const version = Number(params.get('version') || 2)
      return fulfill(route, {
        incident,
        version: {
          ...incident,
          version,
          threat_class: version === 1 ? 'suspicious' : incident.current_class,
          rule_ids: version === 1 ? ['R2'] : incident.rule_ids,
          trigger_seq: 168338,
          trigger_event_id: 'event-168338',
          timeline_start: incident.first_event_time,
          timeline_end: incident.last_event_time,
        },
        versions: [1, 2].map((v) => ({
          version: v,
          threat_class: incident.current_class,
          trigger_seq: 168338,
          trigger_event_id: 'event-168338',
          timeline_start: incident.first_event_time,
          timeline_end: incident.last_event_time,
          rule_ids: incident.rule_ids,
          created_at: run.created_at,
        })),
        packet: {
          facts: [fact],
          trigger_fact_ids: [fact.fact_id],
          unknown_codes: ['authorized_change_record_unavailable'],
          completeness: { rules_incomplete: [], listing_truncated: false, max_events: 200 },
        },
        packet_hash: 'sha256:abc1234',
        timeline: events.slice(0, 5).map((e, i) => ({
          ...e,
          relation_type: i ? 'support' : 'trigger',
          rule_id: 'R2',
          added_version: version,
        })),
        relations: [],
        rule_matches: [],
        explanation: null,
        explanation_job: null,
        deliveries: [],
        feedback,
        baseline: {
          total: 1436,
          c401: 8,
          c403: 5,
          ips: 2,
          first_seen: '2025-09-01T00:00:00Z',
          hour_histogram: {
            8: 92,
            9: 152,
            10: 194,
            11: 156,
            12: 110,
            13: 122,
            14: 180,
            15: 142,
            16: 99,
            17: 82,
          },
        },
        playbooks: { applicable: [], selected_by_ai: [], catalog_version: 1 },
        cutoff_seq: run.processed_seq,
        evidence_cutoff_seq: 168338,
        provenance: {
          dataset_id: source.dataset_id,
          dataset_sha256: source.content_sha256,
          dataset_name: source.original_name,
          source_id: null,
          config_hash: run.config_hash,
          reference_hash: run.reference_hash,
          feature_version: run.feature_version,
          model_id: run.model_id,
        },
      })
    }
    if (/^\/runs\/[^/]+$/.test(path))
      return fulfill(
        route,
        path.endsWith('run-baseline')
          ? { ...currentRun, state: 'completed', run_id: 'run-baseline' }
          : currentRun,
      )
    return fulfill(route, { detail: 'No fixture for this endpoint' }, 404)
  })
  return { mutations }
}
