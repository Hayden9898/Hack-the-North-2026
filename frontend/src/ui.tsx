import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ModelHealth, Phase, ThreatClass } from './api'
import { describeError } from './api'
import {
  CLASS_LABEL,
  CLASS_MEANING,
  classTone,
  modelHealthExplanation,
  modelHealthLabel,
  phaseLabel,
} from './format'

export function ClassBadge({
  threatClass,
  processingStatus,
  long,
}: {
  threatClass: ThreatClass | null | undefined
  processingStatus?: string | null
  long?: boolean
}) {
  const tone = classTone(threatClass, processingStatus)
  return (
    <span className={`badge badge-class badge-${tone}`} title={CLASS_MEANING[tone]}>
      {CLASS_LABEL[tone]}
      {long ? <span className="badge-meaning"> — {CLASS_MEANING[tone]}</span> : null}
    </span>
  )
}

export function PhaseBadge({ phase }: { phase: Phase | string | null | undefined }) {
  return <span className={`badge badge-phase badge-phase-${phase ?? 'unknown'}`}>{phaseLabel(phase)}</span>
}

export function StateBadge({ state, label }: { state: string; label?: string }) {
  return <span className={`badge badge-state badge-state-${state}`}>{label ?? state}</span>
}

export function ModelHealthBadge({ health }: { health: ModelHealth }) {
  const tone = health === 'active' ? 'ok' : 'warn'
  return (
    <span
      className={`badge badge-model badge-model-${tone}`}
      title={modelHealthExplanation(health) ?? 'Model scoring is active'}
    >
      {modelHealthLabel(health)}
    </span>
  )
}

export function ModelHealthBanner({ health }: { health: ModelHealth }) {
  const text = modelHealthExplanation(health)
  if (!text) return null
  return (
    <div className="banner banner-warn" role="status">
      <strong>{modelHealthLabel(health)}.</strong> {text}
    </div>
  )
}

export function Tag({
  children,
  tone,
}: {
  children: ReactNode
  tone?: 'muted' | 'info' | 'warn' | 'danger' | 'ok'
}) {
  return <span className={`tag ${tone ? `tag-${tone}` : ''}`}>{children}</span>
}

export function Loading({ what }: { what?: string }) {
  return (
    <div className="state-loading" role="status" aria-label={`Loading ${what ?? 'data'}`}>
      <span className="loading-label">
        <span className="spinner" aria-hidden="true" /> Loading{what ? ` ${what}` : ''}…
      </span>
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state state-empty">{children}</div>
}

export function ErrorState({
  error,
  onRetry,
  what,
}: {
  error: unknown
  onRetry?: () => void
  what?: string
}) {
  const { status, text } = describeError(error)
  const dbDown = status === 503
  return (
    <div className={`state state-error ${dbDown ? 'state-db' : ''}`} role="alert">
      <div>
        <strong>{dbDown ? 'Database unavailable' : `Could not load ${what ?? 'data'}`}</strong>
        <span className="muted">
          {' '}
          {status ? `HTTP ${status}` : 'No response'}
          {text ? ` — ${text}` : ''}
        </span>
      </div>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function KV({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd className={mono ? 'mono' : undefined}>{children}</dd>
    </div>
  )
}

export function Section({
  title,
  children,
  aside,
  id,
  tone,
}: {
  title: ReactNode
  children: ReactNode
  aside?: ReactNode
  id?: string
  tone?: 'ai' | 'fact' | 'unknown'
}) {
  return (
    <section className={`card ${tone ? `card-${tone}` : ''}`} id={id}>
      <header className="card-head">
        <h2>{title}</h2>
        {aside ? <div className="card-aside">{aside}</div> : null}
      </header>
      <div className="card-body">{children}</div>
    </section>
  )
}

export function IncidentLink({
  runId,
  incidentId,
  children,
}: {
  runId: string
  incidentId: string
  children?: ReactNode
}) {
  return (
    <Link
      className="link mono"
      to={`/runs/${encodeURIComponent(runId)}/incidents/${encodeURIComponent(incidentId)}`}
    >
      {children ?? incidentId}
    </Link>
  )
}

export function EventLink({ runId, seq, children }: { runId: string; seq: number; children?: ReactNode }) {
  return (
    <Link className="link mono" to={`/runs/${encodeURIComponent(runId)}/events/${seq}`}>
      {children ?? `#${seq}`}
    </Link>
  )
}

export function RuleTags({ ids }: { ids: string[] | null | undefined }) {
  if (!ids || ids.length === 0) return <span className="muted">—</span>
  return (
    <span className="tags">
      {ids.map((r) => (
        <Tag key={r} tone="info">
          {r}
        </Tag>
      ))}
    </span>
  )
}

/** Renders an arbitrary JSON-ish value as escaped text inside <code>. Never HTML. */
export function Code({ children, block }: { children: unknown; block?: boolean }) {
  const text = typeof children === 'string' ? children : JSON.stringify(children, null, block ? 2 : 0)
  return block ? (
    <pre className="code-block">
      <code>{text}</code>
    </pre>
  ) : (
    <code className="code-inline">{text}</code>
  )
}
