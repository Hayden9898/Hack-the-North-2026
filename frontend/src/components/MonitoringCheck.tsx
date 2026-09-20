import { useState } from 'react'
import { Activity } from 'lucide-react'
import { api, describeError } from '../api'
import { checkFrontendMonitoring, monitoringState } from '../monitoring'
import { useWorkspace } from '../workspace'
import { Section, Tag } from '../ui'

export function MonitoringCheck() {
  const { health } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const browser = monitoringState()
  const apiActive = !!health.data?.sentry_active
  async function check() {
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      const backend = apiActive ? await api.checkMonitoring() : null
      const browserId = await checkFrontendMonitoring()
      const messages = [
        backend?.event_id ? `API event: ${backend.event_id}` : 'API event not queued.',
        browserId ? `Browser event: ${browserId}` : 'Browser event not queued.',
      ]
      setResult(messages.join('\n'))
    } catch (e) {
      setError(describeError(e).text)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Application observability" aside={<Activity size={18} />}>
      <p>
        Sentry observes this application—not the logs under investigation. Request bodies, evidence, account
        names, AI prompts, and session replay are excluded.
      </p>
      <div className="row">
        <Tag tone={apiActive ? 'ok' : 'muted'}>API SDK: {apiActive ? 'initialized' : 'inactive'}</Tag>
        <Tag tone={browser === 'active' ? 'ok' : browser === 'failed' ? 'warn' : 'muted'}>
          Browser SDK:{' '}
          {browser === 'active' ? 'initialized' : browser === 'failed' ? 'initialization failed' : 'inactive'}
        </Tag>
      </div>
      <p className="muted small">
        SDK initialization is not delivery confirmation. Worker delivery must be checked separately in Sentry.
      </p>
      <button
        className="btn"
        disabled={busy || (!apiActive && browser !== 'active')}
        onClick={() => void check()}
      >
        {busy ? 'Sending diagnostic…' : 'Send Sentry diagnostic'}
      </button>
      {result && (
        <div className="notice" role="status">
          <p>
            Synthetic diagnostic attempted. Confirm receipt in Sentry before marking this integration
            verified.
          </p>
          <pre>{result}</pre>
        </div>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>What the diagnostic does</summary>
        <p>
          Queues a synthetic message and structured log in each configured SDK, plus an API trace. It does not
          create an incident, contact an AI provider, or send Slack messages.
        </p>
        <p>
          API and worker processes use SENTRY_DSN. The browser uses a public VITE_SENTRY_DSN at build time.
          The MCP connection is a separate developer tool and does not activate either SDK.
        </p>
      </details>
    </Section>
  )
}
