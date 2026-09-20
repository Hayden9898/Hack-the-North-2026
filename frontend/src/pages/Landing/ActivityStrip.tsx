import * as motionReact from 'motion/react'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  BarDepthBack,
  BarDepthFront,
  BarXAxis,
  ChartTooltip,
  Grid,
} from '@/components/charts'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'
import { C401, C403, EVENTS, FLAGGED, SERIES_START } from './series'

const { motion } = motionReact

/**
 * Eight months of real traffic — the page's single best picture of the argument: a flat,
 * unremarkable year of access logs, and then three days in March where the detector has
 * something to say.
 *
 * Rendered with the bklit chart kit (src/components/charts) rather than hand-rolled divs, so
 * it gets the 3D glass bar surfaces, the crosshair tooltip and the reference bands for free.
 * Every value is a real daily count from the timeseries endpoint and the series sums to the
 * same 180,800 quoted everywhere else — it is evidence, not an illustration, which is the only
 * reason a good-looking element belongs on this page at all.
 */

type Grain = 'month' | 'week' | 'day'

const GRAINS: { id: Grain; label: string; size: number; hint: string }[] = [
  { id: 'month', label: 'Monthly', size: 31, hint: '8 buckets' },
  { id: 'week', label: 'Weekly', size: 7, hint: '35 buckets' },
  { id: 'day', label: 'Daily', size: 1, hint: '243 buckets' },
]

const DAY_MS = 86_400_000
const START = Date.parse(SERIES_START + 'T00:00:00Z')

function dayLabel(i: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(START + i * DAY_MS).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })
}

type Bucket = {
  label: string
  events: number
  denials: number
  unauth: number
  days: number
  from: number
  to: number
  verdict?: 'high_risk' | 'suspicious'
}

/** Sum the daily series into buckets of `size` days. Nothing is dropped or resampled. */
function bucketise(size: number): Bucket[] {
  const out: Bucket[] = []
  for (let i = 0; i < EVENTS.length; i += size) {
    const to = Math.min(i + size, EVENTS.length)
    let events = 0
    let denials = 0
    let unauth = 0
    let verdict: Bucket['verdict']
    for (let d = i; d < to; d++) {
      events += EVENTS[d]
      denials += C403[d]
      unauth += C401[d]
      const f = FLAGGED[d]
      if (f === 'high_risk') verdict = 'high_risk'
      else if (f === 'suspicious' && verdict !== 'high_risk') verdict = 'suspicious'
    }
    out.push({
      label:
        size === 1
          ? dayLabel(i, { day: 'numeric', month: 'short' })
          : size >= 28
            ? dayLabel(i, { month: 'short', year: '2-digit' })
            : dayLabel(i, { day: 'numeric', month: 'short' }),
      events,
      denials,
      unauth,
      days: to - i,
      from: i,
      to: to - 1,
      verdict,
    })
  }
  return out
}

export function ActivityStrip({ className }: { className?: string }) {
  const reduced = useReducedMotion()
  const [grain, setGrain] = useState<Grain>('week')
  const size = GRAINS.find((g) => g.id === grain)?.size ?? 7

  const data = useMemo(() => bucketise(size), [size])

  // The contiguous run of flagged buckets, drawn as a tinted band behind the bars rather than
  // by recolouring them: the bars encode volume, the band encodes the detector's attention.
  const flagged = useMemo(() => {
    const idx = data.map((b, i) => (b.verdict ? i : -1)).filter((i) => i >= 0)
    if (!idx.length) return null
    return { start: Math.min(...idx), end: Math.max(...idx), worst: data[idx[idx.length - 1]].verdict }
  }, [data])

  const total = useMemo(() => data.reduce((a, b) => a + b.events, 0), [data])

  return (
    <figure className={cn('w-full', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <figcaption className="min-w-0">
          <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
            Events per day · 243 days · 01 Aug 2025 — 31 Mar 2026
          </span>
          <p className="mt-1 text-body text-fg-muted">
            {total.toLocaleString()} requests replayed in causal order.{' '}
            <span className="text-fg">Hover any bar</span> for that bucket&rsquo;s counts.
          </p>
        </figcaption>
        <GrainFilter value={grain} onChange={setGrain} />
      </div>

      <div className="relative mt-5 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-5">
        {flagged ? <FlagBand start={flagged.start} end={flagged.end} count={data.length} worst={flagged.worst} /> : null}
        <BarChart
          data={data as unknown as Record<string, unknown>[]}
          xDataKey="label"
          aspectRatio="16 / 5"
          /* scaleBand padding RATIO (0-1), not pixels: at 1 the bandwidth collapses to 0
             and every bar silently disappears. Denser grains want a smaller gap. */
          barGap={grain === 'day' ? 0.06 : grain === 'week' ? 0.22 : 0.34}
          animationDuration={reduced ? 0 : 700}
        >
          <Grid horizontal numTicksRows={4} stroke="var(--chart-grid)" />
          
          {/* Back and front are the 3D glass surfaces — side face, lid, and the gloss overlay. */}
          <BarDepthBack dataKey="events" color="var(--chart-1)" />
          <Bar dataKey="events" fill="var(--chart-1)" lineCap="round" perspective minBarHeight={2} />
          <BarDepthFront dataKey="events" />
          <BarXAxis maxLabels={grain === 'day' ? 8 : 12} />
          <ChartTooltip />
        </BarChart>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[0.6875rem] text-fg-subtle uppercase">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-chart-1" /> events
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] border border-high-risk/50 bg-high-risk-wash" /> detector flagged · 14–16 mar
        </span>
        <span className="ml-auto normal-case text-fg-subtle">
          {GRAINS.find((g) => g.id === grain)?.hint} · one bar is {size === 1 ? 'one day' : `${size} days`}
        </span>
      </div>
    </figure>
  )
}

/**
 * Granularity filter. A sliding pill (motion layoutId) rather than a select — the whole point
 * is that changing the grain is one click and you can see the shape change.
 */
function GrainFilter({ value, onChange }: { value: Grain; onChange: (g: Grain) => void }) {
  const reduced = useReducedMotion()
  return (
    <div role="group" aria-label="Bucket size" className="flex shrink-0 gap-0.5 rounded-md border border-border bg-chip p-0.5">
      {GRAINS.map((g) => {
        const active = g.id === value
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(g.id)}
            className={cn(
              'relative rounded-[5px] px-3 py-1 font-mono text-caption uppercase transition-colors duration-150',
              active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {active ? (
              <motion.span
                layoutId={reduced ? undefined : 'grain-pill'}
                className="absolute inset-0 rounded-[5px] bg-surface shadow-sm"
                transition={{ duration: DUR.fast, ease: EASE.out }}
              />
            ) : null}
            <span className="relative">{g.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The detector's attention, drawn over the plot rather than by recolouring bars: the bars
 * encode volume, this band encodes where the rules fired. Positioned by bucket index so it
 * stays correct at every granularity.
 */
function FlagBand({
  start,
  end,
  count,
  worst,
}: {
  start: number
  end: number
  count: number
  worst?: 'high_risk' | 'suspicious'
}) {
  const left = (start / count) * 100
  const width = Math.max(((end - start + 1) / count) * 100, 0.8)
  const high = worst === 'high_risk'
  return (
    <div
      aria-hidden
      // Matches BarChart's 40px plot margins so the band lines up with the bars themselves.
      className="pointer-events-none absolute z-10"
      style={{ left: 'calc(1rem + 40px)', right: 'calc(1rem + 40px)', top: 'calc(1rem + 52px)', bottom: 'calc(1rem + 40px)' }}
    >
      <div
        className={cn(
          'state-hatch absolute top-0 bottom-0 rounded-sm border border-dashed',
          high ? 'border-high-risk/55 text-high-risk' : 'border-suspicious/55 text-suspicious',
        )}
        style={{ left: `${left}%`, width: `${width}%` }}
      >
        <span
          className={cn(
            'absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border bg-surface px-1.5 py-0.5 font-mono text-[0.625rem] uppercase shadow-sm',
            high ? 'border-high-risk/40 text-high-risk' : 'border-suspicious/40 text-suspicious',
          )}
        >
          14–16 Mar · flagged
        </span>
      </div>
    </div>
  )
}
