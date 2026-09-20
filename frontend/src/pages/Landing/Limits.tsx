import {
  ArrowUpFromLine,
  Braces,
  ChevronDown,
  ClipboardX,
  KeyRound,
  type LucideIcon,
  PenLine,
  UserRoundX,
} from 'lucide-react'
import * as motionReact from 'motion/react'
import { useState } from 'react'
import {
  Bar,
  BarChart,
  BarDepthBack,
  BarDepthFront,
  BarXAxis,
  ChartTooltip,
  Grid,
} from '@/components/charts'
import { TONE_BG, TONE_BORDER, TONE_TEXT, TONE_WASH } from '@/components/charts/tone'
import { LiquidGlassCard } from '@/components/kokonutui/liquid-glass-card'
import { StatusChip } from '@/components/ui/status-chip'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'
import { INCIDENTS, RULES, RUN, UNKNOWNS } from './data'
import { RULE_TONE } from './Docket'
import { Magnetic } from './interactive'
import { RuleTag, Section, Stamp } from './parts'

const { AnimatePresence, motion } = motionReact

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * One muted glyph per declared unknown. Keyed by the code itself rather than by position, so
 * reordering ./data.ts can never silently hand an unknown the wrong icon. A Map (not a record)
 * so a code with no glyph renders nothing instead of throwing.
 */
const UNKNOWN_ICON = new Map<string, LucideIcon>([
  ['session_identity_unavailable', UserRoundX],
  ['credential_source_unknown', KeyRound],
  ['authorized_change_record_unavailable', ClipboardX],
  ['role_change_contents_unavailable', Braces],
  ['external_transfer_unproven', ArrowUpFromLine],
  ['object_creator_unknown', PenLine],
])

/**
 * The section most products would not ship. It is the strongest thing on the page precisely
 * because it is a list of what the system cannot tell you, written by the system.
 *
 * Six cards rather than six rows: each unknown is a self-contained claim about the evidence,
 * and a card lets the code (the row identifier, so fg-muted — a key dimmer than the sentence
 * it labels inverts the scan order) sit above the plain-English meaning instead of beside it.
 * The left rail sticks while the grid scrolls, so the framing never leaves the screen.
 */
export function Limits() {
  return (
    <Section id="limits" className="scroll-mt-16 py-20 sm:py-28">
      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-12">
        <div className="lg:sticky lg:top-24 lg:col-span-4 lg:self-start">
          <Stamp>Limits · {UNKNOWNS.length} declared unknowns</Stamp>
          <h2 className="mt-7 font-sans text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
            What this cannot tell you.
          </h2>
          <p className="mt-5 max-w-[40ch] text-body text-fg-muted">
            Each incident carries its own unknowns, and they travel with the verdict wherever it is
            shown. A tool that only reports what it found is easy to build; reporting what it could
            not determine is the part that makes the rest worth trusting.
          </p>

          <VerdictNote />
        </div>

        <div className="min-w-0 lg:col-span-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-border border-b pb-3">
            <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
              Declared unknowns · {pad(UNKNOWNS.length)} total
            </span>
            <span className="font-mono text-caption text-fg-subtle">
              deduplicated across {INCIDENTS.length} incidents
            </span>
          </div>

          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {UNKNOWNS.map(([code, meaning], i) => (
              <UnknownCard
                key={code}
                code={code}
                meaning={meaning}
                index={i + 1}
                icon={UNKNOWN_ICON.get(code)}
              />
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

/**
 * The one sentence a reader must not skim, so it gets the glass treatment (KokonutUI's
 * LiquidGlassCard) and the only accent fill in the section. Accent is the seal here, not a
 * decoration: nothing else in Limits is orange.
 */
function VerdictNote() {
  return (
    <LiquidGlassCard
      glassSize="sm"
      className="mt-7 max-w-[40ch] gap-0 rounded-lg border-accent/25 bg-accent-wash py-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-3 w-0.5 shrink-0 rounded-full bg-accent" />
        <span className="font-mono text-caption text-fg-muted uppercase tracking-[0.08em]">
          How to read a verdict
        </span>
      </div>
      <p className="mt-3 text-body text-fg-muted">
        &ldquo;High risk&rdquo; here means <span className="font-mono text-fg">urgently investigate</span>. It
        is a priority signal about recorded activity — never a conclusion about a person.
      </p>
    </LiquidGlassCard>
  )
}

/**
 * One declared unknown. `Magnetic` tilts the card toward the cursor on a real 3D transform
 * (and returns a flat div under prefers-reduced-motion), so the grid has depth without any of
 * it being load-bearing for comprehension.
 */
function UnknownCard({
  code,
  meaning,
  index,
  icon: Icon,
}: {
  code: string
  meaning: string
  index: number
  icon?: LucideIcon
}) {
  return (
    <li className="h-full">
      <Magnetic tilt={5} className="group h-full">
        <article
          className={cn(
            'relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface p-5',
            'shadow-sm transition-[box-shadow,border-color] duration-200 ease-out-quint',
            'hover:border-border-strong hover:shadow-md motion-reduce:transition-none',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-chip text-fg-subtle transition-colors duration-200 group-hover:text-accent motion-reduce:transition-none"
            >
              {Icon ? <Icon className="size-4" /> : null}
            </span>
            <span className="font-mono text-caption text-fg-subtle tabular-nums">
              {pad(index)} / {pad(UNKNOWNS.length)}
            </span>
          </div>

          <code className="mt-4 w-fit max-w-full rounded-sm bg-chip px-1.5 py-1 font-mono text-caption text-fg-muted [overflow-wrap:anywhere]">
            {code}
          </code>

          <p className="mt-3 text-body text-fg-muted">{meaning}</p>

          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-accent transition-transform duration-300 ease-out-quint group-hover:scale-x-100 motion-reduce:transition-none"
          />
        </article>
      </Magnetic>
    </li>
  )
}

/** Incidents whose rule_ids cite a given rule. Derived from ./data.ts, never retyped. */
type Incident = (typeof INCIDENTS)[number]
type RuleId = (typeof RULES)[number][0]
const CITED_BY = new Map<string, Incident[]>(
  RULES.map(([id]) => [
    id,
    INCIDENTS.filter((inc) => (inc.rules as readonly string[]).includes(id)),
  ]),
)

/** Rules matched per incident — the only numbers in this section, straight off INCIDENTS. */
const MATCH_ROWS = INCIDENTS.map((inc) => ({
  label: 'Docket ' + inc.docket,
  matched: inc.rules.length,
  ids: inc.rules.join(' · '),
  verdict: inc.verdict === 'high_risk' ? 'high risk' : inc.verdict,
}))

const TOTAL_MATCHES = MATCH_ROWS.reduce((a, r) => a + r.matched, 0)

/**
 * Reference matter, deliberately set below the evidence in weight as well as in order: a
 * smaller heading than Limits, so it does not read as a peer of Exhibit A.
 *
 * The five rules are a numbered flow with a hairline running between the steps, because they
 * are a pipeline — R4 and R5 only ever escalate something an earlier rule already matched.
 * Each step wears its index colour (rail + RuleTag tone) from RULE_TONE, so R1–R5 are the same
 * five colours here as in the Docket, and each step can be opened to show which incidents cite
 * it without any of that detail being on screen by default.
 */
export function Method() {
  return (
    <Section id="method" className="scroll-mt-16 py-20 sm:py-28">
      <Stamp>
        Method · {RULES.length} rules · 1 validator · {RUN.modelHealth}
      </Stamp>

      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <h2 className="font-sans text-[clamp(1.5rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em]">
            Five rules, then a validator.
          </h2>
          <p className="mt-5 max-w-[62ch] text-body text-fg-muted">
            Detection is deterministic: the same lines in the same order always produce the same
            verdicts. A constrained language step may select which facts to surface and propose
            qualified hypotheses, but a validator checks every claim against the recorded facts
            before it reaches the screen.
          </p>
          <blockquote className="mt-6 max-w-[54ch] border-accent border-l-2 pl-5 font-sans text-[1.375rem] text-fg leading-[1.35] tracking-[-0.01em]">
            The language step cannot invent a fact, and it cannot downgrade a detector verdict.
            Rejected proposals are displayed as rejected.
          </blockquote>
          <p className="mt-6 max-w-[62ch] text-body text-fg-muted">
            In this run it was switched off entirely — the rules produced every verdict shown above,
            which is what the <span className="font-mono text-fg">deterministic summaries only</span>{' '}
            state below reports.
          </p>
        </div>

        <div className="min-w-0 lg:col-span-5">
          <MatchLoad />
        </div>
      </div>

      <div className="mt-14 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-border border-b pb-3">
        <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
          The rule book · R1—R{RULES.length} · in pipeline order
        </span>
        <span className="font-mono text-caption text-fg-subtle">open a step to see where it fired</span>
      </div>

      <ol className="mt-8">
        {RULES.map(([id, text], i) => (
          <RuleStep key={id} id={id} text={text} index={i + 1} last={i === RULES.length - 1} />
        ))}
      </ol>
    </Section>
  )
}

/**
 * Rules matched per incident, drawn with the bklit 3D bar surfaces rather than a sparkline:
 * BarDepthBack lays the side face and lid, Bar the solid front, BarDepthFront the glass gloss,
 * and ChartTooltip is the pop-out that names the actual rule ids behind each column.
 *
 * Three bars is a small chart on purpose — it exists to connect the rule book to the docket,
 * not to carry the argument.
 */
function MatchLoad() {
  const reduced = useReducedMotion()
  return (
    <figure className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
          Rules matched · per incident
        </span>
        <span className="font-mono text-caption text-fg-subtle">count</span>
      </figcaption>

      <BarChart
        data={MATCH_ROWS as unknown as Record<string, unknown>[]}
        xDataKey="label"
        aspectRatio="16 / 9"
        /* scaleBand padding RATIO (0-1), not pixels — three wide bands want a generous gap. */
        barGap={0.34}
        animationDuration={reduced ? 0 : 700}
      >
        <Grid horizontal numTicksRows={2} stroke="var(--chart-grid)" />
        <BarDepthBack dataKey="matched" color="var(--chart-1)" />
        <Bar dataKey="matched" fill="var(--chart-1)" lineCap="round" perspective minBarHeight={2} />
        <BarDepthFront dataKey="matched" />
        <BarXAxis maxLabels={3} />
        <ChartTooltip
          rows={(point) => [
            { color: 'var(--chart-1)', label: 'rules matched', value: Number(point.matched) },
            { color: 'var(--chart-label)', label: String(point.ids), value: String(point.verdict) },
          ]}
        />
      </BarChart>

      <p className="mt-2 border-border border-t pt-3 text-body text-fg-muted">
        {TOTAL_MATCHES} matches across {INCIDENTS.length} incidents, from {RULES.length} rules.
      </p>
    </figure>
  )
}

/**
 * One step in the flow: a colour-coded node, the hairline that carries the eye to the next
 * step, the rule itself, and a disclosure holding the incidents that cite it. Detail on
 * demand — the count is always visible so the reader knows there is something to open.
 */
function RuleStep({
  id,
  text,
  index,
  last,
}: {
  id: RuleId
  text: string
  index: number
  last: boolean
}) {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const tone = RULE_TONE[id] ?? 'neutral'
  const cited = CITED_BY.get(id) ?? []
  const panelId = 'cited-by-' + id.toLowerCase()

  return (
    <li
      id={id.toLowerCase()}
      className="grid scroll-mt-28 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-x-6"
    >
      {/* Gutter: the numbered node, and the hairline that joins it to the next step. */}
      <div className="relative flex justify-center">
        {last ? null : <span aria-hidden className="absolute top-11 bottom-0 w-px bg-border" />}
        <span
          className={cn(
            'relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 font-mono text-caption tabular-nums',
            TONE_BORDER[tone],
            TONE_WASH[tone],
            TONE_TEXT[tone],
          )}
        >
          {pad(index)}
        </span>
      </div>

      <div className="min-w-0 pb-6 sm:pb-8">
        <div className="relative overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-shadow duration-200 ease-out-quint hover:shadow-md motion-reduce:transition-none">
          {/* The rail — the same index colour the rule wears in the Docket. */}
          <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', TONE_BG[tone])} />

          <div className="p-5 pl-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <RuleTag tone={tone}>{id}</RuleTag>
              <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
                Step {pad(index)} / {pad(RULES.length)}
              </span>
            </div>

            <p className="mt-3 max-w-[62ch] text-body text-fg-muted">{text}</p>

            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                'mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-chip px-2.5 py-1',
                'font-mono text-caption text-fg-muted uppercase tracking-[0.08em]',
                'transition-colors duration-150 hover:bg-hover hover:text-fg motion-reduce:transition-none',
              )}
            >
              Where it fired · {cited.length}
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-3.5 transition-transform duration-200 ease-out-quint motion-reduce:transition-none',
                  open && 'rotate-180',
                )}
              />
            </button>

            <AnimatePresence initial={false}>
              {open ? (
                <motion.div
                  key="panel"
                  id={panelId}
                  className="overflow-hidden"
                  initial={reduced ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : DUR.base, ease: EASE.out }}
                >
                  <div className="flex flex-wrap items-center gap-2 pt-4">
                    {cited.map((inc) => (
                      <a
                        key={inc.docket}
                        href="#docket"
                        className="inline-flex items-center gap-2.5 rounded-md border border-border bg-sunken px-2.5 py-1.5 transition-colors duration-150 hover:bg-hover motion-reduce:transition-none"
                      >
                        <span className="font-mono text-caption text-fg">Docket {inc.docket}</span>
                        <StatusChip verdict={inc.verdict} size="sm" />
                        <span className="font-mono text-caption text-fg-subtle">{inc.when}</span>
                      </a>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </li>
  )
}
