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
      {/* min-w-0, not shrink-0: a long stamp must wrap rather than widen the page. */}
      <span className="min-w-0 font-mono text-caption text-fg-subtle uppercase">{children}</span>
      <span aria-hidden className="h-px min-w-8 flex-1 bg-border" />
    </div>
  )
}

/**
 * A short entrance rise, played on mount rather than on scroll.
 *
 * This deliberately does NOT use whileInView. Scroll-triggered reveals leave the element at
 * opacity 0 until an IntersectionObserver fires, so anything that stops that callback — a
 * headless render, an anchor jump straight to mid-page, an observer that never fires after a
 * viewport resize — leaves real content permanently invisible. Page copy must not depend on
 * an observer to become readable. A mount animation always completes.
 */
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
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE.out, delay }}
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
