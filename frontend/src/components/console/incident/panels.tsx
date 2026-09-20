import { ChevronRight, CircleHelp, Link2, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  describeError,
  type Baseline,
  type Delivery,
  type Disposition,
  type EvidenceStrength,
  type FeedbackRow,
  type Playbook,
  type PlaybooksBlock,
  type Relation,
  type Summary,
  type TimelineEntry,
} from '../../../api'
import { DELIVERY_STATE_LABEL, DISPOSITIONS, fmtNum, fmtTime, shortId, unknownLabel } from '../../../format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { axisTicks, bandScale, tickCount } from '../../charts/scale'

/* ------------------------------------------------------------------ unknowns */

/**
 * What the logs cannot establish. The third category alongside observed fact and AI suggestion,
 * and it must never be mistaken for either — so: no verdict colour, no finding styling.
 */
export function UnknownsPanel({ strength, summary }: { strength: EvidenceStrength; summary: Summary }) {
  const codes = [...new Set([...(strength.missing_evidence ?? []), ...(summary.unknowns ?? [])])]
  if (codes.length === 0) return null
  return (
    <section aria-labelledby="unknowns" className="rounded-lg border border-border bg-surface px-4 py-3.5">
      <h3 id="unknowns" className="flex items-center gap-2 text-caption text-fg-muted uppercase">
        <CircleHelp className="size-3.5" aria-hidden />
        What these logs cannot establish
      </h3>
      <ul className="mt-2.5 grid gap-1.5">
        {codes.map((c) => (
          <li key={c} className="text-body text-fg-muted">
            {unknownLabel(c)}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ evidence strength */

export function EvidenceStrengthRow({
  strength,
  rulesIncomplete,
  truncatedAt,
}: {
  strength: EvidenceStrength
  rulesIncomplete: string[]
  truncatedAt: number | null
}) {
  const incomplete = strength.evaluation_incomplete || rulesIncomplete.length > 0
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={strength.legs_present ? 'ok' : 'warn'}>
        {strength.legs_present ? 'all rule legs present' : 'some rule legs missing'}
      </Pill>
      <Pill>{fmtNum(strength.distinct_evidence_events)} distinct evidence events</Pill>
      {incomplete ? (
        <Pill tone="warn">
          evaluation incomplete{rulesIncomplete.length ? `: ${rulesIncomplete.join(', ')}` : ''}
        </Pill>
      ) : (
        <Pill tone="ok">evaluation complete</Pill>
      )}
      {truncatedAt !== null ? <Pill tone="warn">evidence listing truncated at {fmtNum(truncatedAt)}</Pill> : null}
    </div>
  )
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-2 py-0.5 text-caption font-medium normal-case tracking-normal',
        tone === 'ok' && 'border-normal/30 text-normal',
        tone === 'warn' && 'border-late/45 text-late',
        !tone && 'border-border text-fg-muted',
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ timeline */

export function TimelinePanel({
  timeline,
  runId,
  triggerSeq,
}: {
  timeline: TimelineEntry[]
  runId: string
  triggerSeq: number
}) {
  if (timeline.length === 0) return <Empty>No evidence events under the current cutoff.</Empty>
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse font-mono text-mono">
        <thead>
          <tr className="border-b border-border bg-surface-raised text-left">
            <Th className="text-right">seq</Th>
            <Th>time (UTC)</Th>
            <Th>account@ip</Th>
            <Th>request</Th>
            <Th className="text-right">status</Th>
            <Th>relation</Th>
            <Th>class</Th>
          </tr>
        </thead>
        <tbody>
          {timeline.map((t) => {
            const isTrigger = t.run_seq === triggerSeq
            return (
              <tr
                key={`${t.event_id}-${t.relation_type}`}
                className={cn('border-b border-border/50 last:border-0 hover:bg-hover', isTrigger && 'bg-high-risk-wash')}
              >
                <Td className="text-right tabular-nums">
                  <Link
                    to={`/app/runs/${encodeURIComponent(runId)}/events/${t.run_seq}`}
                    className="text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    {t.run_seq}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap tabular-nums text-fg-muted">{fmtTime(t.event_time)}</Td>
                <Td className="whitespace-nowrap">
                  {t.username}@{t.ip_raw}
                </Td>
                <Td className="max-w-[28ch] truncate" title={`${t.method} ${t.path}`}>
                  {t.method} {t.path}
                </Td>
                <Td className="text-right tabular-nums">{t.status}</Td>
                <Td className="text-fg-muted">
                  {t.relation_type}
                  {t.rule_id ? <span className="ms-1 text-accent">{t.rule_id}</span> : null}
                </Td>
                <Td>
                  {t.threat_class ? <StatusChip verdict={t.threat_class} size="sm" /> : <span className="text-fg-subtle">—</span>}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ relations */

export function RelationsPanel({ relations, runId }: { relations: Relation[]; runId: string }) {
  if (relations.length === 0) return <Empty>No related episodes recorded.</Empty>
  return (
    <ul className="grid gap-2">
      {relations.map((r) => (
        <li key={`${r.related_incident_id}-${r.relation_type}`}>
          <Link
            to={`/app/runs/${encodeURIComponent(runId)}/incidents/${encodeURIComponent(r.related_incident_id)}`}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:border-border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <Link2 className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <StatusChip verdict={r.current_class} size="sm" />
            <span className="text-body text-fg">
              linked by {r.relation_type.replaceAll('_', ' ')} <span className="font-mono text-fg-muted">{r.link_key}</span>
            </span>
            <span className="ms-auto font-mono text-mono text-fg-subtle">{shortId(r.related_incident_id, 14)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ playbooks */

export function PlaybooksPanel({ playbooks }: { playbooks: PlaybooksBlock | null }) {
  if (!playbooks || playbooks.applicable.length === 0) return <Empty>No playbooks apply to this incident.</Empty>
  const selected = new Set(playbooks.selected_by_ai ?? [])
  return (
    <div className="space-y-3">
      <p className="max-w-[70ch] text-body text-fg-muted">
        {fmtNum(playbooks.applicable.length)} playbook{playbooks.applicable.length === 1 ? '' : 's'} apply by rule.
        {selected.size > 0
          ? ` The AI additionally suggested ${fmtNum(selected.size)} of them.`
          : ' The AI selected none — applicability comes from the rules, not the model.'}
      </p>
      <ul className="grid gap-2">
        {playbooks.applicable.map((p) => (
          <PlaybookItem key={p.id} playbook={p} aiSelected={selected.has(p.id)} />
        ))}
      </ul>
    </div>
  )
}

function PlaybookItem({ playbook, aiSelected }: { playbook: Playbook; aiSelected: boolean }) {
  const steps = playbook.proposed_steps ?? []
  return (
    <li>
      <details className="rounded-lg border border-border bg-surface">
        <summary className="group/sum flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
          <ChevronRight className="size-3.5 shrink-0 text-fg-muted transition-transform group-open/sum:rotate-90 motion-reduce:transition-none" aria-hidden />
          <span className="min-w-0 flex-1 text-body text-fg">{playbook.title}</span>
          {aiSelected ? (
            <span className="shrink-0 rounded-sm border border-accent/35 px-1.5 py-0.5 text-[0.6875rem] text-accent">AI suggested</span>
          ) : null}
          <span className="shrink-0 text-caption text-fg-muted normal-case tracking-normal">{steps.length} steps</span>
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3">
          <p className="text-body text-fg-muted">{playbook.uncertainty}</p>
          <div>
            <h4 className="mb-1.5 text-caption text-fg-muted uppercase">Proposed steps, for a human reviewer</h4>
            <ol className="grid list-decimal gap-1 ps-5 text-body text-fg-muted marker:text-fg-subtle">
              {steps.map((s, i) => (
                <li key={i}>{typeof s === 'string' ? s : Object.entries(s).map(([c, t]) => `if ${c}: ${t}`).join('; ')}</li>
              ))}
            </ol>
          </div>
          {playbook.required_evidence?.length ? (
            <div>
              <h4 className="mb-1.5 text-caption text-fg-muted uppercase">Evidence not in these logs</h4>
              <ul className="grid gap-1 text-body text-fg-muted">
                {playbook.required_evidence.map((e) => (
                  <li key={e}>{unknownLabel(e)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  )
}

/* ------------------------------------------------------------------ baseline */

/**
 * 24-hour activity histogram for the account.
 *
 * One hue, no legend: bar length already encodes magnitude, so colouring by value would
 * double-encode it (a named dataviz anti-pattern). The trigger hour is the only emphasis.
 */
export function BaselinePanel({
  baseline,
  account,
  triggerSeq,
  triggerHour,
}: {
  baseline: Baseline | null
  account: string | null
  triggerSeq: number
  triggerHour: number | null
}) {
  if (!baseline) return <Empty>No baseline recorded for this account under the cutoff.</Empty>
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, n: baseline.hour_histogram?.[String(h)] ?? 0 }))
  const peak = Math.max(1, ...hours.map((x) => x.n))
  const { max, ticks } = axisTicks(peak, 3)

  const W = 560
  const H = 132
  const PAD = { t: 8, r: 8, b: 20, l: 40 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const band = bandScale(24, [PAD.l, PAD.l + plotW], 0.25)
  const barW = Math.min(band.bandwidth, 24)
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH

  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-7 gap-y-2">
        <Stat label="events before trigger" value={fmtNum(baseline.total)} />
        <Stat label="401s" value={fmtNum(baseline.c401)} />
        <Stat label="403s" value={fmtNum(baseline.c403)} />
        <Stat label="distinct sources" value={fmtNum(baseline.ips)} />
        <Stat label="first seen" value={fmtTime(baseline.first_seen)} mono />
      </dl>

      <figure>
        <figcaption className="mb-2 text-caption text-fg-muted normal-case tracking-normal">
          When <span className="font-mono text-fg">{account ?? 'this account'}</span> was normally active, by UTC hour,
          across {fmtNum(baseline.total)} events before run_seq {fmtNum(triggerSeq)}.
          {triggerHour !== null ? ' The highlighted hour is when this incident triggered.' : ''}
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Account activity by hour of day">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-[var(--color-fg-subtle)] text-[9px] tabular-nums">
                {tickCount(t)}
              </text>
            </g>
          ))}
          {hours.map(({ h, n }) => {
            const isTrigger = h === triggerHour
            const bh = Math.max(n > 0 ? 1 : 0, (n / max) * plotH)
            return (
              <rect
                key={h}
                x={band(h) + (band.bandwidth - barW) / 2}
                y={PAD.t + plotH - bh}
                width={barW}
                height={bh}
                rx={2}
                fill={isTrigger ? 'var(--color-accent)' : 'var(--color-fg-subtle)'}
                opacity={isTrigger ? 1 : 0.55}
              >
                <title>{`${String(h).padStart(2, '0')}:00 UTC — ${fmtNum(n)} events`}</title>
              </rect>
            )
          })}
          {[0, 6, 12, 18].map((h) => (
            <text key={h} x={band(h) + band.bandwidth / 2} y={H - 6} textAnchor="middle" className="fill-[var(--color-fg-subtle)] text-[9px] tabular-nums">
              {String(h).padStart(2, '0')}
            </text>
          ))}
        </svg>
      </figure>
    </div>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-caption text-fg-muted uppercase">{label}</dt>
      <dd className={cn('text-heading text-fg', mono && 'font-mono text-mono')}>{value}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ delivery */

export function DeliveryPanel({ deliveries }: { deliveries: Delivery[] }) {
  if (deliveries.length === 0) return <Empty>No notification was generated.</Empty>
  return (
    <ul className="grid gap-2">
      {deliveries.map((d) => (
        <li key={d.idempotency_key} className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Send className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span className="text-body text-fg">{d.notification_kind.replaceAll('_', ' ')}</span>
            <span className="ms-auto text-caption text-fg-muted normal-case tracking-normal">
              {DELIVERY_STATE_LABEL[d.state] ?? d.state}
            </span>
          </div>
          {d.delivery_ambiguous ? (
            <p className="mt-1 text-caption text-late normal-case tracking-normal">
              Delivery outcome ambiguous — it may or may not have been sent.
            </p>
          ) : null}
          {d.preview_text ? (
            <details className="mt-2">
              <summary className="cursor-pointer list-none text-caption text-fg-muted normal-case tracking-normal hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                Show the message that would have been sent
              </summary>
              <p className="mt-2 max-h-64 overflow-y-auto border-s-2 border-border ps-2.5 font-mono text-mono whitespace-pre-wrap text-fg-muted">
                {d.preview_text}
              </p>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ disposition */

export function DispositionPanel({
  runId,
  incidentId,
  feedback,
  onSaved,
}: {
  runId: string
  incidentId: string
  feedback: FeedbackRow[]
  onSaved: () => void
}) {
  const [reviewer, setReviewer] = useState('')
  const [disposition, setDisposition] = useState<Disposition>('needs_more_evidence')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await api.postFeedback(runId, incidentId, { reviewer: reviewer.trim() || 'analyst', disposition, reason: reason.trim() })
      setReason('')
      onSaved()
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-body text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="grid gap-2.5">
        <label className="grid gap-1 text-caption text-fg-muted uppercase">
          reviewer
          <input className={field} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="analyst" />
        </label>
        <label className="grid gap-1 text-caption text-fg-muted uppercase">
          disposition
          <select className={field} value={disposition} onChange={(e) => setDisposition(e.target.value as Disposition)}>
            {DISPOSITIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-caption text-fg-muted uppercase">
          reason
          <textarea className={cn(field, 'min-h-16 resize-y')} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <Button type="submit" size="sm" disabled={busy} className="justify-self-start">
          {busy ? 'Recording…' : 'Record disposition'}
        </Button>
        {err ? <p className="text-caption text-high-risk normal-case tracking-normal">{describeError(err).text}</p> : null}
      </form>

      {feedback.length > 0 ? (
        <div className="border-t border-border pt-3">
          <h4 className="mb-2 text-caption text-fg-muted uppercase">Recorded — append-only</h4>
          <ul className="grid gap-2">
            {feedback.map((f) => (
              <li key={f.id} className="text-body">
                <span className="text-fg">{f.disposition.replaceAll('_', ' ')}</span>
                <span className="text-fg-muted"> · {f.reviewer} · v{f.version} · {fmtTime(f.created_at)}</span>
                {f.reason ? <p className="text-fg-muted">{f.reason}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ shared */

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-body text-fg-muted">{children}</p>
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2 font-sans text-caption font-medium text-fg-muted uppercase', className)}>{children}</th>
}

function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td className={cn('px-3 py-1.5 text-fg', className)} title={title}>
      {children}
    </td>
  )
}
