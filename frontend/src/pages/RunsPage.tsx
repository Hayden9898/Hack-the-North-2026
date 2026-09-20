import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Plus, RefreshCw, Workflow } from 'lucide-react'
import { api, type RunCreateBody } from '../api'
import { fmtNum, fmtTime, shortId, speedLabel } from '../format'
import { useWorkspace } from '../workspace'
import { Empty, ErrorState, Loading, ModelHealthBadge, StateBadge, Tag } from '../ui'
import { Overlay } from '../components/Overlay'
import { PageHeader, Pagination, SearchField } from '../components/Page'

export function RunsPage() {
  const { runs, sources } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') || ''
  const status = params.get('status') || ''
  const asc = params.get('sort') === 'oldest'
  const filtered = (runs.data ?? [])
    .filter(
      (r) =>
        (!status || r.state === status) &&
        `${r.name} ${r.run_id} ${r.dataset_id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => (asc ? 1 : -1) * a.created_at.localeCompare(b.created_at))
  const page = Math.min(
    Math.max(0, Number(params.get('page')) || 0),
    Math.max(0, Math.ceil(filtered.length / 12) - 1),
  )
  function update(key: string, value: string) {
    setParams((p) => {
      if (value) p.set(key, value)
      else p.delete(key)
      if (key !== 'page') p.delete('page')
      return p
    })
  }
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow="RESOURCES"
        title="Executions"
        description="Run detection, follow progress, and investigate the results."
        actions={
          <>
            <button className="btn" onClick={() => void runs.reload()} disabled={runs.refreshing}>
              <RefreshCw size={15} className={runs.refreshing ? 'spin' : ''} />
              Refresh
            </button>
            <button className="btn btn-primary" onClick={() => update('create', '1')}>
              <Plus size={16} />
              Create execution
            </button>
          </>
        }
      />
      <section className="resource-panel">
        <header className="resource-panel-heading">
          <div>
            <h2>
              All executions <span className="count">{runs.data?.length ?? '—'}</span>
            </h2>
            <p>Each execution processes a source independently.</p>
          </div>
          <span className="small muted">Latest 100 executions · refreshes every 15s</span>
        </header>
        <div className="table-toolbar">
          <SearchField
            value={search}
            onChange={(s) => update('q', s)}
            placeholder="Find by name, source, or execution ID"
            label="Search executions"
          />
          <select
            aria-label="Execution status"
            value={status}
            onChange={(e) => update('status', e.target.value)}
          >
            <option value="">All statuses</option>
            {['created', 'running', 'warming', 'paused', 'completed', 'blocked'].map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          {(status || search) && (
            <button className="btn btn-ghost" onClick={() => setParams({})}>
              Clear filters
            </button>
          )}
        </div>
        {runs.loading ? (
          <Loading what="executions" />
        ) : runs.error ? (
          <ErrorState error={runs.error} onRetry={() => void runs.reload()} what="executions" />
        ) : filtered.length === 0 ? (
          <Empty>
            <Workflow size={26} />
            <h3>{search || status ? 'No matching executions' : 'Your first execution starts here'}</h3>
            <p>
              {search || status
                ? 'Adjust the search or status filter.'
                : 'Choose an imported log source to begin detection.'}
            </p>
            {!search && !status && (
              <button className="btn btn-primary" onClick={() => update('create', '1')}>
                Create execution
              </button>
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl resource-table">
              <thead>
                <tr>
                  <th>Execution</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Detection</th>
                  <th>Progress</th>
                  <th aria-sort={asc ? 'ascending' : 'descending'}>
                    <button className="sort-button" onClick={() => update('sort', asc ? '' : 'oldest')}>
                      Created {asc ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 12, page * 12 + 12).map((r) => (
                  <tr key={r.run_id}>
                    <td>
                      <Link className="resource-name" to={`/runs/${encodeURIComponent(r.run_id)}`}>
                        <Workflow size={16} />
                        {r.name || shortId(r.run_id, 14)}
                      </Link>
                      <span className="cell-secondary">
                        {r.mode === 'replay' ? 'Historical replay' : 'Live ingestion'} <span>·</span>{' '}
                        {speedLabel(r.speed)}
                      </span>
                    </td>
                    <td>
                      <StateBadge state={r.state} />
                      {r.block_reason && <span className="cell-secondary text-danger">{r.block_reason}</span>}
                    </td>
                    <td>
                      {r.dataset_id ? (
                        <Link className="link" to={`/sources/${encodeURIComponent(r.dataset_id)}`}>
                          {sources.data?.find((s) => s.dataset_id === r.dataset_id)?.original_name ??
                            shortId(r.dataset_id, 14)}
                        </Link>
                      ) : (
                        <span>{r.source_id}</span>
                      )}
                    </td>
                    <td>
                      <ModelHealthBadge health={r.model_health} />
                    </td>
                    <td>
                      <div className="progress-cell">
                        <span className="mono">
                          {fmtNum(r.processed_seq)}
                          <span className="muted"> / {fmtNum(r.admitted_seq)}</span>
                        </span>
                        <progress
                          aria-label={`Processing progress for ${r.name}`}
                          value={r.processed_seq}
                          max={Math.max(r.admitted_seq, 1)}
                        />
                      </div>
                    </td>
                    <td className="small nowrap">{fmtTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={page}
          total={filtered.length}
          size={12}
          onChange={(p) => update('page', String(p))}
        />
      </section>
      <Overlay
        open={params.get('create') === '1'}
        onClose={() => update('create', '')}
        title="Create execution"
        description="Process a log source with an isolated detection run."
      >
        <NewRunForm />
      </Overlay>
    </div>
  )
}

function NewRunForm() {
  const { sources, runs, health } = useWorkspace()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const ready = (sources.data ?? []).filter((d) => d.import_state === 'ready')
  const [source, setSource] = useState(params.get('source') || '')
  const [name, setName] = useState('')
  const [speed, setSpeed] = useState('600')
  const [visibleStart, setVisibleStart] = useState('')
  const [model, setModel] = useState('')
  const [pause, setPause] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const chosen = source || ready[0]?.dataset_id || ''
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!chosen || busy) return
    setBusy(true)
    setError(null)
    const body: RunCreateBody = {
      dataset_id: chosen,
      name: name.trim(),
      mode: 'replay',
      speed: Number(speed),
      pause_at_visible_start: pause,
    }
    if (visibleStart) body.visible_start = `${visibleStart}:00Z`
    if (model) body.model_id = model
    try {
      const result = await api.createRun(body)
      await runs.reload()
      nav(`/runs/${encodeURIComponent(result.run_id)}`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack form-stack" onSubmit={(e) => void submit(e)}>
      <label className="field">
        Execution name
        <input
          autoFocus
          required
          maxLength={160}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. March access review"
        />
        <small>A descriptive name makes this execution easier to find.</small>
      </label>
      <label className="field">
        Log source
        <select required value={chosen} onChange={(e) => setSource(e.target.value)}>
          {!ready.length && <option value="">No ready sources</option>}
          {ready.map((s) => (
            <option key={s.dataset_id} value={s.dataset_id}>
              {s.original_name} · {fmtNum(s.valid_count)} events
            </option>
          ))}
        </select>
      </label>
      {sources.error ? (
        <ErrorState error={sources.error} what="sources" onRetry={() => void sources.reload()} />
      ) : (
        !ready.length && (
          <div className="notice">
            Upload a log source and wait for import to finish.{' '}
            <Link to="/sources?upload=1">Upload a source</Link>
          </div>
        )
      )}
      <label className="field">
        Replay speed
        <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
          <option value="1">Real time · 1×</option>
          <option value="60">60×</option>
          <option value="600">600×</option>
          <option value="0">Fast-forward · unbounded</option>
        </select>
      </label>
      <details className="advanced-options">
        <summary>Advanced configuration</summary>
        <div className="stack">
          <label className="field">
            Visible window starts at (UTC)
            <input
              type="datetime-local"
              value={visibleStart}
              onChange={(e) => setVisibleStart(e.target.value)}
            />
            <small>Earlier events build the behavioral baseline.</small>
          </label>
          <label className="field">
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Server default</option>
              {health.data?.models.artifacts.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} />
            Pause when the visible window begins
          </label>
        </div>
      </details>
      {!!error && <ErrorState error={error} what="execution creation" />}
      <div className="form-footer">
        <Tag tone="muted">Historical replay</Tag>
        <button type="submit" className="btn btn-primary" disabled={busy || !chosen || !name.trim()}>
          {busy ? 'Creating…' : 'Create execution'}
        </button>
      </div>
    </form>
  )
}
