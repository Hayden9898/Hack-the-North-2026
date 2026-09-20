import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'
import { Wordmark } from '@/components/Wordmark'
import { ErrorState } from '@/components/ui/error-state'

/**
 * Render-time failures on a page must not replace the whole console with the router's default stack-trace page.
 * Inside the shell (App's outlet) the topbar and health banners stay usable; at the root the shell itself failed,
 * so a minimal one is drawn around the message.
 */
export function RouteError({ shell = false }: { shell?: boolean }) {
  const err = useRouteError()
  const text = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : String(err)
  const body = (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <ErrorState title="This page failed to render" detail={text}>
        <p className="text-body text-fg-muted">
          This is a console rendering problem, not a finding about the run. Reload the page or{' '}
          <Link to="/app" className="text-accent underline underline-offset-2">
            go back to runs
          </Link>
          .
        </p>
      </ErrorState>
    </div>
  )
  if (!shell) return body
  return (
    <div className="app min-h-dvh bg-bg">
      <header className="border-border border-b bg-bg">
        <div className="mx-auto flex h-14 w-full max-w-[84rem] items-center px-4 sm:px-6 lg:px-8">
          <Wordmark to="/app" />
        </div>
      </header>
      <main>{body}</main>
    </div>
  )
}
