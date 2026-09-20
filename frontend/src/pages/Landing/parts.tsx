import * as motionReact from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'

const { motion } = motionReact

/**
 * The page's signature motif: a record stamp sitting on a hairline rule.
 *
 * Deliberately left-aligned rather than centred — the rule running off to the right is what
 * keeps the page feeling like a document and stops every section from being symmetrical.
 */
export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <span className="shrink-0 font-mono text-caption text-fg-subtle uppercase">{children}</span>
      <span aria-hidden className="h-px min-w-8 flex-1 bg-border" />
    </div>
  )
}

/** Scroll-triggered rise. Collapses to a plain fade when the user asks for reduced motion. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-64px' }}
      transition={{ duration: reduced ? DUR.instant : DUR.base, ease: EASE.out, delay: reduced ? 0 : delay }}
    >
      {children}
    </motion.div>
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

/** Small mono rule tag, e.g. R2 / R5. Not a verdict — never colour these semantically. */
export function RuleTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted">
      {children}
    </span>
  )
}
