import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The page's signature motif: a record stamp sitting on a hairline rule.
 *
 * Deliberately left-aligned rather than centred — the rule running off to the right is what
 * keeps the page feeling like a document and stops every section from being symmetrical.
 */
export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex w-full flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {/* min-w-0, not shrink-0: a long stamp must wrap rather than widen the page. */}
      <span className="min-w-0 font-mono text-caption text-fg-subtle uppercase">{children}</span>
      {/* flex-wrap + w-full: when the label takes the whole line the rule drops beneath it at
          full width, instead of being stranded as an orphaned dash beside a wrapped label. */}
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

/** Small mono rule tag, e.g. R2 / R5. Not a verdict — never colour these semantically. */
export function RuleTag({ children, href, title }: { children: ReactNode; href?: string; title?: string }) {
  const cls =
    'rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted'
  if (!href) {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    )
  }
  return (
    <a href={href} title={title} className={cn(cls, 'transition-colors duration-150 hover:border-border-strong hover:text-fg')}>
      {children}
    </a>
  )
}
