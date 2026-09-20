import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { api, type Phase, type ThreatClass } from '../api'
import { fmtNum, fmtTime } from '../format'
import { useFetch, useInterval } from '../useFetch'
import { ClassBadge, Empty, ErrorState, Loading, RuleTags, StateBadge } from '../ui'
import { ExecutionScope, PageHeader, Pagination } from '../components/Page'
import { useExecutionScope } from '../useExecutionScope'

export function IncidentsPage() {
  const { id, setId, runs } = useExecutionScope()
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow="INVESTIGATE"
        title="Incidents"
        description="Related findings, assembled into an evidence-backed investigation."
      />
      <ExecutionScope id={id} onChange={setId} />
      {runs.loading ? (
        <Loading what="executions" />
      ) : runs.error ? (
        <ErrorState error={runs.error} what="executions" onRetry={() => void runs.reload()} />
      ) : id ? (
        <IncidentsTable key={id} runId={id} />
      ) : (
        <Empty>
          <ShieldCheck size={26} />
          <h3>No incidents to review</h3>
          <p>Create an execution to begin detection.</p>
          <Link className="btn btn-primary" to="/runs?create=1">
            Create execution
          </Link>
        </Empty>
      )}
    </div>
  )
}

export function IncidentsTable({ runId, compact = false }: { runId: string; compact?: boolean }) {
  const [params, setParams] = useSearchParams()
  const severity = compact ? '' : params.get('severity') || ''
  const status = compact ? 'open' : params.get('status') || ''
  const phase = compact ? 'visible' : params.get('phase') || ''
  const page = compact ? 0 : Math.max(0, Number(params.get('page')) || 0)
  const size = compact ? 5 : 15
  const result = useFetch(
    () =>
      api.listIncidents(runId, {
        threat_class: severity as ThreatClass | '',
        status: status as 'open' | 'closed' | '',
        phase: phase as Phase | '',
        offset: page * size,
        limit: size,
      }),
    [runId, severity, status, phase, page, size],
  )
  useInterval(() => {
    if (!document.hidden) void result.reload()
  }, 10_000)
  function filter(key: string, value: string) {
    setParams((p) => {
      if (value) p.set(key, value)
      else p.delete(key)
      if (key !== 'page') p.delete('page')
      return p
    })
  }
  return (
    <section className="resource-panel">
      <header className="resource-panel-heading">
        <div>
          <h2>
            {compact ? 'Incidents requiring review' : 'Incident history'}{' '}
            <span className="count">{result.data?.total ?? '—'}</span>
          </h2>
          <p>
            {compact
              ? 'Open incidents from the visible detection window.'
              : 'Select an incident to inspect its timeline, facts, and evidence.'}
          </p>
        </div>
        {compact && (
          <Link className="link small" to={`/incidents?run=${encodeURIComponent(runId)}`}>
            View all <ArrowUpRight size={13} />
          </Link>
        )}
      </header>
      {!compact && (
        <div className="table-toolbar">
          <select
            aria-label="Incident classification"
            value={severity}
            onChange={(e) => filter('severity', e.target.value)}
          >
            <option value="">All classifications</option>
            <option value="high_risk">High risk</option>
            <option value="suspicious">Suspicious</option>
          </select>
          <select
            aria-label="Incident status"
            value={status}
            onChange={(e) => filter('status', e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <select aria-label="Incident phase" value={phase} onChange={(e) => filter('phase', e.target.value)}>
            <option value="">All phases</option>
            <option value="visible">Visible window</option>
            <option value="warmup">Historical warmup</option>
          </select>
          <span className="toolbar-end small muted">{fmtNum(result.data?.total)} incidents</span>
        </div>
      )}
      {result.loading ? (
        <Loading what="incidents" />
      ) : result.error ? (
        <ErrorState error={result.error} what="incidents" onRetry={() => void result.reload()} />
      ) : !result.data?.items.length ? (
        <Empty>
          <ShieldCheck size={24} />
          <h3>{compact ? 'No open incidents in this window' : 'No incidents match this view'}</h3>
          <p>
            {compact
              ? 'Related findings will appear here as detection progresses.'
              : 'Try another classification, phase, or execution.'}
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl incident-table">
            <thead>
              <tr>
                <th>Incident</th>
                <th>Classification</th>
                <th>Account</th>
                {!compact && <th>Rules</th>}
                <th>Evidence</th>
                <th>{compact ? 'Last event (UTC)' : 'Status'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((i) => (
                <tr key={i.incident_id}>
                  <td>
                    <Link
                      className="resource-name"
                      to={`/runs/${encodeURIComponent(runId)}/incidents/${encodeURIComponent(i.incident_id)}`}
                    >
                      {i.summary.headline}
                    </Link>
                    <span className="cell-secondary">
                      {compact
                        ? `${i.rule_ids.join(' · ')} · Version ${i.current_version}`
                        : fmtTime(i.last_event_time)}
                    </span>
                  </td>
                  <td>
                    <ClassBadge threatClass={i.current_class} />
                  </td>
                  <td>{i.account || i.ip_raw || '—'}</td>
                  {!compact && (
                    <td>
                      <RuleTags ids={i.rule_ids} />
                    </td>
                  )}
                  <td>
                    <span className="evidence-count">{fmtNum(i.evidence_count)} events</span>
                    {i.evidence_strength.evaluation_incomplete && (
                      <span className="cell-secondary text-warn">Incomplete evaluation</span>
                    )}
                  </td>
                  <td className="small nowrap">
                    {compact ? fmtTime(i.last_event_time) : <StateBadge state={i.status} />}
                  </td>
                  <td>
                    <Link
                      className="icon-btn"
                      aria-label={`Investigate ${i.summary.headline}`}
                      to={`/runs/${encodeURIComponent(runId)}/incidents/${encodeURIComponent(i.incident_id)}`}
                    >
                      <ArrowUpRight size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && (
        <Pagination
          page={page}
          total={result.data?.total ?? 0}
          size={size}
          onChange={(value) => filter('page', String(value))}
        />
      )}
    </section>
  )
}
