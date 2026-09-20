import { Navigate, useLocation } from 'react-router-dom'

/**
 * Keeps pre-migration links alive: /runs/* -> /app/runs/*.
 * Preserves the query string and hash so a deep link into a specific event still lands.
 */
export function LegacyRunsRedirect() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={`/app${pathname}${search}${hash}`} replace />
}
