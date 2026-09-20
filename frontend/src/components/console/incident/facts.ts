/**
 * Fact ranking — the core of the anti-Bloomberg work on this screen.
 *
 * A real packet from the demo run (incident 09c1b229) holds **92 facts: 81 of kind
 * `event_observed` and 11 derived**. The old panel rendered all 92 as equal rows, so the eleven
 * facts that carry the argument were buried under eighty-one raw log rows wearing identical
 * chrome. That is most of the "Bloomberg terminal" complaint.
 *
 * `role` alone cannot fix it — 87 of those 92 are `role: "trigger"`. The split that works is
 * `kind` first (collapse `event_observed`, pull `assertion_scope` out as a negative statement),
 * then `role` among what remains, where it genuinely separates 6 claims from 5 context facts.
 *
 * Pure module: no React, no tokens.
 */
import type { Fact, Packet } from '../../../api'

export interface GroupedFacts {
  /** The argument. What the detector is actually claiming, most provable first. */
  claims: Fact[]
  /** What this incident explicitly does NOT assert. Honesty surface, never a finding. */
  scope: Fact | null
  /** Baseline / history. True, but it frames the claim rather than making it. */
  context: Fact[]
  /** Raw observed events. Collapsed behind one expander; never deleted. */
  observed: Fact[]
}

/**
 * Claim ordering. Recomputable counts lead because they are the ones a judge can make the UI
 * prove on the spot; the linking facts follow, since they only matter once the counts land.
 */
const CLAIM_ORDER: readonly string[] = [
  'prior_denials_count',
  'prior_successes_count',
  'first_success_after_denials',
  'auth_failures_in_window',
  'source_familiarity',
  'same_object',
  'time_delta_seconds',
]

function claimRank(f: Fact): number {
  const i = CLAIM_ORDER.indexOf(f.kind)
  const base = i === -1 ? CLAIM_ORDER.length : i
  // A fact carrying a `query` can be recomputed live against the raw rows, so it outranks a peer.
  return base * 2 + (f.query ? 0 : 1)
}

export function groupFacts(packet: Packet | null | undefined): GroupedFacts {
  const facts = packet?.facts ?? []
  const out: GroupedFacts = { claims: [], scope: null, context: [], observed: [] }
  for (const f of facts) {
    if (f.kind === 'event_observed') out.observed.push(f)
    else if (f.kind === 'assertion_scope') out.scope = f
    else if (f.role === 'context') out.context.push(f)
    else out.claims.push(f)
  }
  out.claims.sort((a, b) => claimRank(a) - claimRank(b))
  out.observed.sort((a, b) => observedSeq(a) - observedSeq(b))
  return out
}

function observedSeq(f: Fact): number {
  const v = f.value as Record<string, unknown> | null
  const n = v && typeof v === 'object' ? Number(v.run_seq ?? v.line_number ?? 0) : 0
  return Number.isFinite(n) ? n : 0
}

// ------------------------------------------------------------------ claim presentation

export interface ClaimView {
  /** the number or short token a judge reads first; null when the fact has no headline figure */
  figure: string | null
  /** what the figure counts, in words */
  label: string
  /** the qualifying detail — scope, subject, cutoff */
  detail: string
  /** true when the API can recompute this value live and show the rows behind it */
  recomputable: boolean
  /** a zero count is evidence too, and must not look like missing data */
  emphasisZero: boolean
  /**
   * True when the figure identifies something rather than counting it.
   *
   * A forum object id set in a 32px display numeral reads as "1042 shared forum objects".
   * Identifiers render as mono at body size instead, so the display slot stays reserved for
   * quantities and durations.
   */
  isIdentifier: boolean
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/**
 * Turn a derived fact into a headline figure plus qualifying words.
 *
 * Deliberately conservative: unknown kinds fall back to a readable rendering rather than a
 * confident sentence, because a wrong confident sentence about evidence is worse than a plain one.
 */
export function claimView(f: Fact): ClaimView {
  const a = f.args ?? {}
  const v = f.value
  const recomputable = !!f.query

  switch (f.kind) {
    case 'prior_denials_count':
      return {
        figure: String(v),
        label: Number(v) === 1 ? 'prior denial' : 'prior denials',
        detail: `${str(a.account)} was refused ${str(a.path)} with ${str(a.status) || '403'} this many times before the request that triggered this incident`,
        recomputable,
        emphasisZero: false,
        isIdentifier: false,
      }
    case 'prior_successes_count':
      return {
        figure: String(v),
        label: Number(v) === 1 ? 'prior success' : 'prior successes',
        detail: `the same account had never been served ${str(a.path)} before — this is what makes the successful response a change`,
        recomputable,
        emphasisZero: true,
        isIdentifier: false,
      }
    case 'first_success_after_denials':
      return {
        figure: v === true ? 'yes' : v === false ? 'no' : str(v),
        label: 'first success after denials',
        detail: 'the successful response is the first of its kind for this account and resource under the cutoff',
        recomputable,
        emphasisZero: false,
        isIdentifier: false,
      }
    case 'auth_failures_in_window':
      return {
        figure: String(v),
        label: Number(v) === 1 ? 'login failure' : 'login failures',
        detail: `for ${str(a.pair)} within ${str(a.window_seconds)} s. Repeated failures show attempts, not who made them.`,
        recomputable,
        emphasisZero: false,
        isIdentifier: false,
      }
    case 'time_delta_seconds': {
      const n = Number(v)
      return {
        figure: Number.isFinite(n) ? formatDelta(n) : str(v),
        label: 'between the linked requests',
        detail: 'recorded time between the two requests this incident links. Proximity in time is not causation.',
        recomputable,
        emphasisZero: false,
        isIdentifier: false,
      }
    }
    case 'same_object':
      return {
        figure: str(v),
        label: 'shared forum object',
        detail: 'both requests reference the same forum object id',
        recomputable,
        emphasisZero: false,
        isIdentifier: true,
      }
    case 'source_familiarity':
      return {
        figure: str(v),
        label: 'source familiarity',
        detail: `${str(a.pair) || 'this account/source pair'} measured against the frozen August reference`,
        recomputable,
        emphasisZero: false,
        isIdentifier: false,
      }
    default:
      return {
        figure:
          typeof v === 'number'
            ? v.toLocaleString('en-US')
            : typeof v === 'string' || typeof v === 'boolean'
              ? String(v)
              : null,
        label: f.kind.replaceAll('_', ' '),
        detail: '',
        recomputable,
        emphasisZero: false,
        isIdentifier: false,
      }
  }
}

/** Seconds are unreadable past a couple of minutes; 87541 s means nothing, 24h 19m does. */
export function formatDelta(seconds: number): string {
  const s = Math.abs(Math.round(seconds))
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m`
  const h = Math.floor(s / 3600)
  const rm = Math.round((s % 3600) / 60)
  if (h < 48) return rm ? `${h}h ${rm}m` : `${h}h`
  const d = Math.floor(s / 86400)
  const rh = Math.round((s % 86400) / 3600)
  return rh ? `${d}d ${rh}h` : `${d}d`
}

/**
 * `assertion_scope` is a map of `asserts_*: false` flags. It is the most important honesty
 * surface on the page, so it renders as explicit sentences rather than a raw object.
 */
export function scopeStatements(f: Fact | null): string[] {
  if (!f || typeof f.value !== 'object' || f.value === null) return []
  const LABEL: Record<string, string> = {
    asserts_role_changed: 'that any role or permission actually changed',
    asserts_object_creator: 'who created the forum object',
    asserts_session_identity: 'who was holding the session',
    asserts_causal_link: 'that one request caused the other',
    asserts_data_exfiltration: 'that any data left the environment',
    asserts_credential_theft: 'that credentials were stolen',
    asserts_intent: 'anything about intent',
  }
  return Object.entries(f.value as Record<string, unknown>)
    .filter(([, v]) => v === false)
    .map(([k]) => LABEL[k] ?? k.replace(/^asserts_/, '').replaceAll('_', ' '))
}
