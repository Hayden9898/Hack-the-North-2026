import { useState } from 'react'
import { api, describeError, subscribeOperatorToken } from './api'
import { useEffect } from 'react'
import { sendObservabilityDiagnostic } from './observability'

/** Explicit, synthetic diagnostic. It never reads a run, incident, or provider result. */
export function MonitoringCheck() {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  useEffect(() => subscribeOperatorToken(setAuthenticated), [])

  async function send() {
    if (!authenticated) {
      setMessage('Set the operator token first; production diagnostics are authenticated.')
      return
    }
    setBusy(true)
    const browserEventId = sendObservabilityDiagnostic()
    try {
      const server = await api.checkObservability()
      const browser = browserEventId ? `Browser event ${browserEventId}.` : 'Browser Sentry is disabled (no public DSN).'
      const apiEvent = server.event_id ? ` API event ${server.event_id}.` : ' API Sentry is disabled or did not queue an event.'
      setMessage(`${browser}${apiEvent} Confirm receipt in Sentry; queued is not delivery verified.`)
    } catch (err) {
      const detail = describeError(err)
      setMessage(`${browserEventId ? `Browser event ${browserEventId} queued. ` : ''}API diagnostic failed (HTTP ${detail.status ?? '—'}): ${detail.text}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="monitoring-check">
      <button type="button" className="link small" onClick={() => void send()} disabled={busy}>
        {busy ? 'Sending diagnostic…' : 'Send Sentry diagnostic'}
      </button>
      {message ? <span className="small muted" role="status">{message}</span> : null}
    </span>
  )
}
