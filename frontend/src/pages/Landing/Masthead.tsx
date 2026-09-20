import { ArrowUpRight } from 'lucide-react'
import * as motionReact from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LiquidGlassCard } from '@/components/kokonutui/liquid-glass-card'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'
import { EXHIBIT, INCIDENTS, RULES, UNKNOWNS } from './data'

const { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } = motionReact

/**
 * Sticky masthead.
 *
 * A seven-screen document needs wayfinding, so this bar does four jobs rather than one:
 *   1. names the page,
 *   2. says where you are (animated underline + live active state),
 *   3. says how far through you are (accent hairline on the bottom edge), and
 *   4. says what is in each section before you jump to it (glass hover pop-out).
 *
 * Every figure in the pop-outs is derived from ./data.ts at module load, never retyped — the
 * nav cannot drift from the evidence it is pointing at.
 */

type SectionLink = {
  id: string
  label: string
  /** Mono suffix rendered as a chip. "Exhibit A" alone has no information scent. */
  count: string
  unit: string
  detail: string
  blurb: string
}

const HIGH_RISK = INCIDENTS.filter((i) => i.verdict === 'high_risk').length
const SUSPICIOUS = INCIDENTS.filter((i) => i.verdict === 'suspicious').length

/** Document order matters: the active-section scan takes the last match above the trigger. */
const SECTIONS: SectionLink[] = [
  {
    id: 'docket',
    label: 'Docket',
    count: String(INCIDENTS.length),
    unit: 'incidents',
    detail: `${HIGH_RISK} high risk · ${SUSPICIOUS} suspicious`,
    blurb: 'Every incident the run opened, each filed with the qualifier that limits it.',
  },
  {
    id: 'exhibit',
    label: 'Exhibit A',
    count: `${EXHIBIT.count} denials`,
    unit: 'prior 403s',
    detail: `recomputed ${EXHIBIT.proof.recomputed} · recorded ${EXHIBIT.proof.recorded}`,
    blurb: 'The denials that came before the grant, and the query that reproduces the count.',
  },
  {
    id: 'limits',
    label: 'Limits',
    count: String(UNKNOWNS.length),
    unit: 'unknowns',
    detail: 'named, not buried',
    blurb: 'What these logs cannot tell you, stated before you have to ask for it.',
  },
  {
    id: 'method',
    label: 'Method',
    count: `R1–R${RULES.length}`,
    unit: 'rules',
    detail: `${RULES.length} deterministic detectors`,
    blurb: 'The rules that fire, in the same words the system files them under.',
  },
]

/**
 * Which section owns the viewport right now: the last one whose top has passed under the bar.
 * Cheaper and far more predictable than an IntersectionObserver ratio race between sections of
 * wildly different heights (Exhibit A is four times the height of Limits).
 */
function activeSectionId(): string | null {
  const trigger = 148
  let current: string | null = null
  for (const section of SECTIONS) {
    const el = document.getElementById(section.id)
    if (el && el.getBoundingClientRect().top <= trigger) current = section.id
  }
  return current
}

export function Masthead() {
  const reduced = useReducedMotion()
  const [active, setActive] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [peeked, setPeeked] = useState<string | null>(null)

  const { scrollY, scrollYProgress } = useScroll()
  // Spring the progress so the hairline glides instead of stepping with the wheel. Reduced
  // motion gets the raw value: still accurate, just no easing.
  const springy = useSpring(scrollYProgress, { stiffness: 260, damping: 40, restDelta: 0.001 })
  const progress = reduced ? scrollYProgress : springy

  // motion batches this on rAF, so the four layout reads below never fight the scroll.
  useMotionValueEvent(scrollY, 'change', (y) => {
    setScrolled(y > 6)
    setActive(activeSectionId())
  })

  // First paint and resize: the scroll event alone would leave a deep-linked load with no
  // active section at all.
  useEffect(() => {
    const sync = () => {
      setActive(activeSectionId())
      setScrolled(window.scrollY > 6)
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-border border-b',
        // Glass, not a flat plate: the paper reads through it as content slides under.
        'bg-bg/85 backdrop-blur-xl backdrop-saturate-150',
        'transition-shadow duration-200 ease-out-quint',
        scrolled && 'shadow-md',
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full max-w-[76rem] items-center gap-6 px-6 transition-[padding] duration-200 ease-out-quint sm:px-10',
          scrolled ? 'py-2' : 'py-3',
        )}
      >
        <Link to="/" className="flex shrink-0 items-baseline gap-2.5 rounded-sm">
          <span className="font-serif text-[1.375rem] leading-none tracking-tight">Log &amp; Order</span>
          <span className="hidden font-mono text-caption text-fg-subtle uppercase sm:inline">
            investigation console
          </span>
        </Link>

        <nav aria-label="Sections" className="ml-auto hidden items-center gap-1 md:flex">
          {SECTIONS.map((section) => (
            <DesktopLink
              key={section.id}
              section={section}
              active={active === section.id}
              open={peeked === section.id}
              reduced={Boolean(reduced)}
              onPeek={setPeeked}
            />
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3 md:ml-0">
          <ThemeToggle />
          {/*
            Outline, not filled: the hero's primary is the only brass fill in the first
            viewport, so the accent stays earned rather than sprinkled.
          */}
          <Button asChild size="sm" variant="outline">
            <Link to="/app">
              Open console
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/*
        Mobile wayfinding. The page is roughly eight screens tall on a phone; deleting the
        section links there while keeping a three-way theme toggle would be a priority
        inversion, so the links stay and scroll horizontally instead.
      */}
      <nav
        aria-label="Sections"
        className={cn(
          '-mb-px flex w-full min-w-0 items-center gap-4 overflow-x-auto border-border border-t px-6 pt-2 pb-2.5 md:hidden',
          // Fade the right edge so a clipped item reads as scrollable rather than as broken.
          '[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]',
        )}
      >
        {SECTIONS.map((section) => {
          const isActive = active === section.id
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 rounded-sm font-mono text-[0.6875rem] uppercase transition-colors duration-150',
                isActive ? 'text-fg' : 'text-fg-muted',
              )}
            >
              {section.label}
              <span className="hidden rounded-sm bg-chip px-1.5 py-0.5 text-fg-subtle min-[420px]:inline">
                {section.count}
              </span>
              {isActive ? (
                <motion.span
                  aria-hidden
                  layoutId={reduced ? undefined : 'masthead-active-compact'}
                  className="absolute inset-x-0 -bottom-1.5 h-[2px] rounded-full bg-accent"
                  transition={{ duration: DUR.fast, ease: EASE.out }}
                />
              ) : null}
            </a>
          )
        })}
      </nav>

      {/*
        Read progress. Pinned to the header's bottom edge so it doubles as the hairline between
        the bar and the document — one element, two jobs, no extra chrome.
      */}
      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent"
      />
    </header>
  )
}

/**
 * A desktop nav link: label, count chip, animated active underline, and a glass pop-out that
 * says what is actually in the section. Detail on demand — the bar stays four short words wide
 * until you ask it for more.
 */
function DesktopLink({
  section,
  active,
  open,
  reduced,
  onPeek,
}: {
  section: SectionLink
  active: boolean
  open: boolean
  reduced: boolean
  onPeek: (id: string | null) => void
}) {
  return (
    <div className="relative" onMouseEnter={() => onPeek(section.id)} onMouseLeave={() => onPeek(null)}>
      <a
        href={`#${section.id}`}
        aria-current={active ? 'true' : undefined}
        onFocus={() => onPeek(section.id)}
        onBlur={() => onPeek(null)}
        className={cn(
          'relative flex items-baseline gap-1.5 rounded-sm px-2 py-1 text-body transition-colors duration-150',
          active ? 'text-fg' : 'text-fg-muted hover:text-fg',
        )}
      >
        {section.label}
        <span
          className={cn(
            'rounded-sm bg-chip px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none transition-colors duration-150',
            active ? 'text-fg-muted' : 'text-fg-subtle',
          )}
        >
          {section.count}
        </span>
        {active ? (
          <motion.span
            aria-hidden
            layoutId={reduced ? undefined : 'masthead-active'}
            className="absolute inset-x-1 -bottom-0.5 h-[2px] rounded-full bg-accent"
            transition={{ duration: DUR.fast, ease: EASE.out }}
          />
        ) : null}
      </a>

      <AnimatePresence>
        {open ? (
          <motion.div
            // pointer-events-none: nothing in here is clickable, and a panel that could be
            // hovered would flicker the moment the cursor crossed the gap.
            className="pointer-events-none absolute top-full left-1/2 z-50 w-[17.5rem] pt-3"
            initial={{ opacity: 0, y: reduced ? 0 : -6, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: reduced ? 0 : -6, x: '-50%' }}
            transition={{ duration: reduced ? DUR.instant : DUR.fast, ease: EASE.out }}
          >
            <LiquidGlassCard
              glassSize="sm"
              glassEffect={!reduced}
              className="gap-0 rounded-lg border border-border bg-surface/85 p-0 shadow-lg backdrop-blur-xl"
            >
              <div className="flex items-baseline justify-between gap-3 border-border border-b px-3.5 py-2.5">
                <span className="font-mono text-[0.6875rem] text-fg-subtle uppercase tracking-[0.08em]">
                  {section.count} {section.unit}
                </span>
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              </div>
              <div className="px-3.5 py-3">
                <p className="text-body text-fg leading-snug">{section.blurb}</p>
                <p className="mt-2 font-mono text-[0.6875rem] text-fg-subtle">{section.detail}</p>
              </div>
            </LiquidGlassCard>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
