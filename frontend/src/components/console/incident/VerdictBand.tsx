import { ChevronDown } from 'lucide-react'
import type { IncidentCore, IncidentVersion, IncidentVersionFull } from '../../../api'
import { fmtNum, fmtTime } from '../../../format'
import { StatusChip } from '@/components/ui/status-chip'

/**
 * The primary read: verdict, what happened, and the qualifier that stops "high risk" being
 * mistaken for a finding of guilt. Everything identifying (ids, hashes, version machinery) is
 * demoted below it — a judge needs those second, not first.
 */
export function VerdictBand({
  incident,
  version,
  versions,
  evidenceCount,
  onVersionChange,
}: {
  incident: IncidentCore
  version: IncidentVersionFull
  versions: IncidentVersion[]
  evidenceCount: number
  onVersionChange: (v: number) => void
}) {
  const s = version.summary
  const isCurrent = version.version === incident.current_version
  const escalated = versions.length > 1 && versions[0].threat_class !== version.threat_class

  return (
    <header className="rounded-xl border border-border bg-surface px-6 py-6 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip verdict={version.threat_class} />
        <span className="text-caption text-fg-muted uppercase">{incident.status}</span>
        <Dot />
        <span className="text-caption text-fg-muted uppercase">
          {incident.phase === 'warmup' ? 'historical warmup' : 'visible window'}
        </span>
        <Dot />
        <span className="flex gap-1">
          {version.rule_ids.map((r) => (
            <span key={r} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted">
              {r}
            </span>
          ))}
        </span>
        {escalated ? (
          <span className="rounded-sm border border-high-risk/40 bg-high-risk-wash px-1.5 py-0.5 text-[0.6875rem] font-medium text-high-risk">
            escalated from {versions[0].threat_class.replace('_', ' ')}
          </span>
        ) : null}
      </div>

      <h1 className="mt-4 max-w-[46ch] text-title text-balance text-fg">{s.headline}</h1>

      <p className="mt-3 max-w-[70ch] text-body text-fg-muted">
        {s.qualifier || 'Qualified detector finding; not an assertion of intent.'}
      </p>

      <dl className="mt-5 flex flex-wrap items-baseline gap-x-7 gap-y-2 border-t border-border pt-4">
        <Meta label="account">
          <span className="font-mono">{incident.account ?? '—'}</span>
        </Meta>
        {incident.ip_raw ? (
          <Meta label="source">
            <span className="font-mono">{incident.ip_raw}</span>
          </Meta>
        ) : null}
        <Meta label="window">
          <span className="font-mono">
            {fmtTime(incident.first_event_time)} → {fmtTime(incident.last_event_time)}
          </span>
        </Meta>
        <Meta label="evidence">{fmtNum(evidenceCount)} events</Meta>
        <Meta label="trigger">
          <span className="font-mono">run_seq {fmtNum(version.trigger_seq)}</span>
        </Meta>

        <div className="ms-auto flex items-center gap-2">
          {!isCurrent ? (
            <span className="rounded-sm border border-late/45 px-1.5 py-0.5 text-[0.6875rem] font-medium text-late">
              older version
            </span>
          ) : null}
          <label className="flex items-center gap-1.5 text-caption text-fg-muted normal-case tracking-normal">
            version
            <span className="relative">
              <select
                value={String(version.version)}
                onChange={(e) => onVersionChange(Number(e.target.value))}
                className="appearance-none rounded-md border border-border bg-surface-raised py-1 ps-2 pe-7 font-mono text-mono text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                {versions.map((v) => (
                  <option key={v.version} value={String(v.version)}>
                    v{v.version} · {v.threat_class.replace('_', ' ')}
                    {v.version === incident.current_version ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" aria-hidden />
            </span>
          </label>
        </div>
      </dl>
    </header>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-caption text-fg-muted uppercase">{label}</dt>
      <dd className="text-body text-fg">{children}</dd>
    </div>
  )
}

function Dot() {
  return (
    <span aria-hidden className="text-fg-subtle">
      ·
    </span>
  )
}
