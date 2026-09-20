/**
 * Typed client for the Log & Order API. Shapes mirror the dict keys returned by
 * backend/app/api/{runs,incidents,updates,datasets,health}.py exactly.
 * Same-origin only: `/api/v1/...` and `/health/...`; no tokens, no query-string secrets.
 */

export type ThreatClass = 'normal' | 'suspicious' | 'high_risk'
export type Phase = 'warmup' | 'visible'
export type RunState = 'created' | 'warming' | 'running' | 'paused' | 'completed' | 'blocked'
export type ModelHealth = 'active' | 'pending_load' | 'rules_only' | 'degraded' | 'shadow' | string
export type ExplanationState = 'validated' | 'fallback' | 'rejected'
export type DeliveryState = 'debounce' | 'pending' | 'leased' | 'sent' | 'preview' | 'failed'
export type Disposition = 'confirmed_suspicious' | 'benign_explained' | 'needs_more_evidence' | 'false_positive' | 'closed'

export interface Integrations {
  sentry: string
  llm: string
  slack: string
}

export interface Health {
  status: 'ready' | 'not_ready' | string
  database: { ok: boolean; detail: string | null }
  migrations: { current: string | null; head: string | null; ok: boolean; error?: string }
  config: { ok: boolean; hash: string | null }
  models: { artifacts: string[]; active: string | null }
  integrations: Integrations
  sentry_active: boolean
  degraded_modes: string[]
}

export interface RunCounts {
  warmup?: Record<string, number>
  visible?: Record<string, number>
  incidents?: Record<string, number>
  notifications?: Record<string, number>
  explanation_jobs?: Record<string, number>
  late_events?: number
}

export interface Run {
  run_id: string
  name: string
  dataset_id: string | null
  source_id: string | null
  mode: 'replay' | 'live'
  phase: Phase
  state: RunState
  model_id: string | null
  model_health: ModelHealth
  config_hash: string
  reference_hash: string | null
  feature_version: string
  visible_start: string | null
  range_start: string | null
  range_end: string | null
  admitted_seq: number
  processed_seq: number
  backlog: number
  last_admitted_time: string | null
  last_processed_time: string | null
  virtual_time: string | null
  speed: number
  block_reason: string | null
  blocked_seq: number | null
  late_count: number
  notifications_sent: number
  pause_at_visible_start: boolean
  integrations: Integrations
  counts: RunCounts
  created_at: string
  updated_at: string
}

export interface RunCreateBody {
  dataset_id: string
  mode: 'replay'
  name: string
  visible_start?: string
  speed?: number
  pause_at_visible_start: boolean
  /** Pins a registered model; omitted = the newest active model. Every run scores with rules and the model. */
  model_id?: string
}

export interface Model {
  model_id: string
  feature_version: string
  status: 'candidate' | 'active' | 'shadow' | 'rejected' | string
  threshold: number | null
  reference_hash: string | null
  artifact_sha256: string
  created_at: string
  algorithm: string | null
  threshold_percentile: string | null
  is_default: boolean
  artifact_present: boolean
}

export interface ReplayControlBody {
  action: 'start' | 'pause' | 'resume' | 'speed'
  speed?: number
}

export interface Dataset {
  dataset_id: string
  content_sha256: string
  original_name: string
  bytes: number
  import_state: string
  progress_line: number | null
  progress_bytes: number | null
  total_lines: number | null
  valid_count: number | null
  rejected_count: number | null
  first_event_time: string | null
  last_event_time: string | null
  stats: Record<string, unknown>
  error: string | null
  created_at: string
}

export interface DatasetDetail extends Dataset {
  rejects_sample: { line_number: number; reason: string; raw_input: string }[]
}

export interface ObservabilityCheck {
  status: 'disabled' | 'queued' | 'not_queued'
  event_id: string | null
  check_id: string | null
  delivery_verified: false
}

export type Deviation = Record<string, unknown>

export interface EventRow {
  run_seq: number
  event_id: string
  event_time: string
  phase: Phase
  threat_class: ThreatClass | null
  processing_status: string
  model_score: number | null
  anomaly_percentile: number | null
  model_flagged: boolean | null
  model_health: ModelHealth
  reason_codes: string[]
  rule_ids: string[]
  top_deviations: Deviation[]
  username: string
  ip_raw: string
  method: string
  path: string
  status: number
  response_bytes: number | null
  route_family: string
  object_id: string | null
  line_number: number | null
}

export interface EventsPage {
  cutoff_seq: number
  items: EventRow[]
  next_after_seq: number
  has_more: boolean
}

export interface EventsQuery {
  after_seq?: number
  before_seq?: number
  limit?: number
  threat_class?: ThreatClass | ''
  phase?: Phase | ''
  account?: string
  order?: 'asc' | 'desc'
}

export interface EventDetail extends EventRow {
  run_id: string
  model_id: string | null
  raw_line: string
  raw_target: string | null
  query_keys: string[] | null
  original_time: string | null
  offset_minutes: number | null
  dataset_id: string | null
  observed_context: Record<string, unknown> | null
  feature_version: string | null
  features: Record<string, number> | null
  incident_memberships: { incident_id: string; relation_type: string; rule_id: string | null }[]
}

export interface Summary {
  headline: string
  class: ThreatClass
  qualifier: string
  lines: string[]
  trigger_events: string[]
  unknowns: string[]
}

export interface EvidenceStrength {
  legs_present: boolean
  evaluation_incomplete: boolean
  missing_evidence: string[]
  distinct_evidence_events: number
}

export interface IncidentCore {
  run_id: string
  incident_id: string
  key_type: string
  key_value: string
  primary_rule_id: string
  status: 'open' | 'closed'
  current_version: number
  current_class: ThreatClass
  first_seq: number
  last_seq: number
  first_event_time: string
  last_event_time: string
  account: string | null
  ip_raw: string | null
  created_at: string
  updated_at: string
  phase: Phase
}

export interface IncidentRow extends IncidentCore {
  summary: Summary
  rule_ids: string[]
  evidence_strength: EvidenceStrength
  evidence_count: number
  delivery_states: string | null
  explanation_state: ExplanationState | null
}

export interface IncidentsPage {
  cutoff_seq: number
  total: number
  items: IncidentRow[]
}

export interface IncidentsQuery {
  threat_class?: ThreatClass | ''
  status?: 'open' | 'closed' | ''
  phase?: Phase | ''
  limit?: number
  offset?: number
}

export interface FactQuery {
  id: string
  params?: Record<string, unknown>
}

export interface Fact {
  fact_id: string
  role: 'trigger' | 'support' | 'context'
  kind: string
  args: Record<string, unknown>
  value: unknown
  cutoff_seq: number
  evidence_event_ids: string[]
  query: FactQuery | null
  provenance_hash: string
}

export interface Packet {
  schema_version?: string
  facts: Fact[]
  trigger_fact_ids: string[]
  unknown_codes: string[]
  // rules_incomplete is a list of rule ids in practice (empty = complete); tolerate a boolean too.
  completeness: { rules_incomplete: boolean | string[]; listing_truncated: boolean; max_events: number }
  [k: string]: unknown
}

export interface IncidentVersion {
  version: number
  threat_class: ThreatClass
  trigger_seq: number
  trigger_event_id: string
  timeline_start: string
  timeline_end: string
  rule_ids: string[]
  created_at: string
}

export interface IncidentVersionFull extends IncidentVersion {
  run_id: string
  incident_id: string
  evidence_strength: EvidenceStrength
  summary: Summary
}

export interface TimelineEntry {
  event_id: string
  run_seq: number
  event_time: string
  relation_type: string
  rule_id: string | null
  added_version: number
  username: string
  ip_raw: string
  method: string
  path: string
  status: number
  response_bytes: number | null
  object_id: string | null
  threat_class: ThreatClass | null
  line_number: number | null
}

export interface Relation {
  related_incident_id: string
  relation_type: string
  link_key: string
  created_version: number
  primary_rule_id: string
  current_class: ThreatClass
  account: string | null
  key_value: string
}

export interface RuleMatch {
  run_seq: number
  rule_id: string
  event_id: string
  event_time: string
  outcome: string
  key_type: string
  key_value: string
  legs: unknown
  params: Record<string, unknown>
}

export type HypothesisType =
  | 'possible_account_misuse'
  | 'possible_privilege_abuse'
  | 'possible_forum_mediated_request'
  | 'legitimate_authorized_activity'
  | 'insufficient_evidence'

export interface Hypothesis {
  type: HypothesisType | string
  /** Reviewed, qualified text from the validator's fixed catalogue (server-side). */
  text?: string
  supporting_fact_ids: string[]
  counterevidence_fact_ids: string[]
  unknown_codes: string[]
}

export interface ToolLogEntry {
  tool: string
  args?: Record<string, unknown>
  rows?: number
  error?: string
}

export interface ValidatedExplanation {
  schema_version?: string
  packet_hash?: string
  summary_fact_ids: string[]
  hypotheses: Hypothesis[]
  false_positive_assessment: { status: string; supporting_fact_ids: string[]; missing_evidence_codes: string[] }
  playbook_ids: string[]
  ai_review: string
  ai_review_reason?: string | null
  /** Fact ids the system force-included (counterevidence/context the AI could not omit). */
  forced_inclusions?: string[]
  /** Read-only, cutoff-bounded tool calls the AI made. */
  tool_log?: ToolLogEntry[]
  cached?: boolean
}

export interface Playbook {
  id: string
  title: string
  applicability: { any_rules?: string[]; any_fact_kinds?: string[] }
  uncertainty: string
  required_evidence: string[]
  /** Steps are strings, or {"condition": "step"} objects for conditional steps. */
  proposed_steps: (string | Record<string, string>)[]
  permissions: string | string[]
  impact: string
  verification: string | string[]
  rollback: string | string[]
}

export interface PlaybooksBlock {
  applicable: Playbook[]
  selected_by_ai: string[]
  catalog_version: number
}

// Analytics (Tiger continuous aggregate with raw tail / as-of fallback).
export interface TimeseriesRow {
  bucket: string
  /** null when group_by_account=false (accounts summed) */
  account: string | null
  events: number
  c401: number
  c403: number
  /** bigint sum; serialized as a string by the API */
  response_bytes: number | string
  high_risk: number
  suspicious: number
}

interface TimeseriesSourceCommon {
  /** server-side roll-up that was applied (echoes the request) */
  bucket_minutes?: number
  group_by_account?: boolean
}

export type TimeseriesSource =
  | (TimeseriesSourceCommon & {
      mode: 'aggregate_plus_raw_tail'
      materialized_through: string
      refreshed_at: string
      materialized_buckets: number
      raw_tail_buckets: number
      stale: boolean
      last_processed_time: string | null
    })
  | (TimeseriesSourceCommon & { mode: 'raw_fallback'; reason: string; stale: true })
  | (TimeseriesSourceCommon & { mode: 'raw_as_of'; as_of_seq: number })

export interface TimeseriesResponse {
  rows: TimeseriesRow[]
  source: TimeseriesSource
  cutoff_seq: number
}

export interface TimeseriesQuery {
  account?: string
  start?: string
  end?: string
  as_of_seq?: number
  force_raw?: boolean
  /** server-side roll-up: 5 | 60 | 1440 */
  bucket_minutes?: 5 | 60 | 1440
  /** false = accounts summed (account is null in rows) */
  group_by_account?: boolean
}

export interface RefreshResponse {
  refreshed: boolean
  reason?: string
  refreshed_through?: string
  buckets?: number
  duration_ms?: number
}

export interface BenchmarkResponse {
  watermark: string | null
  rows: number
  identical_results: boolean
  raw_ms: { median: number; min: number; max: number }
  aggregate_ms: { median: number; min: number; max: number }
  repeats: number
}

export interface Explanation {
  run_id: string
  incident_id: string
  version: number
  packet_hash: string
  prompt_version: string
  model_name: string
  state: ExplanationState
  proposal_raw: unknown
  validated: ValidatedExplanation | null
  rejection_reasons: string[]
  latency_ms: number | null
  tool_calls: number
  created_at: string
}

export interface ExplanationJob {
  state: 'pending' | 'leased' | 'done' | 'failed' | 'superseded'
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
}

export interface Delivery {
  idempotency_key: string
  notification_kind: string
  version: number
  state: DeliveryState
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
  delivery_ambiguous: boolean
  sent_at: string | null
  created_at: string
  preview_text: string | null
}

export interface FeedbackRow {
  id: number
  version: number
  reviewer: string
  disposition: Disposition
  reason: string
  created_at: string
}

export interface Baseline {
  total: number
  c401: number
  c403: number
  ips: number
  first_seen: string | null
  hour_histogram: Record<string, number>
}

export interface IncidentDetail {
  incident: IncidentCore
  version: IncidentVersionFull
  versions: IncidentVersion[]
  packet: Packet | null
  packet_hash: string | null
  timeline: TimelineEntry[]
  relations: Relation[]
  rule_matches: RuleMatch[]
  explanation: Explanation | null
  explanation_job: ExplanationJob | null
  deliveries: Delivery[]
  feedback: FeedbackRow[]
  baseline: Baseline | null
  playbooks?: PlaybooksBlock
  cutoff_seq: number
}

export interface EvidenceLine {
  run_seq: number
  event_id: string
  event_time: string
  username: string
  ip_raw: string
  method: string
  path: string
  status: number
  response_bytes: number | null
  threat_class: ThreatClass | null
  raw_line: string
  raw_target: string | null
  original_time: string | null
  line_number: number | null
  dataset_id: string | null
}

export interface AggregateRow {
  run_seq: number
  event_id: string
  event_time: string
  username: string
  ip_raw: string
  method: string
  path: string
  status: number
  response_bytes: number | null
  line_number: number | null
}

export interface AggregateProof {
  query: FactQuery
  error?: string
  recomputed_count?: number
  recorded_value?: unknown
  matches_recorded?: boolean | null
  rows?: AggregateRow[]
  limit?: number
  offset?: number
}

export interface FactResponse {
  fact: Fact
  evidence: EvidenceLine[]
  aggregate_proof: AggregateProof | null
}

export interface FeedbackBody {
  reviewer: string
  disposition: Disposition
  reason: string
}

// SSE payloads (backend/app/api/updates.py wraps each ui_updates row as {seq, committed_at, ...payload}).
export interface ProgressUpdate {
  seq: number
  committed_at: string
  processed_seq: number
  admitted_seq: number
  last_event_time: string | null
  phase: Phase
  state: RunState
  batch_classes: Record<string, number>
  model_health: ModelHealth
  incidents: Record<string, unknown>[]
}

export interface RunStateUpdate {
  seq: number
  state: RunState
  blocked_seq?: number
  reason?: string
}

// ---------------------------------------------------------------- transport

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? `HTTP ${status}`)
    this.status = status
    this.detail = detail
  }
}

export function describeError(err: unknown): { status: number | null; text: string } {
  if (err instanceof ApiError) {
    const d = err.detail
    let text: string
    if (typeof d === 'string') text = d
    else if (d && typeof d === 'object' && 'error' in d) text = String((d as { error: unknown }).error)
    else if (d && typeof d === 'object') text = JSON.stringify(d)
    else text = err.message
    return { status: err.status, text }
  }
  if (err instanceof Error) return { status: null, text: err.message }
  return { status: null, text: String(err) }
}

// Database availability signal: a 503 anywhere flips the app-level "Database unavailable" banner;
// any later 2xx clears it. The UI never fabricates a healthy feed while the API says otherwise.
type DbListener = (down: boolean) => void
const dbListeners = new Set<DbListener>()
let dbDown = false
export function subscribeDbStatus(cb: DbListener): () => void {
  dbListeners.add(cb)
  cb(dbDown)
  return () => {
    dbListeners.delete(cb)
  }
}
function setDbDown(v: boolean) {
  if (v === dbDown) return
  dbDown = v
  for (const cb of dbListeners) cb(v)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        // Let the browser provide the multipart boundary for streamed file uploads.
        ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    })
  } catch (err) {
    throw new ApiError(0, null, `Network error: ${(err as Error).message}`)
  }
  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) {
    if (res.status === 503) setDbDown(true)
    const detail = body && typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : body
    throw new ApiError(res.status, detail)
  }
  setDbDown(false)
  return body as T
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const API = '/api/v1'
const enc = encodeURIComponent

export const api = {
  health: () => request<Health>('/health/ready'),

  listRuns: () => request<Run[]>(`${API}/runs`),
  getRun: (runId: string) => request<Run>(`${API}/runs/${enc(runId)}`),
  createRun: (body: RunCreateBody) => request<Run>(`${API}/runs`, { method: 'POST', body: JSON.stringify(body) }),
  replay: (runId: string, body: ReplayControlBody) =>
    request<Run>(`${API}/runs/${enc(runId)}/replay`, { method: 'POST', body: JSON.stringify(body) }),

  listModels: () => request<Model[]>(`${API}/models`),

  listDatasets: () => request<Dataset[]>(`${API}/datasets`),
  getDataset: (id: string) => request<DatasetDetail>(`${API}/datasets/${enc(id)}`),
  uploadDataset: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<Dataset & { job: 'queued' | 'existing' }>(`${API}/datasets`, { method: 'POST', body })
  },
  checkObservability: () => request<ObservabilityCheck>(`${API}/observability/check`, { method: 'POST' }),

  listEvents: (runId: string, q: EventsQuery) => request<EventsPage>(`${API}/runs/${enc(runId)}/events${qs({ ...q })}`),
  getEvent: (runId: string, seq: number | string) => request<EventDetail>(`${API}/runs/${enc(runId)}/events/${enc(String(seq))}`),

  listIncidents: (runId: string, q: IncidentsQuery) =>
    request<IncidentsPage>(`${API}/runs/${enc(runId)}/incidents${qs({ ...q })}`),
  getIncident: (runId: string, incidentId: string, version?: number) =>
    request<IncidentDetail>(`${API}/runs/${enc(runId)}/incidents/${enc(incidentId)}${qs({ version })}`),
  getFact: (runId: string, factId: string, incidentId: string, version: number, limit = 50, offset = 0) =>
    request<FactResponse>(`${API}/runs/${enc(runId)}/facts/${enc(factId)}${qs({ incident_id: incidentId, version, limit, offset })}`),
  postFeedback: (runId: string, incidentId: string, body: FeedbackBody) =>
    request<FeedbackRow>(`${API}/runs/${enc(runId)}/incidents/${enc(incidentId)}/feedback`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  timeseries: (runId: string, q: TimeseriesQuery) =>
    request<TimeseriesResponse>(`${API}/runs/${enc(runId)}/analytics/timeseries${qs({ ...q })}`),
  refreshAggregate: (runId: string) => request<RefreshResponse>(`${API}/runs/${enc(runId)}/analytics/refresh`, { method: 'POST' }),
  benchmark: (runId: string, repeats = 5) => request<BenchmarkResponse>(`${API}/runs/${enc(runId)}/analytics/benchmark${qs({ repeats })}`),

  updatesUrl: (runId: string, after?: number | null) => `${API}/runs/${enc(runId)}/updates${qs({ after: after ?? undefined })}`,
  updatesSnapshot: (runId: string) => request<{ latest_seq: number }>(`${API}/runs/${enc(runId)}/updates/snapshot`),
}
