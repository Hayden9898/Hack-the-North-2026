import { ChevronRight } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api, describeError, type EventDetail } from '../api'
import { fmtBytes, fmtNum, fmtPercentile, fmtTime, reasonCodeText, ruleReference, shortId } from '../format'
import { useFetch } from '../useFetch'
import { CodeBlock } from '@/components/ui/code-block'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusChip, resolveStatus } from '@/components/ui/status-chip'
import { PhaseChip } from '../components/console/PhaseChip'

/**
 * Single event.
 *
 * Answers: what exactly was this log line, and why was it classified the way it was. The raw
 * line is the subject, so it leads. Feature vectors and observed context are reproducibility
 * surfaces rather than first reads, so they sit behind a disclosure.
 */
export function EventPage() {
  const { runId = '', seq = '' } = useParams()
  const ev = useFetch<EventDetail>(() => api.getEvent(runId, seq), [runId, seq])

  if (ev.loading && !ev.data) {
    return (
      <div className="mx-auto w-full max-w-[84rem] space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-52 w-full rounded-lg" />
      </div>
    )
  }
  if (ev.error && !ev.data) {
    const e = describeError(ev.error)
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <ErrorState
          title={e.status === 404 ? 'No such event under this cutoff' : 'Could not load this event'}
          detail={e.text}
          onRetry={() => void ev.reload()}
        />
      </div>
    )
  }
  const e = ev.data
  if (!e) return null

  const status = resolveStatus(e.threat_class, e.processing_status)
  const flagged = 'verdict' in status && status.verdict !== 'normal'

  return (
    <div className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
        <Link to="/app" className="text-caption text-fg-muted hover:text-fg">
          Runs
        </Link>
        <ChevronRight className="size-3 text-fg-muted" aria-hidden />
        <Link to={`/app/runs/${encodeURIComponent(runId)}`} className="font-mono text-caption text-fg-muted hover:text-fg">
          {shortId(runId, 14)}
        </Link>
        <ChevronRight className="size-3 text-fg-muted" aria-hidden />
        <span className="font-mono text-caption text-fg-muted">event {e.run_seq}</span>
      </nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip {...status} />
          <PhaseChip phase={e.phase} />
          {e.rule_ids.map((r) => (
            <span key={r} className="rounded-sm border border-accent/35 px-1.5 py-0.5 font-mono text-[0.6875rem] text-accent">
              {r}
            </span>
          ))}
        </div>

        {/* wrap="always": this is the one screen whose entire job is showing the exact line,
            so it must be visible in full without a scroll. Agent A's wrap breaks at spaces
            rather than mid-token, so byte fidelity survives the wrap. */}
        <p className="max-w-[72ch] text-heading text-balance text-fg">{verdictSentence(e, status)}</p>

        <CodeBlock
          code={e.raw_line}
          wrap="always"
          label={
            <span className="font-mono normal-case">
              line {e.line_number ?? '—'} · run_seq {e.run_seq} · {fmtTime(e.event_time)}
            </span>
          }
        />
      </header>

      <section aria-labelledby="parsed" className="rounded-lg border border-border bg-surface px-4 py-4">
        <h2 id="parsed" className="mb-3 text-caption text-fg-muted">
          As parsed
        </h2>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Pair k="account" v={e.username} mono />
          <Pair k="source" v={e.ip_raw} mono />
          <Pair k="request" v={`${e.method} ${e.path}`} mono />
          <Pair k="status" v={String(e.status)} mono />
          <Pair k="response bytes" v={e.response_bytes === null ? '—' : `${fmtNum(e.response_bytes)} (${fmtBytes(e.response_bytes)})`} mono />
          <Pair k="route family" v={e.route_family} mono />
          {e.object_id ? <Pair k="object id" v={e.object_id} mono /> : null}
          {e.original_time ? <Pair k="original time" v={fmtTime(e.original_time)} mono /> : null}
        </dl>
      </section>

      <section aria-labelledby="outcome" className="rounded-lg border border-border bg-surface px-4 py-4">
        <h2 id="outcome" className="mb-3 text-caption text-fg-muted">
          Why it was classified this way
        </h2>
        {e.reason_codes.length > 0 ? (
          <ul className="mb-3 grid gap-2.5">
            {e.reason_codes.map((c) => {
              const r = reasonCodeText(c)
              const ref = r.rule ? ruleReference(r.rule) : null
              return (
                <li key={c} className="border-s-2 border-border ps-3">
                  <p className="flex flex-wrap items-baseline gap-2">
                    {r.rule ? (
                      <span className="rounded-sm border border-accent/35 px-1.5 py-0.5 font-mono text-[0.6875rem] text-accent">
                        {r.rule}
                      </span>
                    ) : null}
                    {ref ? <span className="font-mono text-mono text-fg-muted">{ref.name}</span> : null}
                    {ref ? <StatusChip verdict={ref.outcome} size="sm" /> : null}
                  </p>
                  <p className="mt-1 max-w-[74ch] text-body text-fg-muted">{r.text}</p>
                  <p className="mt-0.5 font-mono text-mono text-fg-muted">{c}</p>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mb-3 text-body text-fg-muted">
            {flagged ? 'No reason codes were recorded.' : 'No configured detector flagged this event.'}
          </p>
        )}

        {e.top_deviations.length > 0 ? (
          <div className="mb-3 border-t border-border pt-3">
            <h3 className="mb-2 text-caption text-fg-muted">What stood out</h3>
            <ul className="grid gap-1.5">
              {e.top_deviations.map((d, i) => {
                const rec = d as Record<string, unknown>
                const code = String(rec.code ?? '')
                const detail = rec.detail === undefined || rec.detail === null ? '' : String(rec.detail)
                return (
                  <li key={`${code}-${i}`} className="text-body text-fg">
                    {code.replaceAll('_', ' ')}
                    {detail ? <span className="font-mono text-mono text-fg-muted"> — {detail}</span> : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        <dl className="grid gap-x-8 gap-y-3 border-t border-border pt-3 sm:grid-cols-3">
          <Pair
            k="rarity percentile"
            v={e.anomaly_percentile !== null ? fmtPercentile(e.anomaly_percentile) : 'not scored'}
            mono
            hint="Rarity against the frozen baseline. Not a confidence and not an attack probability."
          />
          <Pair k="model" v={e.model_id ?? 'none — rules only'} mono />
          <Pair k="model flagged" v={e.model_flagged === null ? 'not scored' : e.model_flagged ? 'yes' : 'no'} mono />
        </dl>

        {e.incident_memberships.length > 0 ? (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="mb-2 text-caption text-fg-muted">Part of</h3>
            <ul className="grid gap-1.5">
              {e.incident_memberships.map((m) => (
                <li key={`${m.incident_id}-${m.relation_type}`}>
                  <Link
                    to={`/app/runs/${encodeURIComponent(runId)}/incidents/${encodeURIComponent(m.incident_id)}`}
                    className="flex flex-wrap items-center gap-2 font-mono text-mono text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    {shortId(m.incident_id, 16)}
                    <span className="text-fg-muted">{m.relation_type}</span>
                    {m.rule_id ? <span className="text-fg-muted">{m.rule_id}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {e.features || e.observed_context ? (
        <details className="rounded-lg border border-border bg-surface">
          <summary className="group/sum flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-caption text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/sum:rotate-90 motion-reduce:transition-none" aria-hidden />
            Model inputs at processing time ({e.feature_version ?? 'no snapshot'})
          </summary>
          <div className="space-y-4 border-t border-border px-4 py-4">
            {e.features ? <KeyNumbers title="Feature vector" data={e.features} /> : null}
            {e.observed_context ? <KeyNumbers title="Observed context" data={e.observed_context} /> : null}
          </div>
        </details>
      ) : null}
    </div>
  )
}

/**
 * One sentence naming what this event is and why it carries its class, so the page leads with
 * the verdict rather than with the raw line.
 */
function verdictSentence(e: EventDetail, status: ReturnType<typeof resolveStatus>): string {
  const names = e.rule_ids.map((r) => ruleReference(r)?.name ?? r).join(' and ')

  // Unscored is not the same as scored clean. Branching on `threat_class` alone let a pending
  // or late event fall through to "No configured detector flagged this request." — printed
  // directly under the pending chip the header renders from the same resolveStatus call.
  if ('state' in status) {
    switch (status.state) {
      case 'late':
        return 'This event arrived after the cutoff, so it was never scored under this run. No verdict either way.'
      case 'blocked':
        return 'Scoring is blocked for this event, so it carries no verdict yet.'
      case 'failed':
        return 'Scoring failed for this event, so it carries no verdict.'
      default:
        return 'This event has not been scored yet, so it carries no verdict either way.'
    }
  }

  if (status.verdict === 'high_risk') {
    return names
      ? `Flagged high risk: ${names} matched this request. Investigate urgently — this is a priority signal, not a finding of wrongdoing.`
      : 'Flagged high risk. Investigate urgently — this is a priority signal, not a finding of wrongdoing.'
  }
  if (status.verdict === 'suspicious') {
    return names ? `Flagged suspicious: ${names} matched this request.` : 'Flagged suspicious.'
  }
  return 'No configured detector flagged this request.'
}

function KeyNumbers({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-caption text-fg-muted">{title}</h3>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1">
            <dt className="min-w-0 truncate font-mono text-mono text-fg-muted" title={k}>
              {k}
            </dt>
            <dd className="shrink-0 font-mono text-mono tabular-nums text-fg">
              {typeof v === 'number' ? (Number.isInteger(v) ? fmtNum(v) : v.toFixed(4)) : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Pair({ k, v, mono, hint }: { k: string; v: string; mono?: boolean; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-fg-muted" title={hint}>
        {k}
      </dt>
      <dd className={mono ? 'break-words font-mono text-mono text-fg' : 'break-words text-body text-fg'}>{v}</dd>
      {hint ? <p className="mt-0.5 text-caption text-fg-muted">{hint}</p> : null}
    </div>
  )
}
