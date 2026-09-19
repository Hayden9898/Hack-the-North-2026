import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, describeError, type Dataset, type Run, type RunCreateBody } from '../api'
import { fmtBytes, fmtNum, fmtTime, isFaultRun, runStateLabel, shortId, speedLabel } from '../format'
import { useFetch, useInterval } from '../useFetch'
import { Empty, ErrorState, Loading, ModelHealthBadge, PhaseBadge, Section, StateBadge, Tag } from '../ui'

export function RunsPage() {
  const runs = useFetch<Run[]>(() => api.listRuns(), [])
  const datasets = useFetch<Dataset[]>(() => api.listDatasets(), [])
  useInterval(() => {
    void runs.reload()
    void datasets.reload()
  }, 5_000)

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Runs</h1>
        <span className="muted small">
          Each run is an isolated detection pass over a dataset (historical replay) or a live source. Replays never contaminate each other and never
          send real notifications unless Slack is explicitly live.
        </span>
      </div>

      <div className="grid-2">
        <Section title="Runs" aside={runs.refreshing ? <span className="muted">refreshing…</span> : <span className="muted">auto-refresh 5 s</span>}>
          {runs.loading ? (
            <Loading what="runs" />
          ) : runs.error ? (
            <ErrorState error={runs.error} onRetry={() => void runs.reload()} what="runs" />
          ) : !runs.data || runs.data.length === 0 ? (
            <Empty>No runs yet. Create one from a ready dataset.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mode</th>
                    <th>Phase</th>
                    <th>State</th>
                    <th>Model</th>
                    <th className="right">Cursor</th>
                    <th>Speed</th>
                    <th>Dataset</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.map((r) => (
                    <tr key={r.run_id}>
                      <td>
                        <Link className="link" to={`/runs/${encodeURIComponent(r.run_id)}`}>
                          {r.name || shortId(r.run_id, 12)}
                        </Link>
                        {isFaultRun(r.name) ? (
                          <>
                            {' '}
                            <Tag tone="danger">fault injection</Tag>
                          </>
                        ) : null}
                        <div className="muted small mono">{shortId(r.run_id, 18)}</div>
                      </td>
                      <td>
                        <Tag tone={r.mode === 'replay' ? 'muted' : 'info'}>{r.mode === 'replay' ? 'historical replay' : 'live'}</Tag>
                      </td>
                      <td>
                        <PhaseBadge phase={r.phase} />
                      </td>
                      <td>
                        <StateBadge state={r.state} label={runStateLabel(r.state)} />
                        {r.block_reason ? <div className="small muted">{r.block_reason}</div> : null}
                      </td>
                      <td>
                        <ModelHealthBadge health={r.model_health} />
                      </td>
                      <td className="right mono nowrap">
                        {fmtNum(r.processed_seq)} / {fmtNum(r.admitted_seq)}
                        {r.backlog > 0 ? <div className="small muted">backlog {fmtNum(r.backlog)}</div> : null}
                      </td>
                      <td className="nowrap">{speedLabel(r.speed)}</td>
                      <td className="mono small">{shortId(r.dataset_id ?? r.source_id, 16)}</td>
                      <td className="nowrap small">{fmtTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="stack">
          <NewRunForm datasets={datasets.data ?? []} onCreated={() => void runs.reload()} />
          <Section title="Datasets">
            {datasets.loading ? (
              <Loading what="datasets" />
            ) : datasets.error ? (
              <ErrorState error={datasets.error} onRetry={() => void datasets.reload()} what="datasets" />
            ) : !datasets.data || datasets.data.length === 0 ? (
              <Empty>No datasets imported. Upload one with the import script; the console does not accept filesystem paths.</Empty>
            ) : (
              <ul className="plain stack">
                {datasets.data.map((d) => (
                  <DatasetCard key={d.dataset_id} d={d} />
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function DatasetCard({ d }: { d: Dataset }) {
  const [showRejects, setShowRejects] = useState(false)
  const detail = useFetch(() => api.getDataset(d.dataset_id), [d.dataset_id, showRejects], showRejects)
  const pct = d.total_lines && d.progress_line ? Math.min(100, Math.round((d.progress_line / d.total_lines) * 100)) : null
  const stats = d.stats as { users?: number; status_counts?: Record<string, number> }
  return (
    <li className="notice" style={{ padding: 10 }}>
      <div className="row row-between">
        <strong>{d.original_name}</strong>
        <StateBadge state={d.import_state} />
      </div>
      <div className="mono small muted">{d.dataset_id}</div>
      <dl className="kvs" style={{ marginTop: 6 }}>
        <div className="kv">
          <dt>size</dt>
          <dd>{fmtBytes(d.bytes)}</dd>
        </div>
        <div className="kv">
          <dt>lines</dt>
          <dd>
            {fmtNum(d.progress_line)} / {fmtNum(d.total_lines)}
            {pct !== null && d.import_state !== 'ready' ? ` (${pct}%)` : ''}
          </dd>
        </div>
        <div className="kv">
          <dt>valid / rejected</dt>
          <dd>
            {fmtNum(d.valid_count)} / <span className={d.rejected_count ? 'check-bad' : ''}>{fmtNum(d.rejected_count)}</span>
          </dd>
        </div>
        <div className="kv">
          <dt>range</dt>
          <dd className="small">
            {fmtTime(d.first_event_time)} → {fmtTime(d.last_event_time)}
          </dd>
        </div>
        <div className="kv">
          <dt>sha256</dt>
          <dd className="mono small">{shortId(d.content_sha256, 20)}</dd>
        </div>
        {stats.users !== undefined ? (
          <div className="kv">
            <dt>accounts</dt>
            <dd>{stats.users}</dd>
          </div>
        ) : null}
      </dl>
      {stats.status_counts ? (
        <div className="small muted" style={{ marginTop: 4 }}>
          status counts:{' '}
          {Object.entries(stats.status_counts)
            .map(([k, v]) => `${k}=${fmtNum(v)}`)
            .join(' ')}
        </div>
      ) : null}
      {d.error ? <div className="notice notice-danger" style={{ marginTop: 6 }}>import error: {d.error}</div> : null}
      {d.rejected_count ? (
        <div style={{ marginTop: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => setShowRejects((s) => !s)}>
            {showRejects ? 'Hide' : 'Show'} rejected lines
          </button>
          {showRejects ? (
            detail.loading ? (
              <Loading what="rejects" />
            ) : detail.error ? (
              <ErrorState error={detail.error} onRetry={() => void detail.reload()} what="rejects" />
            ) : detail.data && detail.data.rejects_sample.length > 0 ? (
              <ul className="plain" style={{ marginTop: 6 }}>
                {detail.data.rejects_sample.map((r) => (
                  <li key={r.line_number} className="evidence-line">
                    <div className="meta">
                      line {r.line_number} · {r.reason}
                    </div>
                    <pre className="code-block">
                      <code>{r.raw_input}</code>
                    </pre>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No reject samples returned.</Empty>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function NewRunForm({ datasets, onCreated }: { datasets: Dataset[]; onCreated: () => void }) {
  const nav = useNavigate()
  const ready = datasets.filter((d) => d.import_state === 'ready')
  const [datasetId, setDatasetId] = useState('')
  const [name, setName] = useState('')
  const [visibleStart, setVisibleStart] = useState('')
  const [speed, setSpeed] = useState('')
  const [pauseAtVisible, setPauseAtVisible] = useState(false)
  const [modelId, setModelId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown | null>(null)

  const chosen = datasetId || ready[0]?.dataset_id || ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!chosen) return
    setBusy(true)
    setErr(null)
    const body: RunCreateBody = { dataset_id: chosen, mode: 'replay', name: name.trim(), pause_at_visible_start: pauseAtVisible }
    if (visibleStart.trim()) body.visible_start = visibleStart.trim()
    if (speed.trim() !== '') body.speed = Number(speed)
    if (modelId.trim()) body.model_id = modelId.trim()
    try {
      const run = await api.createRun(body)
      onCreated()
      nav(`/runs/${encodeURIComponent(run.run_id)}`)
    } catch (ex) {
      setErr(ex)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="New replay run">
      <form onSubmit={(e) => void submit(e)} className="stack">
        <div className="form-grid">
          <label className="field">
            dataset (ready only)
            <select value={chosen} onChange={(e) => setDatasetId(e.target.value)} required>
              {ready.length === 0 ? <option value="">no ready dataset</option> : null}
              {ready.map((d) => (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {d.original_name} ({fmtNum(d.valid_count)} lines)
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. march-sequence (use 'fault' for fault injection)" />
          </label>
          <label className="field">
            visible start (ISO 8601, optional)
            <input value={visibleStart} onChange={(e) => setVisibleStart(e.target.value)} placeholder="2026-03-01T04:00:00Z" />
          </label>
          <label className="field">
            speed (0 = fast-forward, unbounded)
            <input value={speed} onChange={(e) => setSpeed(e.target.value)} type="number" min={0} step="any" placeholder="config default" />
          </label>
          <label className="field">
            model id (optional; blank = rules-only if none)
            <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="model_id" />
          </label>
          <label className="check">
            <input type="checkbox" checked={pauseAtVisible} onChange={(e) => setPauseAtVisible(e.target.checked)} /> pause at visible start
          </label>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !chosen}>
            {busy ? 'Creating…' : 'Create run'}
          </button>
          <span className="muted small">Mode: historical replay. Start it from the run console.</span>
        </div>
        {err ? (
          <div className="notice notice-danger">
            {(() => {
              const d = describeError(err)
              return `Create failed (HTTP ${d.status ?? '—'}): ${d.text}`
            })()}
          </div>
        ) : null}
      </form>
    </Section>
  )
}
