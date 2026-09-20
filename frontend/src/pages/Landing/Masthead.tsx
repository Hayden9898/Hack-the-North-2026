import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'

/**
 * Section links carry a mono suffix naming their payload. "Exhibit A" alone has no
 * information scent, and it points at the single most persuasive thing in the product.
 */
const SECTIONS = [
  ['#docket', 'Docket', '3'],
  ['#exhibit', 'Exhibit A', '77 denials'],
  ['#limits', 'Limits', '6'],
  ['#method', 'Method', 'R1–R5'],
] as const

export function Masthead() {
  return (
    <header className="sticky top-0 z-40 border-border border-b bg-bg/92 backdrop-blur-[2px]">
      <div className="mx-auto flex w-full max-w-[76rem] items-center gap-6 px-6 py-3 sm:px-10">
        <Link to="/" className="flex items-baseline gap-2.5 rounded-sm">
          <span className="font-serif text-[1.375rem] leading-none tracking-tight">Log &amp; Order</span>
          <span className="hidden font-mono text-caption text-fg-subtle uppercase sm:inline">
            investigation console
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-6 md:flex">
          {SECTIONS.map(([href, label, hint]) => (
            <a
              key={href}
              href={href}
              className="group/nav flex items-baseline gap-1.5 rounded-sm text-body text-fg-muted transition-colors duration-150 hover:text-fg"
            >
              {label}
              <span className="font-mono text-[0.6875rem] text-fg-subtle">{hint}</span>
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 md:ml-0">
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
      <nav className="-mb-px flex w-full min-w-0 gap-5 overflow-x-auto border-border border-t px-6 py-2 md:hidden">
        {SECTIONS.map(([href, label, hint]) => (
          <a
            key={href}
            href={href}
            className="shrink-0 rounded-sm font-mono text-caption text-fg-muted uppercase"
          >
            {label} <span className="text-fg-subtle">{hint}</span>
          </a>
        ))}
      </nav>
    </header>
  )
}
