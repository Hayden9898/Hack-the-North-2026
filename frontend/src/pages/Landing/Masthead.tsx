import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'

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
          {[
            ['#docket', 'Docket'],
            ['#exhibit', 'Exhibit A'],
            ['#limits', 'Limits'],
            ['#method', 'Method'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-sm text-body text-fg-muted transition-colors duration-150 hover:text-fg"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <ThemeToggle />
          <Button asChild size="sm">
            <Link to="/app">
              Open console
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
