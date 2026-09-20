import { ChevronDown } from 'lucide-react'
import * as motionReact from 'motion/react'
import { Fragment, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Legend,
  LegendItem,
  LegendLabel,
  LegendMarker,
  LegendValue,
  Ring,
  RingCenter,
  RingChart,
  useLegendItem,
} from '@/components/charts'
import { LiquidGlassCard } from '@/components/kokonutui/liquid-glass-card'
import ParticleButton from '@/components/kokonutui/particle-button'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'
import { ActivityStrip } from './ActivityStrip'
import { DATASET, EXHIBIT, INCIDENTS, RUN } from './data'
import { Pressable, Stagger, StaggerItem } from './interactive'
import { Section, Stamp } from './parts'
import { EVENTS, SERIES_START } from './series'

const { AnimatePresence, motion } = motionReact

/**
 * The hero.
 *
 * Asymmetric on purpose: the argument occupies seven columns and the record five, so the page
 * opens with a clear primary read instead of a centred hero. Three things carry the "this is an
 * instrument, not a brochure" feeling, and all three are real components rather than styled divs:
 *
 *   · the Run Record sits in a KokonutUI <LiquidGlassCard> — the glass rim, backdrop distortion
 *     and hover sheen are the library's, so the texture matches everywhere it is reused;
 *   · the verdict split is a bklit <RingChart>, hover-linked to a bklit <Legend> in both
 *     directions, so pointing at a class anywhere updates the ring, the legend and the centre
 *     read-out at once — detail on demand instead of everything at once;
 *   · the stat tiles carry real <AreaChart> sparklines over the daily series.
 *
 * Every figure comes from ./data.ts or is summed from ./series.ts. Nothing here is illustrative.
 */

/** The three scored classes, inner ring → outer ring. */
type VerdictSlice = {
  /** Denominator caption. Stated per row because the two bases differ. */
  base: string
  label: string
  value: number
  maxValue: number
  color: string
}

const SCORED = RUN.visibleNormal + RUN.visibleSuspicious + RUN.visibleHighRisk
const FLAGGED = RUN.visibleHighRisk + RUN.visibleSuspicious

/**
 * Ring geometry note: a ring is `value / maxValue`, so putting all three on the 22,982
 * denominator would draw two arcs of 0.009% and 0.02% — literally nothing. The two flagged
 * classes are therefore drawn against the flagged subtotal and each row states its own base.
 * The counts are the story and they are always on screen as text.
 */
const VERDICTS: VerdictSlice[] = [
  {
    label: 'high risk',
    value: RUN.visibleHighRisk,
    maxValue: FLAGGED,
    color: 'var(--color-high-risk)',
    base: `of ${FLAGGED} flagged`,
  },
  {
    label: 'suspicious',
    value: RUN.visibleSuspicious,
    maxValue: FLAGGED,
    color: 'var(--color-suspicious)',
    base: `of ${FLAGGED} flagged`,
  },
  {
    label: 'normal',
    value: RUN.visibleNormal,
    maxValue: SCORED,
    color: 'var(--color-normal)',
    base: `of ${SCORED.toLocaleString()} scored`,
  },
]

const DAY_MS = 86_400_000
const SERIES_ORIGIN = Date.parse(`${SERIES_START}T00:00:00Z`)
const dayDate = (i: number) => new Date(SERIES_ORIGIN + i * DAY_MS)

const MONTH_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })

type Point = { date: Date; events: number }

/** Events per calendar month across the whole replay. Sums to DATASET.lines. */
function monthlyEvents(): Point[] {
  const out: Point[] = []
  let bucket = ''
  for (let i = 0; i < EVENTS.length; i++) {
    const d = dayDate(i)
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    if (key !== bucket) {
      bucket = key
      out.push({ date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), events: 0 })
    }
    out[out.length - 1].events += EVENTS[i]
  }
  return out
}

/** Daily events for the last calendar month of the replay — the window the run scored. */
function lastMonthDaily(): Point[] {
  const last = dayDate(EVENTS.length - 1)
  const out: Point[] = []
  for (let i = 0; i < EVENTS.length; i++) {
    const d = dayDate(i)
    if (d.getUTCFullYear() === last.getUTCFullYear() && d.getUTCMonth() === last.getUTCMonth()) {
      out.push({ date: d, events: EVENTS[i] })
    }
  }
  return out
}

const HEADLINE = [
  ['An', 'access', 'log,'],
  ['cross-examined.'],
]

export function OpeningStatement() {
  return (
    <Section className="relative isolate pt-14 pb-16 sm:pt-20 sm:pb-20">
      {/* Ambient wash. Gives the glass card something to refract and keeps the fold warm.
          Token gradients only — never a literal colour. */}
      <div
        aria-hidden
        className="-z-10 pointer-events-none absolute inset-x-0 -top-24 h-[28rem] bg-gradient-to-b from-accent-wash to-transparent"
      />
      <div
        aria-hidden
        className="-z-10 pointer-events-none absolute -top-16 right-0 h-[24rem] w-[38rem] rounded-full bg-gradient-to-bl from-chart-1-wash to-transparent blur-3xl"
      />

      <div className="grid gap-x-12 gap-y-14 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <Stamp>
            {DATASET.sha256Short} · {DATASET.lines.toLocaleString()} lines · {DATASET.from} — {DATASET.to}
          </Stamp>

          <Headline />

          <p className="mt-7 max-w-[54ch] text-[1.0625rem] text-fg-muted leading-[1.65]">
            Log &amp; Order replays {DATASET.lines.toLocaleString()} HTTP requests in causal order, scores
            each one against five deterministic rules, and groups what matches into incidents built from
            typed facts. Every fact carries the query that produced it — so any claim on screen can be
            recomputed against the original lines, and disagreed with.
          </p>

          <ProofCapsule />

          <StatTiles />

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {/* ParticleButton swallows its own onClick (it only fires the particles), so the
                anchor has to be the outer element. The inner button is taken out of the tab
                order to keep this a single control for keyboard and screen readers. */}
            <Pressable className="w-full sm:w-auto">
              <Link to="/app" aria-label="Open the console" className="inline-flex w-full rounded-md">
                <ParticleButton size="lg" tabIndex={-1} className="w-full shadow-md">
                  Open the console
                </ParticleButton>
              </Link>
            </Pressable>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
              <a href="#exhibit">See the {EXHIBIT.count}-denial proof</a>
            </Button>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-5">
          <Record />
        </div>
      </div>

      <ActivityStrip className="mt-16 border-border border-t pt-8" />
    </Section>
  )
}

/**
 * The claim, raised word by word. The whole string is rendered either way — the animation is
 * decoration on top of text that is already there, never the thing that reveals it.
 */
function Headline() {
  const reduced = useReducedMotion()
  const cls = 'mt-7 font-sans text-[clamp(2.75rem,7vw,4.5rem)] leading-[0.95] tracking-[-0.03em]'

  if (reduced) {
    return (
      <h1 className={cls}>
        An access log,
        <br />
        cross-examined.
      </h1>
    )
  }

  let n = -1
  return (
    <h1 className={cls}>
      <span className="sr-only">An access log, cross-examined.</span>
      <span aria-hidden>
        {HEADLINE.map((line) => (
          <span key={line.join('-')} className="block">
            {line.map((word, wi) => {
              n += 1
              return (
                // The space has to be a real text node between the inline-blocks, not padding
                // inside them: adjacent inline-blocks give the line no break opportunity, and
                // the headline overflows a 320px viewport.
                <Fragment key={word}>
                  <motion.span
                    className="inline-block"
                    initial={{ opacity: 0, y: '0.36em' }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: DUR.slow, ease: EASE.out, delay: n * 0.07 }}
                  >
                    {word}
                  </motion.span>
                  {wi < line.length - 1 ? ' ' : null}
                </Fragment>
              )
            })}
          </span>
        ))}
      </span>
    </h1>
  )
}

/**
 * The worked example, with the reproducing query folded away behind a disclosure. The headline
 * claim is always visible; the machinery that makes it checkable is one click away.
 */
function ProofCapsule() {
  const { count, proof, grant, query, factId } = EXHIBIT
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div className="mt-8 rounded-doc border border-border bg-surface shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-border border-b px-4 py-2.5">
        <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
          Worked example · exhibit A
        </span>
        <span className="font-mono text-caption text-fg-subtle">
          recorded {proof.recorded} · recomputed {proof.recomputed} ·{' '}
          <span className="text-normal">{proof.matches ? 'match' : 'MISMATCH'}</span>
        </span>
      </div>

      <div className="px-4 py-3.5">
        <p className="text-body text-fg-muted">
          <span className="font-mono text-fg">403</span> for seven months, then{' '}
          <span className="font-mono text-fg">200</span> — after{' '}
          <span className="font-mono text-fg">{count}</span> counted denials of the same request.
        </p>
        <CodeBlock
          className="mt-3 border-0 bg-transparent"
          code={grant.raw}
          emphasize={['200 8459200']}
          copyable={false}
          wrap="always"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-border border-t pt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="inline-flex items-center gap-1.5 font-mono text-caption text-fg-muted uppercase tracking-[0.08em] transition-colors duration-150 hover:text-fg"
          >
            <ChevronDown
              aria-hidden
              className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')}
            />
            {open ? 'Hide the query' : 'Show the query behind the count'}
          </button>
          <a
            href="#exhibit"
            className="font-mono text-caption text-accent uppercase tracking-[0.08em] underline decoration-accent/30 underline-offset-4 transition-colors duration-150 hover:decoration-accent"
          >
            Open exhibit A
          </a>
        </div>

        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="query"
              id={panelId}
              className="overflow-hidden"
              initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: reduced ? DUR.instant : DUR.base, ease: EASE.out }}
            >
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm bg-sunken p-3 font-mono text-caption">
                <dt className="text-fg-subtle uppercase">query</dt>
                <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">
                  {query.id} · v{query.version}
                </dd>
                {Object.entries(query.params).map(([k, v]) => (
                  <div key={k} className="col-span-2 grid grid-cols-subgrid">
                    <dt className="text-fg-subtle uppercase">{k}</dt>
                    <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">{String(v)}</dd>
                  </div>
                ))}
                <dt className="text-fg-subtle uppercase">fact</dt>
                <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">{factId}</dd>
              </dl>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Three headline figures, each labelled with its unit and backed by the real daily series. */
function StatTiles() {
  // useReducedMotion() is `boolean | null` until the media query resolves; treat unknown as
  // "motion is fine" so the charts still animate, and honour it the moment it is known.
  const reduced = useReducedMotion() === true
  const months = useMemo(monthlyEvents, [])
  const days = useMemo(lastMonthDaily, [])

  const spanLabel = `${MONTH_FMT.format(months[0].date)} — ${MONTH_FMT.format(months[months.length - 1].date)}`
  const windowLabel = MONTH_FMT.format(days[0].date)
  const highRisk = INCIDENTS.filter((i) => i.verdict === 'high_risk').length
  const suspicious = INCIDENTS.filter((i) => i.verdict === 'suspicious').length

  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-3">
      <StatTile label="Lines replayed · rows" value={DATASET.lines.toLocaleString()} caption={`events/month · ${spanLabel}`}>
        <Sparkline data={months} reduced={reduced} />
      </StatTile>

      <StatTile label="Scored · March window" value={SCORED.toLocaleString()} caption={`events/day · ${windowLabel}`}>
        <Sparkline data={days} reduced={reduced} />
      </StatTile>

      <StatTile
        label="Incidents · filed"
        value={RUN.incidentsTotal.toLocaleString()}
        caption={`${highRisk} high risk · ${suspicious} suspicious`}
      >
        {/* No series behind an incident count, so this tile shows the dockets themselves
            rather than a sparkline invented to fill the slot. */}
        <div className="flex h-full flex-col justify-center gap-1.5">
          {INCIDENTS.map((incident) => (
            <div key={incident.docket} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  incident.verdict === 'high_risk' ? 'bg-high-risk' : 'bg-suspicious',
                )}
              />
              <span className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.06em]">
                docket {incident.docket} · {incident.rules.join(' ')}
              </span>
            </div>
          ))}
        </div>
      </StatTile>
    </div>
  )
}

function StatTile({
  label,
  value,
  caption,
  children,
}: {
  label: string
  value: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md">
      <p className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]">{label}</p>
      <p className="mt-1.5 font-mono text-title text-fg tabular-nums">{value}</p>
      <div className="mt-3 h-14">{children}</div>
      <p className="mt-2 font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.06em]">{caption}</p>
    </div>
  )
}

/** A bklit AreaChart with its margins stripped — a real chart, not a hand-drawn polyline. */
function Sparkline({ data, reduced }: { data: Point[]; reduced: boolean }) {
  return (
    <AreaChart
      data={data as unknown as Record<string, unknown>[]}
      xDataKey="date"
      /* aspectRatio is overridden so all three tiles keep one height whatever their width. */
      style={{ aspectRatio: 'auto', height: '100%' }}
      margin={{ top: 6, right: 2, bottom: 4, left: 2 }}
      animationDuration={reduced ? 0 : 900}
    >
      <Area
        dataKey="events"
        fill="var(--chart-1)"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        fillOpacity={0.22}
        gradientToOpacity={0}
        showHighlight={false}
        animate={!reduced}
      />
    </AreaChart>
  )
}

/**
 * The run record, in glass. Rows first so the arithmetic closes in reading order
 * (warmup + scored = lines replayed), then the verdict split.
 */
function Record() {
  const rows: [string, string][] = [
    ['lines replayed', DATASET.lines.toLocaleString()],
    ['rejected', `${DATASET.rejects}`],
    ['warmup — history, not scored', RUN.warmupNormal.toLocaleString()],
    ['scored in the March window', SCORED.toLocaleString()],
    ['scoring mode', `${RUN.modelHealth} — no model in this run`],
  ]

  return (
    <LiquidGlassCard className="gap-0 rounded-lg border-border bg-surface/80 p-0 shadow-lg backdrop-blur-xl hover:shadow-lg">
      <div className="flex items-center justify-between border-border border-b px-5 py-3">
        <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">Run record</span>
        <span className="font-mono text-caption text-fg-subtle">{RUN.state}</span>
      </div>

      <Stagger className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <StaggerItem
            key={k}
            className="flex flex-col gap-0.5 px-5 py-2.5 transition-colors duration-150 hover:bg-hover sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
          >
            <span className="text-body text-fg-muted">{k}</span>
            <span className="min-w-0 font-mono text-body text-fg tabular-nums [overflow-wrap:anywhere] sm:text-right">
              {v}
            </span>
          </StaggerItem>
        ))}
      </Stagger>

      <VerdictSplit />
    </LiquidGlassCard>
  )
}

/**
 * The verdict breakdown: a bklit RingChart and a bklit Legend sharing one hover index, so
 * pointing at either updates both plus the centre read-out. The raw counts stay on screen as
 * text — 7 of 22,982 is the entire argument and a ring must not be allowed to hide it.
 */
function VerdictSplit() {
  const [hovered, setHovered] = useState<number | null>(null)

  return (
    <figure className="border-border border-t px-5 py-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
          Verdicts · events
        </span>
        <span className="font-mono text-caption text-fg-subtle">{SCORED.toLocaleString()} scored</span>
      </figcaption>

      <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center lg:flex-col xl:flex-row">
        <RingChart
          data={VERDICTS}
          size={164}
          strokeWidth={12}
          ringGap={5}
          baseInnerRadius={46}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
          className="shrink-0"
        >
          {VERDICTS.map((v, i) => (
            <Ring key={v.label} index={i} lineCap="round" />
          ))}
          <RingCenter
            defaultLabel="scored"
            valueClassName="font-mono font-medium tabular-nums leading-none text-fg text-[clamp(0.75rem,20cqw,1.5rem)]"
            labelClassName="mt-1 max-w-full truncate font-mono uppercase tracking-[0.08em] text-fg-subtle text-[clamp(0.5625rem,9cqw,0.6875rem)]"
          />
        </RingChart>

        <Legend
          items={VERDICTS}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
          className="w-full min-w-0 gap-0.5"
        >
          <LegendItem className="rounded-sm px-2 py-1.5 data-[hovered]:bg-hover">
            <div className="flex items-baseline gap-2.5">
              <LegendMarker className="h-2 w-2 shrink-0 translate-y-px rounded-[2px]" />
              <LegendLabel className="font-mono text-caption text-fg uppercase tracking-[0.06em]" />
              <LegendValue className="ml-auto font-mono text-body text-fg tabular-nums" />
            </div>
            <LegendBase />
          </LegendItem>
        </Legend>
      </div>

      <p className="mt-3 text-body text-fg-muted">
        <span className="font-mono text-fg">{FLAGGED}</span> of{' '}
        <span className="font-mono text-fg">{SCORED.toLocaleString()}</span> scored events matched a rule
        at all — {RUN.visibleHighRisk} high risk, {RUN.visibleSuspicious} suspicious. The remaining{' '}
        {RUN.visibleNormal.toLocaleString()} are normal.
      </p>
    </figure>
  )
}

/**
 * The denominator for whichever legend row is being rendered. Reads the cloned row's context
 * rather than being passed down, because Legend clones one child element for every item.
 */
function LegendBase() {
  const { item } = useLegendItem()
  const base = VERDICTS.find((v) => v.label === item.label)?.base
  if (!base) return null
  return (
    <p className="pl-[1.125rem] font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.06em]">
      {base}
    </p>
  )
}
