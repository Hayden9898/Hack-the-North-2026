/**
 * Vocabulary and formatting. Wording rules from overview.md:
 * - "normal" means no configured detector flagged this, not a clean verdict.
 * - "high risk" means investigate urgently, not established guilt.
 * - pending/unscored is a processing state, never a fourth class or a green verdict.
 * - model output is a rarity percentile, never a confidence or attack probability.
 */
import type { DeliveryState, Disposition, ExplanationState, ModelHealth, Phase, RunState, ThreatClass } from './api'

export type ClassTone = 'normal' | 'suspicious' | 'high_risk' | 'pending'

export function classTone(threatClass: ThreatClass | null | undefined, processingStatus?: string | null): ClassTone {
  if (threatClass === null || threatClass === undefined) return 'pending'
  if (processingStatus && processingStatus !== 'processed') return 'pending'
  return threatClass
}

export const CLASS_LABEL: Record<ClassTone, string> = {
  normal: 'normal',
  suspicious: 'suspicious',
  high_risk: 'high risk',
  pending: 'pending / unscored',
}

export const CLASS_MEANING: Record<ClassTone, string> = {
  normal: 'No configured detector flagged this event.',
  suspicious: 'A detector flagged this for review; it is not a finding of wrongdoing.',
  high_risk: 'Investigate urgently. This is not established guilt.',
  pending: 'Processing state: not yet scored under the run cutoff. Not a verdict.',
}

export function phaseLabel(phase: Phase | string | null | undefined): string {
  if (phase === 'warmup') return 'historical warmup'
  if (phase === 'visible') return 'visible replay/live'
  return String(phase ?? 'unknown')
}

export function runStateLabel(state: RunState | string): string {
  switch (state) {
    case 'created':
      return 'created (not started)'
    case 'warming':
      return 'warming (building historical state)'
    case 'running':
      return 'running'
    case 'paused':
      return 'paused'
    case 'completed':
      return 'completed'
    case 'blocked':
      return 'blocked'
    default:
      return String(state)
  }
}

export function modelHealthLabel(h: ModelHealth): string {
  switch (h) {
    case 'active':
      return 'model active'
    case 'pending_load':
      return 'model loading'
    case 'rules_only':
      return 'rules-only'
    case 'degraded':
      return 'degraded'
    case 'shadow':
      return 'shadow'
    default:
      return String(h)
  }
}

export function modelHealthExplanation(h: ModelHealth): string | null {
  switch (h) {
    case 'pending_load':
      return 'A model is attached to this run and loads when the detector processes its first batch.'
    case 'rules_only':
      return 'Rules-only mode: this run was created without a model, so no artifact is scoring its events. ML scores are null; rule detections still apply. New runs attach the active model unless rules-only is chosen explicitly.'
    case 'degraded':
      return 'Degraded model mode: model scores may be missing or stale. Rule detections still apply.'
    case 'shadow':
      return 'Shadow mode: the model scores events but does not influence the threat class.'
    default:
      return null
  }
}

export function integrationLabel(kind: 'sentry' | 'llm' | 'slack', value: string): { text: string; tone: 'ok' | 'warn' | 'off' } {
  if (kind === 'sentry') {
    return value === 'enabled' ? { text: 'Sentry enabled', tone: 'ok' } : { text: 'Sentry disabled (no DSN)', tone: 'off' }
  }
  if (kind === 'llm') {
    if (value.startsWith('enabled')) return { text: `AI review ${value.replace('enabled:', '')}`, tone: 'ok' }
    if (value === 'deterministic_only_no_key') return { text: 'AI review: deterministic only (no provider key)', tone: 'off' }
    return { text: `AI review: ${value.replaceAll('_', ' ')}`, tone: 'off' }
  }
  if (value === 'live') return { text: 'Slack live', tone: 'ok' }
  if (value === 'preview') return { text: 'Slack preview (nothing leaves the app)', tone: 'warn' }
  return { text: `Slack ${value.replaceAll('_', ' ')}`, tone: 'warn' }
}

export const DEGRADED_MODE_LABEL: Record<string, string> = {
  sentry_disabled: 'Sentry disabled (no DSN configured)',
  llm_deterministic_only: 'AI review unavailable: deterministic summaries only',
  slack_preview: 'Slack in preview mode: no message leaves the application',
  no_model_artifacts_rules_only: 'No model artifacts on disk: detection is rules-only',
  no_active_model_rules_only: 'No active model registered: new runs are rules-only until one is calibrated with --activate',
}

export function degradedModeLabel(code: string): string {
  return DEGRADED_MODE_LABEL[code] ?? code.replaceAll('_', ' ')
}

export const UNKNOWN_CODE_LABEL: Record<string, string> = {
  credential_source_unknown: 'Who supplied the credentials is not recorded',
  session_identity_unavailable: 'Session identity is not present in these logs',
  authorized_change_record_unavailable: 'No authorization/change record is available to compare against',
  role_change_contents_unavailable: 'The contents of any role change are not recorded',
  request_body_unavailable: 'Request bodies are not recorded',
  user_agent_unavailable: 'User agent is not recorded',
  external_transfer_unproven: 'Whether data left the environment cannot be established',
  object_creator_unknown: 'Who created the forum object is not recorded',
  causal_link_unproven: 'A causal link between the requests is not established',
}

export function unknownLabel(code: string): string {
  return UNKNOWN_CODE_LABEL[code] ?? code.replaceAll('_', ' ')
}

export const HYPOTHESIS_TEXT: Record<string, string> = {
  possible_account_misuse: 'Possible account misuse (unproven): the observed pattern is consistent with someone other than the account owner acting, but the logs do not record who supplied the credentials.',
  possible_privilege_abuse: 'Possible privilege abuse (unproven): the account obtained a response it was previously denied; an approved grant would look identical in these logs.',
  possible_forum_mediated_request: 'Possible forum-mediated request (unproven): a forum object view preceded the request; no causal assertion about the forum content is made.',
  legitimate_authorized_activity: 'Legitimate authorized activity (possible): the observed facts are also consistent with an approved change or normal use.',
  insufficient_evidence: 'Insufficient evidence: the recorded facts do not support a specific explanation either way.',
}

export function hypothesisText(type: string): string {
  return HYPOTHESIS_TEXT[type] ?? `${type.replaceAll('_', ' ')} (AI-suggested, unproven)`
}

export function explanationStateLabel(s: ExplanationState | null | undefined): string {
  if (!s) return 'no AI review'
  if (s === 'validated') return 'AI suggestions validated'
  if (s === 'fallback') return 'AI review unavailable'
  return 'AI proposal rejected'
}

export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = {
  debounce: 'debouncing',
  pending: 'pending',
  leased: 'in flight',
  sent: 'sent',
  preview: 'preview (not sent)',
  failed: 'failed',
}

export const DISPOSITIONS: { value: Disposition; label: string }[] = [
  { value: 'confirmed_suspicious', label: 'Confirmed suspicious (warrants follow-up)' },
  { value: 'benign_explained', label: 'Benign, explained' },
  { value: 'needs_more_evidence', label: 'Needs more evidence' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'closed', label: 'Closed' },
]

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  // Times arrive as ISO-8601 UTC. Show a compact, unambiguous UTC form.
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(iso)
  if (!m) return iso
  const tz = m[4] === 'Z' || !m[4] || m[4] === '+00:00' ? 'Z' : m[4]
  return `${m[1]} ${m[2]}${tz}`
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US')
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

export function fmtPercentile(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—'
  const v = p <= 1 ? p * 100 : p
  return `${v.toFixed(1)}th`
}

export function speedLabel(speed: number | null | undefined): string {
  if (speed === null || speed === undefined) return '—'
  if (speed === 0) return 'fast-forward (unbounded)'
  return `${speed}×`
}

export function isFaultRun(name: string | null | undefined): boolean {
  return !!name && /fault/i.test(name)
}

export function shortId(id: string | null | undefined, n = 10): string {
  if (!id) return '—'
  return id.length > n ? `${id.slice(0, n)}…` : id
}

/** Human-readable rendering of a fact value for the facts panel. */
export function factValueText(kind: string, value: unknown, args: Record<string, unknown>): string {
  if (value === null || value === undefined) return '—'
  if (kind === 'event_observed' && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return `${fmtTime(String(v.event_time ?? ''))} ${String(v.account ?? '')}@${String(v.ip ?? '')} ${String(v.method ?? '')} ${String(v.path ?? '')} -> ${String(v.status ?? '')}${v.line_number ? ` (line ${String(v.line_number)})` : ''}`
  }
  if (kind === 'time_delta_seconds' && typeof value === 'number') return `${value.toFixed(0)} s between linked requests`
  if (kind === 'auth_failures_in_window' && typeof value === 'number')
    return `${value} login failures within ${String(args.window_seconds ?? '?')} s for ${String(args.pair ?? '')}`
  if (kind === 'prior_denials_count' && typeof value === 'number') return `${value} prior 403 responses for ${String(args.account ?? '')} on ${String(args.path ?? '')}`
  if (kind === 'prior_successes_count' && typeof value === 'number') return `${value} prior 200 responses for the same account/path`
  if (kind === 'source_familiarity') return `source pair ${String(args.pair ?? '')} is '${String(value)}' relative to the frozen reference`
  if (kind === 'same_object') return `both requests reference forum object ${String(value)}`
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
      .join(' · ')
  }
  return String(value)
}

export function factKindLabel(kind: string): string {
  return kind.replaceAll('_', ' ')
}
