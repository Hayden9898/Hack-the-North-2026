import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'

/**
 * Render-time failures on a page must not replace the whole console with the router's default stack-trace page.
 * Inside the shell (App's outlet) the topbar and health banners stay usable; at the root the shell itself failed,
 * so a minimal one is drawn around the message.
 */
export function RouteError({ shell = false }: { shell?: boolean }) {
  const err = useRouteError()
  const text = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : String(err)
  const body = (
    <div className="stack">
      <div className="notice notice-danger" role="alert">
        <strong>This page failed to render.</strong> {text}
      </div>
      <p className="small muted">
        This is a console rendering problem, not a finding about the run. Reload the page or go back to the run list.{' '}
        <Link to="/">Back to runs</Link>
      </p>
    </div>
  )
  if (!shell) return body
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Log &amp; Order <small>behavioral security investigation console</small>
        </Link>
      </header>
      <main className="page">{body}</main>
    </div>
  )
}
