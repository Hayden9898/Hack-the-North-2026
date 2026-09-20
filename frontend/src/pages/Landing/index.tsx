import BackgroundPaths from '@/components/kokonutui/background-paths'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/motion'
import { Docket } from './Docket'
import { ExhibitA } from './ExhibitA'
import { Limits, Method } from './Limits'
import { Masthead } from './Masthead'
import { OpeningStatement } from './OpeningStatement'
import { Band } from './parts'
import { Closing, Footer, SystemStatus } from './SystemStatus'

/**
 * The page shell.
 *
 * Its only job is division. Every section is wrapped in a full-bleed <Band> that alternates
 * paper (`bg-bg`) and raised (`bg-surface` + border-y), so a seven-screen document reads as a
 * sequence of labelled zones instead of one undifferentiated scroll. The bands own the colour
 * and the hairlines; each section still owns its own vertical rhythm and its own `id`, so
 * nothing here can collide with a sibling's anchor or double up its padding.
 *
 * Order is fixed and load-bearing — claim (Opening), cases (Docket), proof (Exhibit A), what
 * we cannot say (Limits), how (Method), whether it is running (Status), the ask (Closing).
 */
export function Landing() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-body"
      >
        Skip to content
      </a>

      <Masthead />

      <main id="main">
        {/* Paper. The only band with ambience behind it — the argument starts here. */}
        <Band tone="paper" className="relative isolate">
          <HeroAmbience />
          <OpeningStatement />
        </Band>

        <Band tone="raised">
          <Docket />
        </Band>

        <Band tone="paper">
          <ExhibitA />
        </Band>

        <Band tone="raised">
          <Limits />
        </Band>

        <Band tone="paper">
          <Method />
        </Band>

        <Band tone="raised">
          <SystemStatus />
        </Band>

        <Band tone="paper">
          <Closing />
        </Band>
      </main>

      <Footer />
    </div>
  )
}

/**
 * Ambient line-art behind the hero — KokonutUI's `background-paths`, one instance, hero only.
 *
 * Line art rather than a glow: this is a data product, and a colour wash behind the first
 * numbers on the page would read as decoration fighting the evidence. At ~14% it registers as
 * paper texture, and the radial mask fades it out well before it reaches the body copy.
 *
 * The component ships as a standalone hero shell (its own page fill, `min-h-screen`, and a
 * display `<h1>`), and it takes no className. Rather than edit a shared file, the shell is
 * neutralised from here with child selectors — `> div` beats a plain utility on specificity,
 * so no `!important` is needed. Only the SVG survives.
 */
function HeroAmbience() {
  const reduced = useReducedMotion()
  if (reduced) return null

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
        'opacity-[0.14] dark:opacity-[0.22]',
        '[mask-image:radial-gradient(125%_80%_at_50%_0%,black,transparent_76%)]',
        // Strip the shipped hero shell: fill the band instead of the viewport, drop the page
        // background, and remove the display heading it renders by default.
        '[&>div]:h-full [&>div]:min-h-0 [&>div]:bg-transparent [&_h1]:hidden',
      )}
    >
      <BackgroundPaths title="" />
    </div>
  )
}
