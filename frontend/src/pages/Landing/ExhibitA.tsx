import { ArrowUpRight, Check, Minus, Plus } from 'lucide-react'
import * as motionReact from 'motion/react'
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  BarDepthBack,
  BarDepthFront,
  BarPulse,
  BarXAxis,
  ChartTooltip,
  Grid,
  YAxis,
} from '@/components/charts'
import { LiquidGlassCard } from '@/components/kokonutui/liquid-glass-card'
import { CodeBlock } from '@/components/ui/code-block'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'
import { DATASET, EXHIBIT, RUN } from './data'
import { CountUp, Magnetic } from './interactive'
import { Band, Section, Stamp } from './parts'
import { C403, SERIES_START } from './series'

const { AnimatePresence, motion } = motionReact

/**
 * The climax, and the one section that breaks the page's own template.
 *
 * Every other section opens with a stamp and an Instrument Serif headline. This one opens
 * with the evidence — an exhibit should lead with the exhibit — and the count itself acts as
 * the headline, with the sentence demoted to a mono caption beside it. Without one deliberate
 * violation the page reads as a grid applied consistently rather than as an authored
 * document, which is the uniform-card failure wearing better clothes.
 *
 * Neither log strip is tinted with a verdict colour. An approved access grant produces
 * exactly the AFTER line, so colouring it as a verdict would assert the thing this section
 * explicitly refuses to assert. The accent rule marks the relationship instead, and the two
 * status codes are marked in accent inside the strips — a pointer, not a judgement.
 *
 * HONESTY NOTE ON THE CHART. The 77 is a per-account, per-path count produced by fact
 * f_835847db3186ab94. series.ts carries one 403 total per day for the whole dataset and no
 * per-account split, so that chart cannot be drawn from it. Rather than fabricate a split,
 * the panel plots the series that does exist — every 403 in the dataset, per calendar month —
 * and says so in its own caption, legend and tooltip. The 77 is never implied by a bar.
 */
export function ExhibitA() {
  const { count, denial, grant, query, proof, factId, provenanceHashShort, incidentId } = EXHIBIT
  const reduced = useReducedMotion()

  // Which slice of the 403 series to plot. The cutoff window is the one the fact actually
  // counts under (`before_seq` 168338, recorded on 15 Mar 2026), so it is the default.
  const [scope, setScope] = useState<ScopeId>('cutoff')
  const lastDay = scope === 'cutoff' ? CUTOFF_INDEX : C403.length - 1

  const buckets = useMemo(() => bucketByMonth(lastDay), [lastDay])
  const total = useMemo(() => buckets.reduce((a, b) => a + b.denials, 0), [buckets])
  const peak = useMemo(
    () => buckets.reduce((a, b) => (b.denials > a.denials ? b : a), buckets[0]),
    [buckets],
  )
  const windowLabel = `${DAY_FMT.format(new Date(START))} — ${DAY_FMT.format(new Date(START + lastDay * DAY_MS))}`

  /* Verbatim from the fact's `query` block. These six strings are the whole reason the count
     is checkable, so they are rendered exactly as recorded — no reformatting, no rounding. */
  const paramValues: Record<ParamKey, string> = {
    query: `${query.id} v${query.version}`,
    account: query.params.account,
    path: query.params.path,
    status: String(query.params.status),
    cutoff_seq: `${query.params.before_seq} — denials counted before this line`,
    provenance: provenanceHashShort,
  }

  return (
    <Band tone="raised">
      <Section id="exhibit" className="scroll-mt-16 py-20 sm:py-28">
        <Stamp>Exhibit A · fact {factId}</Stamp>

        {/* ---- The evidence, first. Two byte-exact lines with the same account and path. ---- */}
        <div className="mt-8">
          <CodeBlock
            label={`before · ${denial.when} · first of the ${count}`}
            code={denial.raw}
            lineNumber={denial.line}
            emphasize={['403 245']}
          />

          <div className="grid gap-x-10 gap-y-2 lg:grid-cols-12">
            <div className="flex items-stretch gap-5 sm:gap-8 lg:col-span-5">
              {/* The accent rule is the only thing asserting a relation between the two
                  strips — not a verdict colour on either of them. */}
              <div aria-hidden className="ml-1 w-0.5 shrink-0 rounded-full bg-accent sm:ml-4" />

              <Magnetic tilt={5} className="group flex min-w-0 flex-col justify-center py-8">
                <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
                  Recorded count · prior 403 responses
                </span>
                <span className="mt-2 block font-mono font-medium text-[clamp(4.5rem,13vw,9rem)] text-fg leading-[0.78] tracking-[-0.055em] tabular-nums">
                  <CountUp to={count} />
                </span>
                <p className="mt-4 font-mono text-caption text-fg-subtle uppercase">
                  The same request, refused {count} times
                </p>
                <p className="mt-2 max-w-[34ch] text-body text-fg-muted">
                  prior <span className="font-mono text-fg">403</span> responses for this exact account
                  and resource, counted under the same cutoff.
                </p>
              </Magnetic>
            </div>

            {/* ---- The 403 series that genuinely exists, labelled as exactly that. ---- */}
            <figure className="min-w-0 pb-8 lg:col-span-7 lg:pt-8">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <figcaption className="min-w-0">
                  <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
                    403 responses · all {DATASET.accounts} accounts · per month
                  </span>
                  <p className="mt-1 font-mono text-caption text-fg-muted">{windowLabel}</p>
                </figcaption>
                <ScopeFilter value={scope} onChange={setScope} />
              </div>

              <div className="mt-3 rounded-lg border border-border bg-bg p-3 shadow-sm sm:p-4">
                <BarChart
                  data={buckets as unknown as Record<string, unknown>[]}
                  xDataKey="label"
                  aspectRatio="16 / 9"
                  /* scaleBand padding RATIO (0-1), not pixels: at 1 the bandwidth collapses
                     to 0 and every bar silently disappears. */
                  barGap={0.3}
                  animationDuration={reduced ? 0 : 700}
                  revealSignature={scope}
                >
                  <Grid horizontal numTicksRows={4} stroke="var(--chart-grid)" />
                  {/* The 3D glass surfaces: side face + lid behind, gloss in front. */}
                  <BarDepthBack dataKey="denials" color="var(--chart-2)" />
                  <Bar dataKey="denials" fill="var(--chart-2)" lineCap="round" perspective minBarHeight={2} />
                  <BarDepthFront dataKey="denials" />
                  {/* Marks the month the grant landed in. A position, not a verdict. */}
                  <BarPulse dataKey="denials" activeIndex={buckets.length - 1} pulsePaused={!!reduced} />
                  <YAxis numTicks={4} />
                  <BarXAxis maxLabels={8} />
                  <ChartTooltip
                    rows={(point) => [
                      {
                        color: 'var(--chart-2)',
                        label: '403 · all accounts',
                        value: Number(point.denials ?? 0).toLocaleString(),
                      },
                      {
                        color: 'var(--chart-label)',
                        label: String(point.span ?? ''),
                        value: `${String(point.days ?? '')} days`,
                      },
                    ]}
                  />
                </BarChart>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.6875rem] text-fg-subtle uppercase">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-chart-2" /> 403 responses
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-[2px] border border-chart-2/60 bg-chart-2-wash motion-reduce:animate-none" />{' '}
                  month of line {grant.line}
                </span>
                <span className="ml-auto normal-case">
                  {total.toLocaleString()} total · peak {peak.denials} in {peak.label}
                </span>
              </div>

              <p className="mt-3 max-w-[52ch] text-body text-fg-muted">
                <span className="font-mono text-caption text-fg uppercase">What this chart is:</span>{' '}
                the daily series records one 403 total per day for the whole dataset, with no
                per-account split. This chart is therefore every account, not the {count}. The{' '}
                {count} is this one account and this one path, and it comes from the query below.
              </p>
            </figure>
          </div>

          <CodeBlock
            label={`after · ${grant.when} · same account, same path`}
            code={grant.raw}
            lineNumber={grant.line}
            emphasize={['200 8459200']}
          />
        </div>

        {/* ---- What the exhibit does and does not claim, and the proof that it recomputes. ---- */}
        <div className="mt-12 grid gap-x-12 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <p className="max-w-[48ch] text-body text-fg-muted">
              One account. One file. One source address. For seven months the server answered{' '}
              <span className="font-mono text-fg">403</span>. Then it answered{' '}
              <span className="font-mono text-fg">200</span> and sent 8.46 MB.
            </p>
            <p className="mt-4 max-w-[48ch] text-body text-fg-muted">
              That is a measured change in observed behaviour. An approved access grant looks exactly
              the same from the log, so the count is shown with the query that produced it, rather than
              as a conclusion.
            </p>
          </div>

          <div className="relative min-w-0 lg:col-span-7">
            {/* Something for the glass to refract. Token washes only — no literal colours. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 rounded-[2rem] opacity-80 blur-2xl"
              style={{
                background:
                  'radial-gradient(60% 60% at 15% 0%, var(--color-accent-wash), transparent 70%), radial-gradient(55% 60% at 95% 100%, var(--color-chart-2-wash), transparent 70%)',
              }}
            />

            <LiquidGlassCard
              className="rounded-xl border-border bg-surface/70 p-5 shadow-md backdrop-blur-xl sm:p-6"
              glassSize="default"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-normal/25 bg-normal-wash px-3 py-2">
                <Check className="size-3.5 shrink-0 text-normal" />
                <span className="font-mono text-caption text-fg uppercase">Recomputed on request</span>
                <span className="font-mono text-caption text-fg-subtle">
                  recorded {proof.recorded} · recomputed {proof.recomputed} ·{' '}
                  <span className="text-normal">{proof.matches ? 'match' : 'MISMATCH'}</span>
                </span>
              </div>

              <p className="mt-3 max-w-[62ch] text-body text-fg-muted">
                The console re-runs this query against the original lines under the same cutoff and
                compares the result to what was recorded.
              </p>

              <Link
                to={`/app/runs/${RUN.id}/incidents/${incidentId}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-sm font-mono text-caption text-accent uppercase transition-opacity duration-150 hover:opacity-80"
              >
                Page all {count} denials <ArrowUpRight className="size-3" />
              </Link>

              <div className="mt-4 overflow-hidden rounded-md border border-border bg-sunken">
                <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
                  <span className="font-mono text-[0.6875rem] text-fg-subtle uppercase tracking-[0.08em]">
                    Query parameters · {PARAMS.length} fields
                  </span>
                  <span className="font-mono text-[0.6875rem] text-fg-subtle uppercase">
                    press + for what a field does
                  </span>
                </div>
                <dl className="divide-y divide-border">
                  {PARAMS.map(({ k, note }) => (
                    <ParamRow key={k} name={k} value={paramValues[k]} note={note} />
                  ))}
                </dl>
              </div>
            </LiquidGlassCard>
          </div>
        </div>
      </Section>
    </Band>
  )
}

/* ------------------------------------------------------------------------------------- *
 * Derivation. Nothing below invents a figure: every number is summed out of series.ts's
 * C403 array, and the cutoff day is the date of EXHIBIT.grant (line 168338, 15 Mar 2026).
 * ------------------------------------------------------------------------------------- */

const DAY_MS = 86_400_000
const START = Date.parse(`${SERIES_START}T00:00:00Z`)

/** The grant's own day. `before_seq` 168338 is a line recorded on 15 Mar 2026. */
const CUTOFF_ISO = '2026-03-15'
const CUTOFF_INDEX = Math.min(
  Math.round((Date.parse(`${CUTOFF_ISO}T00:00:00Z`) - START) / DAY_MS),
  C403.length - 1,
)

const MONTH_FMT = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
})
const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const SPAN_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

type MonthBucket = {
  key: string
  label: string
  span: string
  denials: number
  days: number
  from: number
  to: number
}

/**
 * Sum the daily 403 series into calendar months, up to and including `lastIndex`. Nothing is
 * resampled or smoothed, and a partial month stays partial — its real day count travels with
 * it into the tooltip so a short bar can never be mistaken for a drop in traffic.
 */
function bucketByMonth(lastIndex: number): MonthBucket[] {
  const out: MonthBucket[] = []
  for (let i = 0; i <= lastIndex && i < C403.length; i++) {
    const date = new Date(START + i * DAY_MS)
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    let bucket = out[out.length - 1]
    if (!bucket || bucket.key !== key) {
      bucket = { key, label: MONTH_FMT.format(date), span: '', denials: 0, days: 0, from: i, to: i }
      out.push(bucket)
    }
    bucket.denials += C403[i]
    bucket.days += 1
    bucket.to = i
  }
  for (const bucket of out) {
    const from = SPAN_FMT.format(new Date(START + bucket.from * DAY_MS))
    const to = SPAN_FMT.format(new Date(START + bucket.to * DAY_MS))
    bucket.span = `${from} – ${to}`
  }
  return out
}

/* ---------------------------------- The filter ---------------------------------------- */

type ScopeId = 'cutoff' | 'full'

const SCOPES: { id: ScopeId; label: string; hint: string }[] = [
  { id: 'cutoff', label: 'To cutoff', hint: 'through the day of line 168338' },
  { id: 'full', label: 'Full run', hint: 'all 243 days' },
]

/**
 * Two ways to slice the same series, so the reader can see what the cutoff parameter is
 * actually doing rather than being told. A sliding pill, not a select: one click, and the
 * last bar visibly shortens to the fifteen days the count is allowed to see.
 */
function ScopeFilter({ value, onChange }: { value: ScopeId; onChange: (s: ScopeId) => void }) {
  const reduced = useReducedMotion()
  return (
    <div
      role="group"
      aria-label="Series window"
      className="flex shrink-0 gap-0.5 rounded-md border border-border bg-chip p-0.5"
    >
      {SCOPES.map((s) => {
        const active = s.id === value
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            title={s.hint}
            onClick={() => onChange(s.id)}
            className={cn(
              'relative rounded-[5px] px-3 py-1 font-mono text-caption uppercase transition-colors duration-150',
              active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {active ? (
              <motion.span
                layoutId={reduced ? undefined : 'exhibit-scope-pill'}
                className="absolute inset-0 rounded-[5px] bg-surface shadow-sm"
                transition={{ duration: DUR.fast, ease: EASE.out }}
              />
            ) : null}
            <span className="relative">{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------- The query parameters ---------------------------------- */

type ParamKey = 'query' | 'account' | 'path' | 'status' | 'cutoff_seq' | 'provenance'

/**
 * The six fields that make the count reproducible, each with one line saying what it does.
 * The glosses describe the parameter's role only — they add no figure and no claim.
 */
const PARAMS: { k: ParamKey; note: string }[] = [
  { k: 'query', note: 'The stored query and version the count was produced by. Same version, same lines, same answer.' },
  { k: 'account', note: 'The single account the denials are counted for. Not a group, not a pattern.' },
  { k: 'path', note: 'The single resource the count covers.' },
  { k: 'status', note: 'Only responses carrying this status code are counted.' },
  { k: 'cutoff_seq', note: 'Denials are counted before this line, so the count cannot include the grant itself.' },
  { k: 'provenance', note: 'Short hash recorded alongside the count, identifying the inputs it was computed from.' },
]

/**
 * One parameter, with its explanation on demand. Everything the reader needs to check the
 * count is on screen; everything they need only if they are arguing with it is one press
 * away. That is the difference between a dense table and an unreadable one.
 */
function ParamRow({ name, value, note }: { name: string; value: string; note: string }) {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <div className="px-3 py-2 transition-colors duration-150 hover:bg-hover">
      <div className="grid gap-x-4 font-mono text-mono sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-fg-subtle">{name}</dt>
        <dd className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-fg-muted [overflow-wrap:anywhere]">{value}</span>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border',
                'bg-surface text-fg-subtle shadow-sm transition-colors duration-150',
                'hover:border-border-strong hover:text-fg',
              )}
            >
              {open ? <Minus className="size-3" /> : <Plus className="size-3" />}
              <span className="sr-only">
                {open ? `Hide what ${name} does` : `Explain what ${name} does`}
              </span>
            </button>
          </div>

          <AnimatePresence initial={false}>
            {open ? (
              <motion.div
                id={id}
                className="overflow-hidden"
                initial={reduced ? false : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: reduced ? 0 : DUR.fast, ease: EASE.out }}
              >
                <p className="max-w-[54ch] pt-2 pr-8 font-sans text-body text-fg-muted">{note}</p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </dd>
      </div>
    </div>
  )
}
