import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api, describeError, setOperatorToken, subscribeDbStatus, subscribeOperatorToken, type Health } from './api'
import { degradedModeLabel } from './format'
import { MonitoringCheck } from './MonitoringCheck'
import { useFetch, useInterval } from './useFetch'

export default function App() {
  const health = useFetch<Health>(() => api.health(), [])
  const [dbDown, setDbDown] = useState(false)
  useEffect(() => subscribeDbStatus(setDbDown), [])
  useInterval(() => void health.reload(), 30_000)

  const healthErr = health.error ? describeError(health.error) : null
  const notReady = !!health.data && health.data.status !== 'ready'
  // /health/ready answers 503 for every not-ready reason; api.health() still returns the health object for those, so
  // the database banner is driven by the database field itself. A 503 without a health body (proxy, crashed API) or a
  // 503 from any other endpoint still counts as the database being unavailable.
  const showDbBanner = health.data ? health.data.database.ok === false : dbDown || healthErr?.status === 503

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          Log &amp; Order <small>behavioral security investigation console</small>
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Runs
          </NavLink>
        </nav>
        <span className="spacer" />
        <MonitoringCheck />
        {health.data ? <OperatorToken required={health.data.auth?.operator_required ?? false} /> : null}
        <HealthChip health={health.data} error={health.error} loading={health.loading} onRetry={() => void health.reload()} />
      </header>

      {showDbBanner ? (
        <div className="banner banner-danger" role="alert">
          <strong>Database unavailable.</strong> The API returned 503 or reported the database as down. Nothing shown below is being refreshed;
          this console never fabricates a healthy feed.{' '}
          <button type="button" className="btn btn-sm" onClick={() => void health.reload()}>
            Re-check
          </button>
        </div>
      ) : null}

      {!showDbBanner && healthErr && healthErr.status !== 503 ? (
        <div className="banner banner-warn" role="alert">
          <strong>Health check failed</strong> ({healthErr.status ?? 'no response'}: {healthErr.text}).{' '}
          <button type="button" className="btn btn-sm" onClick={() => void health.reload()}>
            Retry
          </button>
        </div>
      ) : null}

      {!showDbBanner && notReady && health.data ? (
        <div className="banner banner-danger" role="alert">
          <strong>API not ready</strong> — status {health.data.status}
          {health.data.not_ready_reasons?.length ? ` (${health.data.not_ready_reasons.map((r) => r.replaceAll('_', ' ')).join(', ')})` : ''}. database ok:{' '}
          {String(health.data.database.ok)}; migrations ok: {String(health.data.migrations.ok)} ({health.data.migrations.current ?? '?'} /{' '}
          {health.data.migrations.head ?? '?'}); config ok: {String(health.data.config.ok)}.
        </div>
      ) : null}

      {health.data && health.data.degraded_modes.length > 0 ? (
        <div className="banner banner-warn" role="status">
          <strong>Degraded modes declared by the API:</strong>{' '}
          {health.data.degraded_modes.map((m, i) => (
            <span key={m}>
              {i > 0 ? ' · ' : ''}
              {degradedModeLabel(m)}
            </span>
          ))}
        </div>
      ) : null}

      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Shared deployments require an operator bearer token for mutations (creating runs, replay control, feedback,
 * aggregate refresh). Reads are open. The token stays in this tab and is sent only as an Authorization header.
 */
function OperatorToken({ required }: { required: boolean }) {
  const [present, setPresent] = useState(false)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => subscribeOperatorToken(setPresent), [])

  function save(e: FormEvent) {
    e.preventDefault()
    setOperatorToken(value)
    setValue('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`conn ${present ? 'conn-live' : required ? 'conn-disconnected' : ''}`}
        onClick={() => setOpen(true)}
        title={
          present
            ? 'Operator token set for this tab; click to replace or clear it'
            : required
              ? 'Mutations need an operator token on this deployment'
              : 'This deployment accepts local mutations without a token; set one if the API rejects them'
        }
      >
        <span className="dot" /> operator {present ? 'authenticated' : required ? 'token required' : 'no token'}
      </button>
    )
  }
  return (
    <form onSubmit={save} className="row" style={{ gap: 6 }}>
      <input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="APP_AUTH_SECRET"
        aria-label="operator token"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" className="btn btn-sm btn-primary">
        Use
      </button>
      {present ? (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setOperatorToken('')
            setValue('')
            setOpen(false)
          }}
        >
          Clear
        </button>
      ) : null}
      <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  )
}

function HealthChip({ health, error, loading, onRetry }: { health: Health | null; error: unknown; loading: boolean; onRetry: () => void }) {
  if (loading && !health) return <span className="conn conn-connecting"><span className="dot" /> checking health…</span>
  if (error && !health) {
    const e = describeError(error)
    return (
      <button type="button" className="link conn conn-disconnected" onClick={onRetry} title={e.text}>
        <span className="dot" /> health: {e.status === 503 ? 'database unavailable' : `error ${e.status ?? ''}`}
      </button>
    )
  }
  if (!health) return null
  const ok = health.status === 'ready'
  return (
    <span className={`conn ${ok ? 'conn-live' : 'conn-disconnected'}`} title={`db: ${health.database.detail ?? '—'}; models: ${health.models.artifacts.join(', ') || 'none'}`}>
      <span className="dot" /> API {ok ? 'ready' : health.status}
      {health.models.active ? <span className="muted"> · model {health.models.active}</span> : <span className="muted"> · no active model</span>}
    </span>
  )
}
