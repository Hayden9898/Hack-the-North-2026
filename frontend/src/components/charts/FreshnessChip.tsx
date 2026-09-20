import { Database, DatabaseZap, Clock, Layers } from 'lucide-react'
import { fmtTime } from '../../format'
import { cn } from '@/lib/cn'
import type { Freshness } from './timeseries'

/**
 * Where a chart's numbers came from.
 *
 * Worth surfacing rather than hiding: "served from the materialised Tiger aggregate, refreshed
 * at T" versus "falling back to raw" is the difference between a chart you can trust at demo
 * speed and one that just happens to be right.
 *
 * Tone is a *processing* signal, so it wears processing-state tokens and an icon, never a
 * verdict colour — a stale aggregate is not a threat class.
 */
export function FreshnessChip({ freshness, className }: { freshness: Freshness; className?: string }) {
  const { tone, label, detail } = freshness
  const Icon = tone === 'materialized' ? Database : tone === 'tail' ? Layers : tone === 'as_of' ? Clock : DatabaseZap

  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-sm border px-2 py-1 text-caption font-medium normal-case tracking-normal',
        tone === 'materialized' && 'border-normal/30 text-normal',
        tone === 'tail' && 'border-border-strong text-fg-muted',
        tone === 'as_of' && 'border-accent/35 text-accent',
        tone === 'stale' && 'state-hatch border-late/45 text-late',
        tone === 'raw' && 'state-hatch border-pending/45 text-pending',
        className,
      )}
      title={detail}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
      {freshness.refreshedAt ? (
        <span className="font-mono text-fg-muted">· refreshed {fmtTime(freshness.refreshedAt)}</span>
      ) : null}
    </span>
  )
}

/** The full provenance sentence, for the disclosure beneath a chart. */
export function FreshnessDetail({ freshness }: { freshness: Freshness }) {
  const f = freshness
  return (
    <div className="space-y-1.5">
      <p className="max-w-[72ch] text-body text-fg-muted">{f.detail}</p>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-mono text-fg-muted">
        {f.materializedThrough ? <Pair k="materialized through" v={f.materializedThrough} /> : null}
        {f.materializedBuckets !== null ? <Pair k="aggregate buckets" v={f.materializedBuckets.toLocaleString()} /> : null}
        {f.rawTailBuckets !== null ? <Pair k="raw tail buckets" v={f.rawTailBuckets.toLocaleString()} /> : null}
        {f.bucketMinutes !== null ? <Pair k="bucket" v={`${f.bucketMinutes} min`} /> : null}
      </dl>
    </div>
  )
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex gap-1.5">
      <dt>{k}</dt>
      <dd className="text-fg-muted">{v}</dd>
    </span>
  )
}
