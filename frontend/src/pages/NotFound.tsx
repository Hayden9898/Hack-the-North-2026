import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="state state-empty">
      <span>
        No such page. <Link to="/app">Back to runs</Link>
      </span>
    </div>
  )
}
