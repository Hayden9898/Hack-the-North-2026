import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  ListFilter,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react'
import { api, type EventsPage, type Phase, type ThreatClass } from '../api'
import { fmtNum, fmtPercentile, fmtTime } from '../format'
import { useFetch, useInterval } from '../useFetch'
import {
  ClassBadge,
  Code,
  Empty,
  ErrorState,
  IncidentLink,
  KV,
  Loading,
  ModelHealthBadge,
  RuleTags,
  Section,
} from '../ui'
import { ExecutionScope, PageHeader } from '../components/Page'
import { useExecutionScope } from '../useExecutionScope'
import { Overlay } from '../components/Overlay'

export function ExplorerPage({ findings = false }: { findings?: boolean }) {
  const { id, runs, setId } = useExecutionScope()
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow="INVESTIGATE"
        title={findings ? 'Findings' : 'Event explorer'}
        description={
          findings
            ? 'Review events flagged by deterministic rules or behavioral detection.'
            : 'Search processed events and inspect the evidence in context.'
        }
      />
      <ExecutionScope id={id} onChange={setId} />
      {runs.loading ? (
        <Loading what="executions" />
      ) : runs.error ? (
        <ErrorState error={runs.error} what="executions" onRetry={() => void runs.reload()} />
      ) : !id ? (
        <Empty>
          <ListFilter size={26} />
          <h3>No execution to explore</h3>
          <p>Create an execution from a log source to start collecting evidence.</p>
          <Link className="btn btn-primary" to="/runs?create=1">
            Create execution
          </Link>
        </Empty>
      ) : (
        <EventsTable key={`${id}-${findings}`} runId={id} findings={findings} />
      )}
    </div>
  )
}

export function EventsTable({
  runId,
  findings = false,
  tick = 0,
}: {
  runId: string
  findings?: boolean
  tick?: number
}) {
  const [params, setParams] = useSearchParams()
  const requestedSeverity = params.get('risk') || ''
  const severity = (findings ? ['suspicious', 'high_risk'] : ['normal', 'suspicious', 'high_risk']).includes(
    requestedSeverity,
  )
    ? requestedSeverity
    : ''
  const phase = params.get('phase') || ''
  const account = params.get('account') || ''
  const before = Number(params.get('before')) || undefined
  const [history, setHistory] = useState<(number | undefined)[]>([])
  const follow = params.get('follow') !== 'off' && !before
  const event = params.get('event')
  function update(key: string, value: string) {
    setParams((p) => {
      if (value) p.set(key, value)
      else p.delete(key)
      if (!['event', 'follow'].includes(key)) p.delete('before')
      return p
    })
    if (!['event', 'follow'].includes(key)) setHistory([])
  }
  const events = useFetch<EventsPage>(async () => {
    const common = {
      before_seq: before,
      limit: 50,
      order: 'desc' as const,
      account: account || undefined,
      phase: (['warmup', 'visible'].includes(phase) ? phase : undefined) as Phase | undefined,
    }
    if (findings && !severity) {
      const pages = await Promise.all([
        api.listEvents(runId, { ...common, threat_class: 'high_risk' }),
        api.listEvents(runId, { ...common, threat_class: 'suspicious' }),
      ])
      const items = pages.flatMap((p) => p.items).sort((a, b) => b.run_seq - a.run_seq)
      return {
        cutoff_seq: Math.min(...pages.map((p) => p.cutoff_seq)),
        items: items.slice(0, 50),
        has_more: items.length > 50 || pages.some((p) => p.has_more),
        next_after_seq: items.at(-1)?.run_seq ?? 0,
      }
    }
    return api.listEvents(runId, {
      ...common,
      threat_class: (['normal', 'suspicious', 'high_risk'].includes(severity) ? severity : undefined) as
        ThreatClass | undefined,
    })
  }, [runId, before, severity, phase, account, findings])
  const reloadEvents = events.reload
  useEffect(() => {
    if (tick && follow) void reloadEvents()
  }, [tick, follow, reloadEvents])
  useInterval(() => {
    if (follow && !document.hidden) void events.reload()
  }, 5000)
  const rows = events.data?.items ?? []
  function filterAccount(e: FormEvent) {
    e.preventDefault()
    update('account', String(new FormData(e.currentTarget as HTMLFormElement).get('account') ?? '').trim())
  }
  function next() {
    const cursor = rows.at(-1)?.run_seq
    if (!cursor) return
    setHistory((h) => [...h, before])
    setParams((p) => {
      p.set('before', String(cursor))
      p.set('follow', 'off')
      return p
    })
  }
  function previous() {
    const cursor = history.at(-1)
    setHistory((h) => h.slice(0, -1))
    setParams((p) => {
      if (cursor) p.set('before', String(cursor))
      else p.delete('before')
      return p
    })
  }
  return (
    <section className="resource-panel">
      <header className="resource-panel-heading">
        <div>
          <h2>
            {findings ? 'Detection findings' : 'Processed events'}{' '}
            <span className="count">{rows.length}</span>
          </h2>
          <p>
            {events.data
              ? `Evidence through sequence ${fmtNum(events.data.cutoff_seq)}.`
              : 'Only processed evidence is shown.'}
          </p>
        </div>
        <div className="row">
          <button
            className={`btn btn-sm ${follow ? 'live-button' : ''}`}
            onClick={() => {
              if (before) {
                setHistory([])
                setParams((p) => {
                  p.delete('before')
                  p.delete('follow')
                  return p
                })
              } else update('follow', follow ? 'off' : '')
            }}
          >
            {follow ? <Pause size={13} /> : <Play size={13} />}
            {follow ? 'Following updates' : 'Follow updates'}
          </button>
          <button
            className="icon-btn"
            aria-label="Refresh events"
            disabled={events.refreshing}
            onClick={() => void events.reload()}
          >
            <RefreshCw size={15} className={events.refreshing ? 'spin' : ''} />
          </button>
        </div>
      </header>
      <div className="table-toolbar">
        <form className="search-field" onSubmit={filterAccount}>
          <ListFilter size={16} />
          <input
            key={account}
            name="account"
            aria-label="Filter by exact account"
            placeholder="Filter by exact account…"
            defaultValue={account}
          />
          <button className="filter-submit" type="submit" aria-label="Apply account filter">
            Apply <kbd>↵</kbd>
          </button>
        </form>
        <select
          aria-label="Risk classification"
          value={severity}
          onChange={(e) => update('risk', e.target.value)}
        >
          <option value="">{findings ? 'All findings' : 'All classifications'}</option>
          {!findings && <option value="normal">Normal</option>}
          <option value="suspicious">Suspicious</option>
          <option value="high_risk">High risk</option>
        </select>
        <select aria-label="Detection phase" value={phase} onChange={(e) => update('phase', e.target.value)}>
          <option value="">All phases</option>
          <option value="visible">Visible window</option>
          <option value="warmup">Historical warmup</option>
        </select>
        {(account || severity || phase) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setHistory([])
              setParams((p) => {
                ;['account', 'risk', 'phase', 'before'].forEach((k) => p.delete(k))
                return p
              })
            }}
          >
            Clear
          </button>
        )}
      </div>
      {account && (
        <div className="active-filter">
          Account <strong>{account}</strong>
          <button
            aria-label="Remove account filter"
            onClick={() => {
              update('account', '')
            }}
          >
            ×
          </button>
        </div>
      )}
      {events.loading ? (
        <Loading what={findings ? 'findings' : 'events'} />
      ) : !!events.error && !events.data ? (
        <ErrorState error={events.error} what="events" onRetry={() => void events.reload()} />
      ) : !rows.length ? (
        <Empty>
          <ListFilter size={24} />
          <h3>No {findings ? 'findings' : 'events'} in this view</h3>
          <p>
            {account || severity || phase
              ? 'Adjust your filters to broaden the results.'
              : 'Results appear as this execution processes events.'}
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl event-table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Classification</th>
                <th>Account</th>
                <th>Request</th>
                <th>Status</th>
                <th>Rules</th>
                <th className="right">Rarity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.run_seq} className={event === String(e.run_seq) ? 'row-selected' : ''}>
                  <td>
                    <button
                      className="table-link mono nowrap"
                      onClick={() => update('event', String(e.run_seq))}
                    >
                      {fmtTime(e.event_time)}
                    </button>
                    <span className="cell-secondary mono">#{fmtNum(e.run_seq)}</span>
                  </td>
                  <td>
                    <ClassBadge threatClass={e.threat_class} processingStatus={e.processing_status} />
                  </td>
                  <td>
                    <span>{e.username}</span>
                    <span className="cell-secondary mono">{e.ip_raw}</span>
                  </td>
                  <td className="request-cell">
                    <span className="method">{e.method}</span>
                    <span className="mono" title={e.path}>
                      {e.path}
                    </span>
                  </td>
                  <td>
                    <span className={`http-status ${e.status >= 400 ? 'http-error' : ''}`}>{e.status}</span>
                  </td>
                  <td>
                    <RuleTags ids={e.rule_ids} />
                  </td>
                  <td className="right mono">{fmtPercentile(e.anomaly_percentile)}</td>
                  <td>
                    <button
                      className="icon-btn"
                      aria-label={`Inspect event ${e.run_seq}`}
                      onClick={() => update('event', String(e.run_seq))}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!events.error && events.data && (
        <div className="notice notice-warn">Updates are unavailable. Showing the last loaded events.</div>
      )}
      <div className="pagination">
        <span>
          {rows.length} events on this page <span className="muted">· newest first</span>
        </span>
        <div className="row">
          <button className="btn btn-sm" disabled={!before || events.loading} onClick={previous}>
            <ChevronLeft size={14} />
            Newer
          </button>
          <button className="btn btn-sm" disabled={!events.data?.has_more || events.loading} onClick={next}>
            Older
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <Overlay
        drawer
        open={!!event}
        onClose={() => update('event', '')}
        title={`Event #${event ?? ''}`}
        description="Context, detection outcome, and original evidence."
      >
        {event && <EventEvidence key={`${runId}-${event}`} runId={runId} seq={event} />}
      </Overlay>
    </section>
  )
}

function EventEvidence({ runId, seq }: { runId: string; seq: string }) {
  const result = useFetch(() => api.getEvent(runId, seq), [runId, seq])
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const e = result.data
  if (result.loading) return <Loading what="event evidence" />
  if (result.error)
    return <ErrorState error={result.error} what="event evidence" onRetry={() => void result.reload()} />
  if (!e) return <Empty>Event not found.</Empty>
  return (
    <div className="stack">
      <div className="row row-between">
        <ClassBadge threatClass={e.threat_class} processingStatus={e.processing_status} />
        <Link className="btn btn-sm" to={`/runs/${encodeURIComponent(runId)}/events/${e.run_seq}`}>
          Open full event
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <dl className="detail-grid">
        <KV k="Account">{e.username}</KV>
        <KV k="Source IP" mono>
          {e.ip_raw}
        </KV>
        <KV k="Timestamp (UTC)">{fmtTime(e.event_time)}</KV>
        <KV k="HTTP response">{e.status}</KV>
        <KV k="Request" mono>
          {e.method} {e.path}
        </KV>
        <KV k="Phase">{e.phase === 'warmup' ? 'Historical warmup' : 'Visible window'}</KV>
      </dl>
      <Section
        title="Raw evidence"
        aside={
          <button
            className="icon-btn"
            aria-label="Copy raw log"
            onClick={() => {
              navigator.clipboard
                .writeText(e.raw_line)
                .then(() => {
                  setCopied(true)
                  setCopyError(false)
                })
                .catch(() => setCopyError(true))
            }}
          >
            <Copy size={14} />
          </button>
        }
      >
        <Code block>{e.raw_line}</Code>
        <div className="small muted" style={{ marginTop: 8 }}>
          Source line {e.line_number ?? '—'}
          {e.dataset_id && (
            <>
              {' '}
              · <Link to={`/sources/${encodeURIComponent(e.dataset_id)}`}>View log source</Link>
            </>
          )}
        </div>
        {copied && (
          <span role="status" className="small text-ok">
            Copied to clipboard
          </span>
        )}
        {copyError && (
          <span role="status" className="small text-warn">
            Clipboard unavailable. Select the raw text to copy it.
          </span>
        )}
      </Section>
      <Section title="Detection">
        <dl className="kvs">
          <KV k="Rules matched">
            <RuleTags ids={e.rule_ids} />
          </KV>
          <KV k="Model">
            <ModelHealthBadge health={e.model_health} />
          </KV>
          <KV k="Rarity percentile">{fmtPercentile(e.anomaly_percentile)}</KV>
          <KV k="Reasons">{e.reason_codes.join(', ') || 'No configured detector flagged this event.'}</KV>
        </dl>
        <p className="muted small">
          Rarity measures deviation from an account’s baseline. It is not an attack probability.
        </p>
      </Section>
      <Section title="Related incidents">
        {e.incident_memberships.length ? (
          e.incident_memberships.map((i) => (
            <div className="related-link" key={`${i.incident_id}-${i.relation_type}`}>
              <IncidentLink runId={runId} incidentId={i.incident_id} />
              <span className="muted small">{i.relation_type}</span>
            </div>
          ))
        ) : (
          <p className="muted">No incident references this event.</p>
        )}
      </Section>
      <details>
        <summary>Feature snapshot and observed context</summary>
        <Code block>
          {{ features: e.features, context: e.observed_context, deviations: e.top_deviations }}
        </Code>
      </details>
    </div>
  )
}
