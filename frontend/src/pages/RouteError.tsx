import { Link, useRouteError } from 'react-router-dom'
import { useEffect } from 'react'
import { captureFrontendError } from '../monitoring'

export function RouteError() {
  const error = useRouteError()
  useEffect(() => {
    captureFrontendError(error)
  }, [error])
  const status = error && typeof error === 'object' && 'status' in error ? String(error.status) : null
  return (
    <main className="state state-empty" role="alert">
      <h1>This view couldn’t load</h1>
      <p>
        {status ? `The server returned ${status}.` : 'An unexpected application error occurred.'} Reload the
        page to try again.
      </p>
      <div className="row">
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload page
        </button>
        <Link className="btn" to="/">
          Back to overview
        </Link>
      </div>
    </main>
  )
}
