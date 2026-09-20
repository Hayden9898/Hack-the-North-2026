import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-6 py-24">
      <p className="font-mono text-mono text-fg-subtle">404</p>
      <h1 className="text-title text-fg">No such page</h1>
      <p className="text-body text-fg-muted">
        That route does not exist. Incidents and events live under a run, so start from the run list.
      </p>
      <Button asChild>
        <Link to="/app">Back to runs</Link>
      </Button>
    </div>
  )
}
