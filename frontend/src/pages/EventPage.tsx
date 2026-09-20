import { Link, useParams } from 'react-router-dom'
import { api, type EventDetail } from '../api'
import { CLASS_MEANING, classTone, fmtNum, fmtPercentile, fmtTime, modelHealthLabel, phaseLabel, shortId } from '../format'
import { useFetch } from '../useFetch'
import { ClassBadge, Code, Empty, ErrorState, EventLink, IncidentLink, Loading, PhaseBadge, RuleTags, Section, Tag } from '../ui'

export function EventPage() {
  const { runId = '', seq = '' } = useParams()
  const ev = useFetch<EventDetail>(() => api.getEvent(runId, seq), [runId, seq])

  if (ev.loading && !ev.data) return <Loading what="event" />
  if (ev.error && !ev.data) return <ErrorState error={ev.error} onRetry={() => void ev.reload()} what="event" />
  const e = ev.data
  if (!e) return <Empty>Event not found under the run cutoff.</Empty>
  const tone = classTone(e.threat_class, e.processing_status)
  const seqN = Number(seq)

  return (
    <div className="stack">
      <div className="crumbs">
        <Link to="/app">Runs</Link> / <Link to={`/app/runs/${encodeURIComponent(runId)}`}>{shortId(runId, 18)}</Link> / event #{e.run_seq}
      </div>
      <div className="page-head">
        <h1>
          Event #{fmtNum(e.run_seq)} <ClassBadge threatClass={e.threat_class} processingStatus={e.processing_status} /> <PhaseBadge phase={e.phase} />
          {e.phase === 'warmup' ? <Tag tone="warn">historical warmup — state-building, not a live decision</Tag> : null}
        </h1>
        <span className="row" style={{ marginLeft: 'auto' }}>
          {Number.isFinite(seqN) && seqN > 1 ? <EventLink runId={runId} seq={seqN - 1}>← #{seqN - 1}</EventLink> : null}
          {Number.isFinite(seqN) ? <EventLink runId={runId} seq={seqN + 1}>#{seqN + 1} →</EventLink> : null}
        </span>
      </div>
      <p className="muted small">{CLASS_MEANING[tone]}</p>

      <Section title="Raw log line" aside={<span className="mono">line {e.line_number ?? '—'} · dataset {e.dataset_id ?? '—'}</span>}>
        <Code block>{e.raw_line}</Code>
        <dl className="kvs" style={{ marginTop: 8 }}>
          <div className="kv">
            <dt>original time</dt>
            <dd className="mono">{e.original_time ?? '—'}</dd>
          </div>
          <div className="kv">
            <dt>event time (UTC)</dt>
            <dd className="mono">{fmtTime(e.event_time)}</dd>
          </div>
          <div className="kv">
            <dt>offset minutes</dt>
            <dd className="mono">{e.offset_minutes ?? '—'}</dd>
          </div>
          <div className="kv">
            <dt>event id</dt>
            <dd className="mono small">{e.event_id}</dd>
          </div>
          <div className="kv">
            <dt>account @ ip</dt>
            <dd className="mono">
              {e.username}@{e.ip_raw}
            </dd>
          </div>
          <div className="kv">
            <dt>request</dt>
            <dd className="mono">
              {e.method} {e.path} → {e.status}
            </dd>
          </div>
          <div className="kv">
            <dt>raw target</dt>
            <dd className="mono small">{e.raw_target ?? '—'}</dd>
          </div>
          <div className="kv">
            <dt>query keys</dt>
            <dd className="mono small">{e.query_keys && e.query_keys.length ? e.query_keys.join(', ') : '—'}</dd>
          </div>
          <div className="kv">
            <dt>route family / object</dt>
            <dd className="mono small">
              {e.route_family} {e.object_id ? `· ${e.object_id}` : ''}
            </dd>
          </div>
          <div className="kv">
            <dt>response bytes</dt>
            <dd className="mono">{e.response_bytes ?? '—'}</dd>
          </div>
        </dl>
      </Section>

      <div className="grid-2">
        <Section title="Detector outcome (deterministic)" tone="fact">
          <dl className="kvs">
            <div className="kv">
              <dt>class</dt>
              <dd>
                <ClassBadge threatClass={e.threat_class} processingStatus={e.processing_status} long />
              </dd>
            </div>
            <div className="kv">
              <dt>processing status</dt>
              <dd>{e.processing_status}</dd>
            </div>
            <div className="kv">
              <dt>rules matched</dt>
              <dd>
                <RuleTags ids={e.rule_ids} />
              </dd>
            </div>
            <div className="kv">
              <dt>reason codes</dt>
              <dd>{e.reason_codes.length ? e.reason_codes.join(', ') : <span className="muted">none</span>}</dd>
            </div>
            <div className="kv">
              <dt>phase</dt>
              <dd>{phaseLabel(e.phase)}</dd>
            </div>
          </dl>
          <hr className="hr" />
          <h3>Baseline model</h3>
          <dl className="kvs" style={{ marginTop: 4 }}>
            <div className="kv">
              <dt>model health</dt>
              <dd>
                {modelHealthLabel(e.model_health)} {e.model_id ? <span className="mono small">({e.model_id})</span> : null}
              </dd>
            </div>
            <div className="kv">
              <dt>rarity percentile</dt>
              <dd>
                {fmtPercentile(e.anomaly_percentile)} <span className="muted small">rarity vs. the account's baseline, not attack probability</span>
              </dd>
            </div>
            <div className="kv">
              <dt>model score</dt>
              <dd className="mono">{e.model_score === null ? '— (null: no model scored this event)' : e.model_score.toFixed(4)}</dd>
            </div>
            <div className="kv">
              <dt>model flagged</dt>
              <dd>{e.model_flagged === null ? '—' : String(e.model_flagged)}</dd>
            </div>
          </dl>
          <h3 style={{ marginTop: 10 }}>Measured deviations</h3>
          <p className="muted small">Largest measured baseline differences for this event. These are measurements, not model attribution.</p>
          {e.top_deviations.length === 0 ? (
            <Empty>No deviations recorded (rules-only or nothing above threshold).</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {Object.keys(e.top_deviations[0]).map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {e.top_deviations.map((d, i) => (
                  <tr key={i}>
                    {Object.keys(e.top_deviations[0]).map((k) => (
                      <td key={k} className="mono small">
                        {typeof d[k] === 'number' ? (d[k] as number).toFixed(4) : String(d[k] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="stack">
          <Section title="Incident memberships">
            {e.incident_memberships.length === 0 ? (
              <Empty>This event is not evidence in any incident under the cutoff.</Empty>
            ) : (
              <ul className="plain">
                {e.incident_memberships.map((m) => (
                  <li key={`${m.incident_id}-${m.relation_type}`} className="row" style={{ padding: '3px 0' }}>
                    <IncidentLink runId={runId} incidentId={m.incident_id} />
                    <Tag>{m.relation_type}</Tag>
                    {m.rule_id ? <Tag tone="info">{m.rule_id}</Tag> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Features (${e.feature_version ?? 'no snapshot'})`}>
            {!e.features ? (
              <Empty>No feature snapshot stored for this event.</Empty>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>feature</th>
                    <th className="right">value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(e.features).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td className="right mono">{typeof v === 'number' ? v.toFixed(4) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Observed context at processing time">
            {!e.observed_context ? (
              <Empty>No observed context stored.</Empty>
            ) : (
              <table className="tbl">
                <tbody>
                  {Object.entries(e.observed_context).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td className="mono right">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
