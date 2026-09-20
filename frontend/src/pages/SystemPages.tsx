import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useWorkspace } from '../workspace'
import { degradedModeLabel, integrationLabel } from '../format'
import { Empty, ErrorState, KV, Loading, Section, StateBadge, Tag } from '../ui'
import { PageHeader } from '../components/Page'
import { MonitoringCheck } from '../components/MonitoringCheck'

const rules = [
  [
    'R1',
    'Authentication burst',
    'Repeated failed logins from an unfamiliar or unknown source.',
    'suspicious',
  ],
  ['R2', 'Access change', 'A successful response on a path previously denied to the account.', 'suspicious'],
  ['R3', 'Admin transition', 'A forum view followed by a successful administrative request.', 'suspicious'],
  [
    'R4',
    'Account use sequence',
    'An authentication episode followed by login and sensitive access.',
    'high_risk',
  ],
  [
    'R5',
    'Linked access change',
    'Related account activity linking an administrative transition and access change.',
    'high_risk',
  ],
]

export function DetectionPage() {
  const { health, runs } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const model = params.get('model')
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Detection"
        description="Independent rules and behavioral models. Traceable outcomes."
        actions={<Tag tone="muted">Read-only configuration</Tag>}
      />
      <section className="resource-panel">
        <header className="resource-panel-heading">
          <div>
            <h2>
              Detection rules <span className="count">5</span>
            </h2>
            <p>
              Rule definitions shipped with this console. Each execution records its own configuration
              fingerprint.
            </p>
          </div>
          <ShieldCheck size={20} className="muted" />
        </header>
        <div className="table-wrap">
          <table className="tbl resource-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Detection pattern</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(([id, name, description, risk]) => (
                <tr key={id}>
                  <td>
                    <Tag tone="info">{id}</Tag>
                  </td>
                  <td>
                    <strong>{name}</strong>
                    <span className="cell-secondary">{description}</span>
                  </td>
                  <td>
                    <span className={`badge badge-${risk}`}>
                      {risk === 'high_risk' ? 'High risk' : 'Suspicious'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Section title="Behavioral model artifacts" aside={<Cpu size={18} />}>
        {health.loading ? (
          <Loading what="models" />
        ) : health.error ? (
          <ErrorState error={health.error} what="models" onRetry={() => void health.reload()} />
        ) : !health.data?.models.artifacts.length ? (
          <Empty>
            <Cpu size={26} />
            <h3>No model artifacts available</h3>
            <p>
              Executions can use deterministic rules. Model scores remain unavailable until an artifact is
              configured on the backend.
            </p>
          </Empty>
        ) : (
          <div className="model-list">
            {health.data.models.artifacts.map((m) => (
              <button
                className={`model-row ${model === m ? 'selected' : ''}`}
                key={m}
                onClick={() => setParams({ model: m })}
              >
                <Cpu size={20} />
                <span>
                  <strong>{m}</strong>
                  <small>Isolation Forest · behavioral rarity</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        )}
      </Section>
      {model && (
        <Section title={model}>
          <p>
            Model scores express rarity against an account’s behavioral baseline. Deterministic rule outcomes
            are evaluated independently.
          </p>
          <h3>Executions referencing this artifact</h3>
          {runs.data
            ?.filter((r) => r.model_id === model)
            .map((r) => (
              <div className="related-link" key={r.run_id}>
                <Link to={`/runs/${encodeURIComponent(r.run_id)}`}>{r.name || r.run_id}</Link>
                <StateBadge state={r.state} />
              </div>
            ))}
          {!runs.data?.some((r) => r.model_id === model) && (
            <p className="muted">No loaded execution references this model.</p>
          )}
        </Section>
      )}
      <div className="notice">
        Rules and model activation are managed on the backend. Open an execution’s Configuration tab to
        inspect the exact model and fingerprints used for its results.
      </div>
    </div>
  )
}

export function IntegrationsPage() {
  const { health } = useWorkspace()
  const cards = [
    {
      key: 'sentry' as const,
      name: 'Sentry',
      icon: Activity,
      description: 'Application errors, tracing, and structured logs.',
      link: 'https://docs.sentry.io/platforms/python/integrations/fastapi/',
      setup:
        'Set SENTRY_DSN on the backend and restart the service. The developer MCP connection is separate from application monitoring.',
    },
    {
      key: 'slack' as const,
      name: 'Slack',
      icon: MessageSquare,
      description: 'Incident notifications with durable delivery and retry history.',
      link: 'https://api.slack.com/messaging/webhooks',
      setup:
        'Set SLACK_WEBHOOK_URL and SLACK_MODE=live on the backend. Preview mode stores rendered notifications without sending them.',
    },
    {
      key: 'llm' as const,
      name: 'AI investigation',
      icon: Cpu,
      description: 'Qualified hypotheses checked against a versioned fact packet.',
      link: 'https://docs.anthropic.com/',
      setup:
        'Configure LLM_API_KEY, LLM_PROVIDER, and LLM_MODEL on the backend. Deterministic summaries remain available without a provider.',
    },
  ]
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Integrations"
        description="Connection status and capabilities, as reported by your backend."
        actions={
          <button className="btn" disabled={health.refreshing} onClick={() => void health.reload()}>
            <RefreshCw size={15} />
            Check connections
          </button>
        }
      />
      {health.loading ? (
        <Loading what="integrations" />
      ) : health.error ? (
        <ErrorState error={health.error} what="integrations" onRetry={() => void health.reload()} />
      ) : (
        cards.map(({ key, name, icon: Icon, description, link, setup }) => {
          const status = integrationLabel(key, health.data?.integrations[key] || 'unknown')
          return (
            <section className="integration-row" key={key}>
              <div className={`integration-icon integration-${key}`}>
                <Icon size={26} />
              </div>
              <div>
                <div className="row">
                  <h2>{name}</h2>
                  <Tag tone={status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : 'muted'}>
                    {status.text}
                  </Tag>
                </div>
                <p>{description}</p>
                <details>
                  <summary>Connection setup</summary>
                  <p>{setup}</p>
                  <a className="link small" href={link} target="_blank" rel="noreferrer">
                    Official documentation <ExternalLink size={12} />
                  </a>
                </details>
              </div>
            </section>
          )
        })
      )}
      <MonitoringCheck />
      <div className="notice">
        Provider secrets are configured on the server. This console displays connection modes and never
        exposes secret values.
      </div>
    </div>
  )
}

export function SystemPage() {
  const { health } = useWorkspace()
  const h = health.data
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow="WORKSPACE"
        title="System status"
        description="Service readiness and operating modes."
        actions={
          <button className="btn" disabled={health.refreshing} onClick={() => void health.reload()}>
            <RefreshCw size={15} />
            Refresh status
          </button>
        }
      />
      {health.loading ? (
        <Loading what="system health" />
      ) : health.error ? (
        <ErrorState error={health.error} what="system health" onRetry={() => void health.reload()} />
      ) : (
        h && (
          <>
            <Section title="Service readiness" aside={<StateBadge state={h.status} />}>
              <div className="health-grid">
                {[
                  { name: 'Database', ok: h.database.ok, detail: h.database.detail || 'Storage connection' },
                  {
                    name: 'Migrations',
                    ok: h.migrations.ok,
                    detail: `${h.migrations.current || 'Unknown'} / ${h.migrations.head || 'Unknown'}`,
                  },
                  { name: 'Configuration', ok: h.config.ok, detail: 'Detection configuration validation' },
                ].map((item) => (
                  <div key={item.name}>
                    <CheckCircle2 size={21} className={item.ok ? 'text-ok' : 'text-danger'} />
                    <strong>{item.name}</strong>
                    <span>{item.ok ? 'Ready' : 'Needs attention'}</span>
                    <small>{item.detail}</small>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Operating modes">
              {h.degraded_modes.length ? (
                <ul className="plain mode-list">
                  {h.degraded_modes.map((mode) => (
                    <li key={mode}>
                      <span className="dot" />
                      {degradedModeLabel(mode)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ok">All configured capabilities are available.</p>
              )}
            </Section>
            <Section title="Configuration fingerprint">
              <dl className="kvs">
                <KV k="Configuration hash" mono>
                  {h.config.hash || 'Unavailable'}
                </KV>
                <KV k="Model artifacts">{h.models.artifacts.length}</KV>
                <KV k="Sentry tracing">{h.sentry_active ? 'Active' : 'Disabled'}</KV>
              </dl>
            </Section>
          </>
        )
      )}
    </div>
  )
}
