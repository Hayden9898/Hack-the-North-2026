import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="state state-empty">
      <h1>Page not found</h1>
      <p>This resource may have moved, or the address may be incorrect.</p>
      <Link className="btn" to="/">
        Back to overview
      </Link>
    </div>
  )
}
