import { Docket } from './Docket'
import { ExhibitA } from './ExhibitA'
import { Limits, Method } from './Limits'
import { Masthead } from './Masthead'
import { OpeningStatement } from './OpeningStatement'
import { Footer, SystemStatus } from './SystemStatus'

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
        <OpeningStatement />
        <Docket />
        <ExhibitA />
        <Limits />
        <Method />
        <SystemStatus />
      </main>
      <Footer />
    </div>
  )
}
