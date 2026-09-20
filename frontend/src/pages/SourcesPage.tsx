import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Database, FileText, Plus, RefreshCw, UploadCloud, X } from 'lucide-react'
import { api } from '../api'
import { fmtBytes, fmtNum, fmtTime } from '../format'
import { useWorkspace } from '../workspace'
import { useFetch, useInterval } from '../useFetch'
import { Code, Empty, ErrorState, KV, Loading, Section, StateBadge } from '../ui'
import { Overlay } from '../components/Overlay'
import { Metric, PageHeader, SearchField } from '../components/Page'

export function SourcesPage() {
  const { sources } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') || ''
  const rows =
    sources.data?.filter((s) =>
      `${s.original_name} ${s.dataset_id}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? []
  function update(key: string, value: string) {
    setParams((p) => {
      if (value) p.set(key, value)
      else p.delete(key)
      return p
    })
  }
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow="RESOURCES"
        title="Log sources"
        description="Your source of truth. Import access logs and track data quality."
        actions={
          <>
            <button className="btn" disabled={sources.refreshing} onClick={() => void sources.reload()}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <button className="btn btn-primary" onClick={() => update('upload', '1')}>
              <Plus size={16} />
              Add log source
            </button>
          </>
        }
      />
      <section className="resource-panel">
        <header className="resource-panel-heading">
          <div>
            <h2>
              Sources <span className="count">{sources.data?.length ?? '—'}</span>
            </h2>
            <p>Imported datasets are available to historical executions.</p>
          </div>
        </header>
        <div className="table-toolbar">
          <SearchField
            label="Search log sources"
            value={search}
            onChange={(s) => update('q', s)}
            placeholder="Find by source name or ID"
          />
        </div>
        {sources.loading ? (
          <Loading what="sources" />
        ) : sources.error ? (
          <ErrorState error={sources.error} onRetry={() => void sources.reload()} what="sources" />
        ) : rows.length === 0 ? (
          <Empty>
            <Database size={28} />
            <h3>{search ? 'No matching sources' : 'Bring your logs into focus'}</h3>
            <p>
              {search
                ? 'Try another source name.'
                : 'Upload an HTTP access log to begin. Import progress and rejected records appear here.'}
            </p>
            {!search && (
              <button className="btn btn-primary" onClick={() => update('upload', '1')}>
                Add log source
              </button>
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl resource-table">
              <thead>
                <tr>
                  <th>Log source</th>
                  <th>Status</th>
                  <th className="right">Valid records</th>
                  <th className="right">Rejected</th>
                  <th>Size</th>
                  <th>Last event (UTC)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.dataset_id}>
                    <td>
                      <Link className="resource-name" to={`/sources/${encodeURIComponent(s.dataset_id)}`}>
                        <FileText size={17} />
                        {s.original_name}
                      </Link>
                      <span className="cell-secondary">HTTP access logs</span>
                    </td>
                    <td>
                      <StateBadge state={s.import_state} />
                    </td>
                    <td className="right mono">{fmtNum(s.valid_count)}</td>
                    <td className={`right mono ${s.rejected_count ? 'text-warn' : 'muted'}`}>
                      {fmtNum(s.rejected_count)}
                    </td>
                    <td className="nowrap">{fmtBytes(s.bytes)}</td>
                    <td className="small nowrap">{fmtTime(s.last_event_time)}</td>
                    <td>
                      <Link
                        className="icon-btn"
                        aria-label={`View ${s.original_name}`}
                        to={`/sources/${encodeURIComponent(s.dataset_id)}`}
                      >
                        <ArrowRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footnote">
          {rows.length} sources <span>Content-addressed · duplicate uploads are deduplicated</span>
        </div>
      </section>
      <Overlay
        open={params.get('upload') === '1'}
        onClose={() => update('upload', '')}
        title="Add log source"
        description="Upload an HTTP access log file. Import runs in the background."
      >
        <UploadForm />
      </Overlay>
    </div>
  )
}

function UploadForm() {
  const { sources } = useWorkspace()
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const source = await api.uploadDataset(file)
      await sources.reload()
      nav(`/sources/${encodeURIComponent(source.dataset_id)}`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack form-stack" onSubmit={(e) => void submit(e)}>
      <input
        ref={input}
        className="sr-only"
        type="file"
        aria-label="Log file"
        accept=".log,.txt,text/plain"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className={`upload-zone ${dragging ? 'is-dragging' : ''}`}
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!busy) setFile(e.dataTransfer.files[0] ?? null)
        }}
      >
        <UploadCloud size={30} />
        <strong>Drop a log file here</strong>
        <span>or click to browse</span>
        <small>.log or .txt · HTTP access log format</small>
      </button>
      {file && (
        <div className="selected-file">
          <FileText size={22} />
          <div>
            <strong>{file.name}</strong>
            <span>{fmtBytes(file.size)}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove selected file"
            disabled={busy}
            onClick={() => setFile(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <p className="muted small">
        Records that cannot be parsed are retained as rejected lines for review. Re-uploading the same file
        returns the existing source.
      </p>
      {!!error && <ErrorState error={error} what="upload" />}
      <div className="form-footer">
        <span className="muted small">
          {busy ? 'Uploading. Keep this dialog open.' : 'Data stays within your backend.'}
        </span>
        <button type="submit" className="btn btn-primary" disabled={!file || busy}>
          {busy ? 'Uploading…' : 'Upload source'}
        </button>
      </div>
    </form>
  )
}

export function SourceDetail() {
  const { sourceId = '' } = useParams()
  const { runs } = useWorkspace()
  const source = useFetch(() => api.getDataset(sourceId), [sourceId])
  useInterval(
    () => void source.reload(),
    source.data && !['ready', 'failed'].includes(source.data.import_state) ? 3000 : null,
  )
  const s = source.data
  if (source.loading) return <Loading what="log source" />
  if (source.error)
    return <ErrorState error={source.error} what="log source" onRetry={() => void source.reload()} />
  if (!s) return <Empty>Source not found.</Empty>
  const related = runs.data?.filter((r) => r.dataset_id === sourceId) ?? []
  return (
    <div className="stack page-stack">
      <div className="crumbs">
        <Link to="/sources">Log sources</Link>
        <span>/</span>
        {s.original_name}
      </div>
      <PageHeader
        eyebrow="LOG SOURCE"
        title={s.original_name}
        description="Import quality, source metadata, and related executions."
        actions={
          <>
            <StateBadge state={s.import_state} />
            <Link
              className="btn btn-primary"
              to={`/runs?create=1&source=${encodeURIComponent(sourceId)}`}
              aria-disabled={s.import_state !== 'ready'}
              onClick={(e) => {
                if (s.import_state !== 'ready') e.preventDefault()
              }}
            >
              <Plus size={16} />
              Create execution
            </Link>
          </>
        }
      />
      <div className="metrics-strip">
        <Metric label="Valid records" value={fmtNum(s.valid_count)} detail="Ready for detection" />
        <Metric
          label="Rejected records"
          value={fmtNum(s.rejected_count)}
          detail="Preserved for review"
          tone={s.rejected_count ? 'warn' : undefined}
        />
        <Metric label="File size" value={fmtBytes(s.bytes)} detail="Original upload" />
        <Metric label="Executions" value={related.length} detail="Using this source" />
      </div>
      {!!s.error && (
        <div className="notice notice-danger" role="alert">
          Import failed: {s.error}
        </div>
      )}
      {s.import_state !== 'ready' && (
        <Section title="Import progress">
          <progress aria-label="Import progress" value={s.progress_bytes ?? 0} max={s.bytes || 1} />
          <p className="small muted">
            {fmtNum(s.progress_line)} lines processed. Status: {s.import_state}.
          </p>
        </Section>
      )}
      <Section title="Source details">
        <dl className="detail-grid">
          <KV k="Source ID" mono>
            {s.dataset_id}
          </KV>
          <KV k="Format">HTTP access logs</KV>
          <KV k="First event (UTC)">{fmtTime(s.first_event_time)}</KV>
          <KV k="Last event (UTC)">{fmtTime(s.last_event_time)}</KV>
          <KV k="Imported at (UTC)">{fmtTime(s.created_at)}</KV>
          <KV k="Content fingerprint" mono>
            {s.content_sha256}
          </KV>
        </dl>
      </Section>
      <Section
        title="Related executions"
        aside={
          <Link className="link" to="/runs">
            All executions →
          </Link>
        }
      >
        {related.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Execution</th>
                  <th>Status</th>
                  <th>Processed</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {related.map((r) => (
                  <tr key={r.run_id}>
                    <td>
                      <Link className="resource-name" to={`/runs/${encodeURIComponent(r.run_id)}`}>
                        {r.name || r.run_id}
                      </Link>
                    </td>
                    <td>
                      <StateBadge state={r.state} />
                    </td>
                    <td className="mono">{fmtNum(r.processed_seq)}</td>
                    <td>{fmtTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No executions use this source yet.</Empty>
        )}
      </Section>
      {!!s.rejected_count && (
        <Section
          title="Rejected records"
          aside={<span className="muted small">First 50 rejected lines</span>}
        >
          {s.rejects_sample.map((r) => (
            <div key={r.line_number} className="evidence-line">
              <div className="meta">
                Line {r.line_number} · {r.reason}
              </div>
              <Code block>{r.raw_input}</Code>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}
