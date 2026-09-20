import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The page's section marker: an accent tick, a mono label, and a hairline running off to the
 * right. Left-aligned rather than centred — the rule escaping toward the margin is what keeps
 * the page reading as a document instead of as a stack of symmetrical marketing blocks.
 *
 * Every band on the page opens with one of these. Consistent labelling is most of what makes
 * a layout read as an instrument rather than as generated filler.
 */
export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex w-full flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <span aria-hidden className="h-3 w-0.5 shrink-0 rounded-full bg-accent" />
      {/* min-w-0, not shrink-0: a long stamp must wrap rather than widen the page. */}
      <span className="min-w-0 font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">{children}</span>
      {/* basis-full drops the rule onto its own line when the label wraps; basis-0 lets it sit
          inline and absorb the remainder on wider screens. Never `w-full` here — as a flex item
          in a shrink-to-fit container that resolves against an indefinite width and blows the
          track out (it pushed the mobile page to 978px inside a 390px viewport). */}
      <span aria-hidden className="h-px flex-1 basis-full bg-border sm:min-w-8 sm:basis-0" />
    </div>
  )
}

/** A section wrapper that holds the page's single measure and vertical rhythm. */
export function Section({
  id,
  children,
  className,
}: {
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('mx-auto w-full max-w-[76rem] px-6 sm:px-10', className)}>
      {children}
    </section>
  )
}

/**
 * A full-bleed horizontal band. Sections alternate `bg-bg` (paper) and `bg-surface` (white)
 * so the page reads as a sequence of clearly divided, labelled zones — the thing the old
 * single-colour scroll was missing.
 */
export function Band({
  id,
  tone = 'paper',
  children,
  className,
}: {
  id?: string
  tone?: 'paper' | 'raised'
  children: ReactNode
  className?: string
}) {
  return (
    <div
      id={id}
      className={cn(
        'w-full border-border',
        tone === 'raised' ? 'border-y bg-surface' : 'bg-bg',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Small mono rule tag, e.g. R2 / R5.
 *
 * `tone` selects a colour from the categorical chart index so a given rule keeps one identity
 * everywhere it appears on the page. It is an INDEX colour, not a verdict — never map a rule
 * tag onto normal/suspicious/high-risk.
 */
export type RuleTone = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6' | 'neutral'

// Complete literal class strings: Tailwind cannot see a class name built by interpolation.
const RULE_TONE_CLASS: Record<RuleTone, string> = {
  'chart-1': 'border-chart-1/30 bg-chart-1-wash text-chart-1',
  'chart-2': 'border-chart-2/30 bg-chart-2-wash text-chart-2',
  'chart-3': 'border-chart-3/30 bg-chart-3-wash text-chart-3',
  'chart-4': 'border-chart-4/30 bg-chart-4-wash text-chart-4',
  'chart-5': 'border-chart-5/30 bg-chart-5-wash text-chart-5',
  'chart-6': 'border-chart-6/30 bg-chart-6-wash text-chart-6',
  neutral: 'border-border bg-chip text-fg-muted',
}

export function RuleTag({
  children,
  href,
  title,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  href?: string
  title?: string
  tone?: RuleTone
  className?: string
}) {
  const cls = cn(
    'inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium tracking-wide',
    RULE_TONE_CLASS[tone],
    className,
  )
  if (!href) {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    )
  }
  return (
    <a
      href={href}
      title={title}
      className={cn(cls, 'transition-[filter,box-shadow] duration-150 hover:brightness-95 hover:shadow-sm')}
    >
      {children}
    </a>
  )
}
