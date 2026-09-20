import { ArrowUpRight, ChevronDown } from 'lucide-react'
import * as motionReact from 'motion/react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LiquidGlassCard } from '@/components/kokonutui/liquid-glass-card'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'
import { INCIDENTS, RULE_TEXT, RUN, UNKNOWNS } from './data'
import { type RuleTone, RuleTag, Section, Stamp } from './parts'

const { AnimatePresence, motion, useMotionTemplate, useMotionValue, useSpring, useTransform } = motionReact

/**
 * A numbered docket of three records, not a card grid.
 *
 * Two things drive every decision here:
 *
 *   1. HIERARCHY. The two high-risk records are typographically larger, sit on a raised white
 *      panel and physically tilt toward the cursor; the suspicious one is recessed into the
 *      paper and set quieter. Three equal cards would erase the single distinction this whole
 *      product exists to make.
 *   2. DETAIL ON DEMAND. Collapsed, a row is scannable in one line — number, verdict, rules,
 *      subject, headline, date. The qualifier, the run-order span, the rule texts and the
 *      declared unknowns live inside a pop-out that opens on click. One record is open at a
 *      time, so the page never presents more than one argument at once.
 *
 * The pop-out is a real KokonutUI <LiquidGlassCard> floating over a verdict-tinted bed, which
 * is what gives it the glass refraction; the 3D comes from a perspective + spring tilt with the
 * docket number lifted on its own Z plane. (KokonutUI's MouseEffectCard was read and rejected:
 * it is a fixed 400px marketing card with its own hardcoded palette and CTAs, so it cannot wrap
 * a record row — the sanctioned motion tilt is used instead.)
 */

/**
 * One identity colour per rule, page-wide. Rules are a categorical index, never a verdict —
 * Method imports this so an R2 chip is the same teal in the docket and in the rule list.
 */
export const RULE_TONE: Record<string, RuleTone> = {
  R1: 'chart-1',
  R2: 'chart-2',
  R3: 'chart-3',
  R4: 'chart-4',
  R5: 'chart-5',
}

type Incident = (typeof INCIDENTS)[number]
type FilterId = 'all' | 'high_risk' | 'suspicious'

/** Counts are derived from INCIDENTS, never typed in — they cannot drift from the records. */
const FILTERS: { id: FilterId; label: string; count: number; tone: string }[] = [
  { id: 'all', label: 'All', count: INCIDENTS.length, tone: 'bg-chip text-fg-muted' },
  {
    id: 'high_risk',
    label: 'High risk',
    count: INCIDENTS.filter((inc) => inc.verdict === 'high_risk').length,
    tone: 'bg-high-risk-wash text-high-risk',
  },
  {
    id: 'suspicious',
    label: 'Suspicious',
    count: INCIDENTS.filter((inc) => inc.verdict === 'suspicious').length,
    tone: 'bg-suspicious-wash text-suspicious',
  },
]

export function Docket() {
  const [filter, setFilter] = useState<FilterId>('all')
  const [openDocket, setOpenDocket] = useState<string>(INCIDENTS[0].docket)

  const rows = useMemo(
    () => INCIDENTS.filter((inc) => filter === 'all' || inc.verdict === filter),
    [filter],
  )

  /* Changing the slice opens the first record in it, so the filter always lands the reader on
     something rather than on a stack of shut drawers. */
  function selectFilter(next: FilterId) {
    setFilter(next)
    const first = INCIDENTS.find((inc) => next === 'all' || inc.verdict === next)
    setOpenDocket(first ? first.docket : '')
  }

  return (
    <Section id="docket" className="scroll-mt-16 py-20 sm:py-28">
      <div className="grid items-end gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <Stamp>
            Docket · {RUN.incidentsTotal} incidents · March 2026 · rules only
          </Stamp>

          <h2 className="mt-7 max-w-[22ch] font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
            Three things in eight months looked wrong.
          </h2>
          <p className="mt-5 max-w-[58ch] text-body text-fg-muted">
            Everything below is the detector&rsquo;s own wording, including the parts where it
            declines to conclude anything. Those qualifiers are part of the record.
          </p>
        </div>

        <VerdictFilter value={filter} onChange={selectFilter} />
      </div>

      <ol className="mt-12 flex list-none flex-col gap-4">
        {rows.map((inc) => (
          <IncidentRow
            key={inc.docket}
            inc={inc}
            open={openDocket === inc.docket}
            onToggle={() => setOpenDocket((cur) => (cur === inc.docket ? '' : inc.docket))}
          />
        ))}
      </ol>

      <p className="mt-6 font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
        Showing {rows.length} of {INCIDENTS.length} records · one open at a time · select a row
        for its qualifier and unknowns
      </p>
    </Section>
  )
}

/**
 * The docket's one control, modelled on the ActivityStrip granularity pill: a sliding
 * layoutId pill, counts carried in the verdict's own colour so the split is legible before
 * you click anything.
 */
function VerdictFilter({ value, onChange }: { value: FilterId; onChange: (next: FilterId) => void }) {
  const reduced = useReducedMotion()
  return (
    <div className="lg:justify-self-end">
      <span className="block font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">
        Filter · verdict
      </span>
      <div
        role="group"
        aria-label="Filter the docket by verdict"
        className="mt-2 flex gap-0.5 rounded-md border border-border bg-chip p-0.5"
      >
        {FILTERS.map((f) => {
          const active = f.id === value
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(f.id)}
              className={cn(
                'relative rounded-[5px] px-3 py-1.5 font-mono text-caption uppercase transition-colors duration-150',
                active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
              )}
            >
              {active ? (
                <motion.span
                  layoutId={reduced ? undefined : 'docket-filter-pill'}
                  className="absolute inset-0 rounded-[5px] bg-surface shadow-sm"
                  transition={{ duration: DUR.fast, ease: EASE.out }}
                />
              ) : null}
              <span className="relative flex items-center gap-2">
                {f.label}
                <span className={cn('rounded-sm px-1 py-px text-[0.625rem] tabular-nums', f.tone)}>
                  {f.count}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function IncidentRow({ inc, open, onToggle }: { inc: Incident; open: boolean; onToggle: () => void }) {
  const reduced = useReducedMotion()
  const major = inc.verdict === 'high_risk'
  const headId = `docket-${inc.docket}-head`
  const panelId = `docket-${inc.docket}-record`
  /* Token var, never a literal colour — the pop-out's bed is the record's own verdict hue. */
  const hue = major ? 'var(--color-high-risk)' : 'var(--color-suspicious)'

  return (
    <li className="group/row list-none">
      <Tilt
        enabled={major}
        className={cn(
          'relative isolate rounded-lg border transition-[box-shadow,border-color] duration-200 ease-out-quint',
          major
            ? 'border-border bg-surface shadow-sm hover:border-border-strong hover:shadow-md'
            : 'border-border/70 bg-sunken hover:border-border',
          open && (major ? 'shadow-md' : 'shadow-sm'),
        )}
      >
        {/* 4px identity rail — the verdict, readable before a single word is. */}
        <span
          aria-hidden
          className={cn(
            'absolute left-0 z-10 w-1 rounded-r-full [transform:translateZ(10px)]',
            major ? 'inset-y-5 bg-high-risk' : 'inset-y-3.5 bg-suspicious',
          )}
        />

        <div className="group/head relative [transform-style:preserve-3d]">
          {/* Stretched toggle: the whole header is the hit target, and it sits UNDER the
              content so the rule links and the row action inside stay independently
              clickable instead of being illegally nested inside a button. */}
          <button
            type="button"
            id={headId}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className="absolute inset-0 z-0 cursor-pointer rounded-lg"
          >
            <span className="sr-only">Docket {inc.docket} record</span>
          </button>

          <div
            className={cn(
              'pointer-events-none relative z-10 [transform-style:preserve-3d]',
              major ? 'py-6 pr-14 pl-7' : 'py-4 pr-12 pl-6',
            )}
          >
            <div
              className={cn(
                'grid gap-x-6 gap-y-3 [transform-style:preserve-3d]',
                major ? 'sm:grid-cols-[5rem_minmax(0,1fr)]' : 'sm:grid-cols-[4rem_minmax(0,1fr)]',
              )}
            >
              {/* Identity column, lifted onto its own Z plane so it parallaxes under the tilt. */}
              <div
                className={cn(
                  'flex items-center gap-3 sm:block',
                  major && '[transform:translateZ(24px)]',
                )}
              >
                <div>
                  <Caption>Docket</Caption>
                  <span
                    className={cn(
                      'mt-1 block font-mono leading-none tabular-nums',
                      major ? 'text-title text-fg' : 'text-heading text-fg-subtle',
                    )}
                  >
                    {inc.docket}
                  </span>
                </div>
                <StatusChip verdict={inc.verdict} size="sm" className="sm:mt-3" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="pointer-events-auto flex flex-wrap items-center gap-1.5">
                    {inc.rules.map((r) => (
                      <RuleTag
                        key={r}
                        href={`#${r.toLowerCase()}`}
                        title={`${r} — ${RULE_TEXT[r]}`}
                        tone={RULE_TONE[r] ?? 'neutral'}
                      >
                        {r}
                      </RuleTag>
                    ))}
                  </span>
                  <span className="min-w-0 truncate font-mono text-caption text-fg-subtle">
                    {inc.key}
                  </span>
                  <span className="ms-auto flex items-center gap-2">
                    <span className="font-mono text-caption text-fg-subtle tabular-nums">
                      {inc.when}
                    </span>
                    <Button
                      asChild
                      variant="ghost"
                      size="xs"
                      className="pointer-events-auto font-mono text-caption uppercase tracking-[0.06em]"
                    >
                      <Link to="/app" aria-label={`Open incident ${inc.docket} in the console`}>
                        open <ArrowUpRight className="size-3" />
                      </Link>
                    </Button>
                  </span>
                </div>

                <h3
                  className={cn(
                    'mt-3 max-w-[54ch] text-pretty',
                    major
                      ? 'font-medium text-[1.3125rem] text-fg leading-[1.3] tracking-[-0.015em]'
                      : 'font-medium text-heading text-fg-muted',
                  )}
                >
                  {inc.headline}
                </h3>
              </div>
            </div>
          </div>

          <motion.span
            aria-hidden
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: reduced ? DUR.instant : DUR.fast, ease: EASE.out }}
            className={cn(
              'pointer-events-none absolute z-10 flex size-7 items-center justify-center rounded-full border border-border bg-surface text-fg-subtle',
              'transition-colors duration-150 group-hover/head:border-accent/40 group-hover/head:text-accent',
              major ? 'top-6 right-5 [transform:translateZ(18px)]' : 'top-4 right-4',
            )}
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        </div>

        {/* The pop-out. Height-auto so the row grows rather than the page jumping. */}
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="record"
              id={panelId}
              role="region"
              aria-labelledby={headId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: reduced ? DUR.instant : DUR.base, ease: EASE.out }}
              className="overflow-hidden"
            >
              <div className={cn('relative', major ? 'px-7 pb-7' : 'px-6 pb-6')}>
                {/* Verdict bed: the thing the glass refracts. Token hue, no literal colour. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl"
                  style={{
                    background: `radial-gradient(120% 130% at 6% 0%, color-mix(in oklch, ${hue} 18%, transparent), transparent 64%)`,
                  }}
                />

                <LiquidGlassCard
                  glassSize="sm"
                  className="relative gap-0 rounded-lg border-border/60 p-5 sm:p-6"
                >
                  <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <div className="min-w-0">
                      {/* The system stating its own limits is the point, so it gets a label. */}
                      <Caption>Qualifier · the detector&rsquo;s own limit</Caption>
                      <p className="mt-2 border-border-strong border-l-2 pl-4 text-body text-pretty text-fg-muted italic">
                        {inc.qualifier}
                      </p>
                    </div>

                    <div className="grid content-start gap-5">
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Seq span · run order" value={inc.span} />
                        <Field label="Window" value={inc.when} />
                      </div>

                      <div>
                        <Caption>Rules fired · {inc.rules.length}</Caption>
                        <ul className="mt-2 grid list-none gap-2">
                          {inc.rules.map((r) => (
                            <li key={r} className="flex gap-2.5">
                              <RuleTag
                                href={`#${r.toLowerCase()}`}
                                tone={RULE_TONE[r] ?? 'neutral'}
                                className="mt-px shrink-0"
                              >
                                {r}
                              </RuleTag>
                              <span className="min-w-0 text-[0.8125rem] text-fg-muted leading-[1.45]">
                                {RULE_TEXT[r]}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 border-border/60 border-t pt-5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Caption>Unknowns · {UNKNOWNS.length} declared, docket-wide</Caption>
                      <a
                        href="#limits"
                        className="font-mono text-[0.625rem] text-accent uppercase tracking-[0.14em] transition-opacity duration-150 hover:opacity-75"
                      >
                        what each code means
                      </a>
                    </div>
                    <ul className="mt-2.5 flex list-none flex-wrap gap-1.5">
                      {UNKNOWNS.map(([code, meaning]) => (
                        <li key={code}>
                          <span
                            title={meaning}
                            className="inline-flex rounded-sm border border-border bg-chip/70 px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted"
                          >
                            {code}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.14em]">
                      Record {inc.docket} · {RUN.modelHealth.replace('_', ' ')}
                    </p>
                  </div>
                </LiquidGlassCard>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Tilt>
    </li>
  )
}

/** Small mono caption. Every panel and every number on this page says what it is. */
function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'block font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.14em]',
        className,
      )}
    >
      {children}
    </span>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Caption>{label}</Caption>
      <span className="mt-1.5 block font-mono text-mono text-fg tabular-nums">{value}</span>
    </div>
  )
}

const TILT_SPRING = { stiffness: 220, damping: 24, mass: 0.4 } as const
const TILT_DEG = 3

/**
 * Real 3D: perspective on the frame, spring-damped rotation on the panel, `preserve-3d` so
 * the children that opt in (the docket number, the chevron, the rail) sit on their own Z
 * planes and parallax. A cursor-tracked glare completes the surface.
 *
 * Only the high-risk records get it — physical presence is a rank, not a decoration. Reduced
 * motion returns the flat panel, unchanged in every other respect.
 */
function Tilt({
  enabled,
  className,
  children,
}: {
  enabled: boolean
  className?: string
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const frame = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const sx = useSpring(px, TILT_SPRING)
  const sy = useSpring(py, TILT_SPRING)
  const rotateX = useTransform(sy, [0, 1], [TILT_DEG, -TILT_DEG])
  const rotateY = useTransform(sx, [0, 1], [-TILT_DEG, TILT_DEG])
  const glareX = useTransform(sx, (v: number) => `${(v * 100).toFixed(1)}%`)
  const glareY = useTransform(sy, (v: number) => `${(v * 100).toFixed(1)}%`)
  const glare = useMotionTemplate`radial-gradient(460px circle at ${glareX} ${glareY}, color-mix(in oklch, var(--color-accent) 9%, transparent), transparent 62%)`

  if (!enabled || reduced) return <div className={className}>{children}</div>

  return (
    <div
      ref={frame}
      className="[perspective:1400px]"
      onPointerMove={(e) => {
        const r = frame.current?.getBoundingClientRect()
        if (!r) return
        px.set((e.clientX - r.left) / r.width)
        py.set((e.clientY - r.top) / r.height)
      }}
      onPointerLeave={() => {
        px.set(0.5)
        py.set(0.5)
      }}
    >
      <motion.div className={cn(className, '[transform-style:preserve-3d]')} style={{ rotateX, rotateY }}>
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/row:opacity-100"
          style={{ background: glare }}
        />
        {children}
      </motion.div>
    </div>
  )
}
