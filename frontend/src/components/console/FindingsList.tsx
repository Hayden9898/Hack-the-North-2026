import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { IncidentRow } from '../../api'
import { fmtNum, fmtTime, shortId } from '../../format'
import { cn } from '@/lib/cn'
import { StatusChip } from '@/components/ui/status-chip'

/**
 * The findings. This is the answer the run console exists to give, so it is the primary read —
 * previously it sat in a right-hand column at the same visual weight as 22,975 normal rows.
 *
 * Cards are sized by severity rather than uniformly: a high-risk finding gets the headline
 * treatment, a suspicious one does not. Uniform grids where every card is the same size
 * regardless of importance are on the banned list for good reason.
 */
export function FindingsList({ incidents, runId }: { incidents: IncidentRow[]; runId: string }) {
  if (incidents.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body text-fg-muted">
        No incidents under the current cutoff. The detector has evaluated everything processed so far and grouped
        nothing — that is a real result, not an empty screen.
      </p>
    )
  }

  return (
    <ul className="grid gap-3">
      {incidents.map((i) => (
        <li key={i.incident_id}>
          <FindingCard incident={i} runId={runId} />
        </li>
      ))}
    </ul>
  )
}

function FindingCard({ incident: i, runId }: { incident: IncidentRow; runId: string }) {
  const high = i.current_class === 'high_risk'
  const lines = i.summary?.lines ?? []

  return (
    <Link
      to={`/app/runs/${encodeURIComponent(runId)}/incidents/${encodeURIComponent(i.incident_id)}`}
      className={cn(
        'group/find block rounded-lg border bg-surface transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
        high ? 'border-high-risk/35 px-5 py-4' : 'border-border px-4 py-3.5',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip verdict={i.current_class} size={high ? 'md' : 'sm'} />
        {i.phase === 'warmup' ? (
          <span className="rounded-sm border border-border px-1.5 py-0.5 text-[0.6875rem] text-fg-muted uppercase">
            historical warmup
          </span>
        ) : null}
        {i.rule_ids.map((r) => (
          <span key={r} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted">
            {r}
          </span>
        ))}
        {i.evidence_strength?.evaluation_incomplete ? (
          <span className="rounded-sm border border-late/45 px-1.5 py-0.5 text-[0.6875rem] font-medium text-late">
            evaluation incomplete
          </span>
        ) : null}
        <span className="ms-auto flex items-center gap-1.5 text-caption text-fg-muted normal-case tracking-normal group-hover/find:text-accent">
          open
          <ArrowRight className="size-3.5" aria-hidden />
        </span>
      </div>

      <h3 className={cn('mt-2.5 text-balance text-fg', high ? 'max-w-[54ch] text-heading' : 'max-w-[64ch] text-body')}>
        {i.summary?.headline ?? i.primary_rule_id}
      </h3>

      {/* On a high-risk card, lead with the strongest counted line — it is why this is here. */}
      {high && lines.length > 0 ? (
        <p className="mt-1.5 max-w-[68ch] font-mono text-mono text-fg-muted">{lines[0]}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-caption text-fg-muted normal-case tracking-normal">
        <span className="font-mono">
          {i.account ?? '—'}
          {i.ip_raw ? `@${i.ip_raw}` : ''}
        </span>
        <span className="font-mono">
          {fmtTime(i.first_event_time)} → {fmtTime(i.last_event_time)}
        </span>
        <span>{fmtNum(i.evidence_count)} evidence</span>
        <span>v{i.current_version}</span>
        {i.explanation_state === 'rejected' ? (
          <span className="font-medium text-high-risk">AI proposal rejected</span>
        ) : null}
        <span className="ms-auto font-mono text-fg-subtle">{shortId(i.incident_id, 12)}</span>
      </div>
    </Link>
  )
}
