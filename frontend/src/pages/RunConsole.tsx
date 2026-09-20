import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api,
  describeError,
  type EventRow,
  type EventsPage,
  type EventsQuery,
  type IncidentsPage,
  type IncidentsQuery,
  type ModelHealth,
  type Phase,
  type ProgressUpdate,
  type Run,
  type RunState,
  type RunStateUpdate,
  type ThreatClass,
} from '../api'
import {
  classTone,
  explanationStateLabel,
  fmtNum,
  fmtPercentile,
  fmtTime,
  integrationLabel,
  isFaultRun,
  phaseLabel,
  runStateLabel,
  shortId,
  speedLabel,
} from '../format'
import { useFetch, useInterval, useThrottledCallback } from '../useFetch'
import { ClassBadge, Empty, ErrorState, IncidentLink, Loading, ModelHealthBadge, ModelHealthBanner, PhaseBadge, RuleTags, Section, StateBadge, Tag } from '../ui'
import { useRunUpdates, type ConnectionStatus, type UpdateType } from '../useRunUpdates'
import { ActivityPanel } from './ActivityPanel'

const WINDOW_ROWS = 300
const PAGE = 100

interface LiveCounters {
  processed_seq: number
  admitted_seq: number
  last_event_time: string | null
  phase: Phase
  state: RunState
  model_health: ModelHealth
}

export function RunConsole() {
  const { runId = '' } = useParams()
  const run = useFetch<Run>(() => api.getRun(runId), [runId])
  const [live, setLive] = useState<LiveCounters | null>(null)
  const [tick, setTick] = useState(0) // bumps when the events feed should refetch its newest page
  const [incTick, setIncTick] = useState(0)
  const [resyncs, setResyncs] = useState(0)

  // Coalesce bursts of SSE progress events into at most one refresh per second.
  const refreshFeeds = useThrottledCallback(() => {
    setTick((t) => t + 1)
    setIncTick((t) => t + 1)
  }, 1_000)
  const refreshRun = useThrottledCallback(() => void run.reload(), 2_000)
  const refreshIncidents = useThrottledCallback(() => setIncTick((t) => t + 1), 1_000)

  const onEvent = useCallback(
    (type: UpdateType, data: Record<string, unknown>) => {
      switch (type) {
        case 'progress': {
          const p = data as unknown as ProgressUpdate
          setLive({
            processed_seq: p.processed_seq,
            admitted_seq: p.admitted_seq,
            last_event_time: p.last_event_time,
            phase: p.phase,
            state: p.state,
            model_health: p.model_health,
          })
          refreshFeeds()
          refreshRun()
          break
        }
        case 'run_state': {
          const st = data as unknown as RunStateUpdate
          if (st.state) setLive((l) => (l ? { ...l, state: st.state } : l))
          refreshRun()
          refreshFeeds()
          break
        }
        case 'incident':
        case 'explanation':
        case 'delivery':
        case 'feedback':
          refreshIncidents()
          refreshRun()
          break
        case 'heartbeat':
        case 'resync_required':
        default:
          break
      }
    },
    [refreshFeeds, refreshRun, refreshIncidents],
  )
  const onResync = useCallback(() => {
    // Cursor expired: full snapshot refetch of run + incidents + events.
    setResyncs((n) => n + 1)
    void run.reload()
    setTick((t) => t + 1)
    setIncTick((t) => t + 1)
  }, [run])

  const updates = useRunUpdates(runId, { onEvent, onResync })

  // Polling fallback when the stream cannot be established: GET /runs/:id every 2 s.
  useInterval(
    () => {
      void run.reload()
      setTick((t) => t + 1)
      setIncTick((t) => t + 1)
    },
    updates.polling ? 2_000 : null,
  )

  const r = run.data
  const merged = useMemo(() => {
    if (!r) return null
    if (!live) return r
    // The live counters are newer than the last GET; prefer them, but never show a processed_seq below what the API returned.
    return {
      ...r,
      processed_seq: Math.max(r.processed_seq, live.processed_seq),
      admitted_seq: Math.max(r.admitted_seq, live.admitted_seq),
      last_processed_time: live.processed_seq >= r.processed_seq ? live.last_event_time : r.last_processed_time,
      phase: live.processed_seq >= r.processed_seq ? live.phase : r.phase,
      state: live.processed_seq >= r.processed_seq ? live.state : r.state,
      model_health: live.model_health ?? r.model_health,
    }
  }, [r, live])

  if (run.loading && !r) return <Loading what="run" />
  if (run.error && !r) return <ErrorState error={run.error} onRetry={() => void run.reload()} what="run" />
  if (!merged) return <Empty>Run not found.</Empty>

  return (
    <div className="stack">
      <div className="crumbs">
        <Link to="/">Runs</Link> / <span className="mono">{shortId(merged.run_id, 18)}</span>
      </div>
      <RunHeader run={merged} updates={updates} resyncs={resyncs} onRunChanged={(u) => run.set(() => u)} error={run.error} />
      <ModelHealthBanner health={merged.model_health} />
      <div className="grid-2">
        <EventsFeed runId={runId} tick={tick} cutoff={merged.processed_seq} />
        <IncidentsPanel runId={runId} tick={incTick} />
      </div>
      <ActivityPanel runId={runId} processedSeq={merged.processed_seq} run={merged} />
    </div>
  )
}

// ------------------------------------------------------------------ header

function RunHeader({
  run,
  updates,
  resyncs,
  onRunChanged,
  error,
}: {
  run: Run
  updates: { status: ConnectionStatus; attempts: number; lastId: number | null; polling: boolean }
  resyncs: number
  onRunChanged: (r: Run) => void
  error: unknown
}) {
  const counts = run.counts ?? {}
  const total = (m?: Record<string, number>) => Object.values(m ?? {}).reduce((a, b) => a + b, 0)
  const incidentsTotal = total(counts.incidents)
  const err = error ? describeError(error) : null
  return (
    <Section
      title={
        <span className="row">
          <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--fg)', fontSize: 17 }}>{run.name || shortId(run.run_id, 12)}</span>
          <Tag tone={run.mode === 'replay' ? 'muted' : 'info'}>{run.mode === 'replay' ? 'historical replay' : 'live'}</Tag>
          {isFaultRun(run.name) ? <Tag tone="danger">fault injection</Tag> : null}
          <PhaseBadge phase={run.phase} />
          <StateBadge state={run.state} label={runStateLabel(run.state)} />
          <ModelHealthBadge health={run.model_health} />
        </span>
      }
      aside={<Connection status={updates.status} attempts={updates.attempts} lastId={updates.lastId} resyncs={resyncs} />}
    >
      {err ? (
        <div className={`notice ${err.status === 503 ? 'notice-danger' : 'notice-warn'}`} style={{ marginBottom: 8 }}>
          {err.status === 503 ? 'Database unavailable — ' : 'Refresh failed — '}HTTP {err.status ?? '—'}: {err.text}. Showing last known state.
        </div>
      ) : null}
      {run.state === 'blocked' ? (
        <div className="notice notice-danger" style={{ marginBottom: 8 }}>
          <strong>Run blocked</strong> at run_seq {fmtNum(run.blocked_seq)}: {run.block_reason ?? 'unknown reason'}. Evidence up to the cutoff is preserved;
          nothing after it has been evaluated.
        </div>
      ) : null}
      <div className="grid-3">
        <div>
          <div className="stats">
            <div className="stat">
              <div className="v">{fmtNum(run.processed_seq)}</div>
              <div className="k">processed seq (cutoff)</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(run.admitted_seq)}</div>
              <div className="k">admitted seq</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(Math.max(0, run.admitted_seq - run.processed_seq))}</div>
              <div className="k">backlog</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(incidentsTotal)}</div>
              <div className="k">incidents</div>
            </div>
          </div>
          <dl className="kvs" style={{ marginTop: 10 }}>
            <div className="kv">
              <dt>dataset / source</dt>
              <dd className="mono small">{run.dataset_id ?? run.source_id ?? '—'}</dd>
            </div>
            <div className="kv">
              <dt>phase</dt>
              <dd>{phaseLabel(run.phase)}</dd>
            </div>
            <div className="kv">
              <dt>visible start</dt>
              <dd className="mono small">{fmtTime(run.visible_start)}</dd>
            </div>
            <div className="kv">
              <dt>virtual time</dt>
              <dd className="mono small">{fmtTime(run.virtual_time)}</dd>
            </div>
            <div className="kv">
              <dt>last processed event</dt>
              <dd className="mono small">{fmtTime(run.last_processed_time)}</dd>
            </div>
            <div className="kv">
              <dt>last admitted event</dt>
              <dd className="mono small">{fmtTime(run.last_admitted_time)}</dd>
            </div>
            <div className="kv">
              <dt>model</dt>
              <dd>
                {run.model_id ?? <span className="muted">none</span>} · features {run.feature_version}
              </dd>
            </div>
            <div className="kv">
              <dt>late events</dt>
              <dd>
                {fmtNum(run.late_count)} <span className="muted small">(persisted separately, excluded from live inference)</span>
              </dd>
            </div>
            <div className="kv">
              <dt>config hash</dt>
              <dd className="mono small">{shortId(run.config_hash, 16)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3>Counts under cutoff</h3>
          <table className="tbl" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>phase</th>
                <th className="right">normal</th>
                <th className="right">suspicious</th>
                <th className="right">high risk</th>
                <th className="right">unscored</th>
              </tr>
            </thead>
            <tbody>
              {(['warmup', 'visible'] as const).map((ph) => {
                const m = (counts[ph] ?? {}) as Record<string, number>
                return (
                  <tr key={ph}>
                    <td>{phaseLabel(ph)}</td>
                    <td className="right mono">{fmtNum(m.normal ?? 0)}</td>
                    <td className="right mono">{fmtNum(m.suspicious ?? 0)}</td>
                    <td className="right mono">{fmtNum(m.high_risk ?? 0)}</td>
                    <td className="right mono">{fmtNum(m.unscored ?? 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 6 }}>
            incidents: {Object.entries(counts.incidents ?? {}).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'} · notifications:{' '}
            {Object.entries(counts.notifications ?? {}).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'} · explanation jobs:{' '}
            {Object.entries(counts.explanation_jobs ?? {}).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}
          </div>
          <Containment counts={counts.containment} />
          <h3 style={{ marginTop: 10 }}>Integrations</h3>
          <div className="tags" style={{ marginTop: 4 }}>
            {(['sentry', 'llm', 'slack'] as const).map((k) => {
              const l = integrationLabel(k, run.integrations[k])
              return (
                <Tag key={k} tone={l.tone === 'ok' ? 'ok' : l.tone === 'warn' ? 'warn' : 'muted'}>
                  {l.text}
                </Tag>
              )
            })}
          </div>
        </div>
        <ReplayControls run={run} onChanged={onRunChanged} />
      </div>
    </Section>
  )
}

function Connection({ status, attempts, lastId, resyncs }: { status: ConnectionStatus; attempts: number; lastId: number | null; resyncs: number }) {
  const text =
    status === 'live'
      ? 'live'
      : status === 'connecting'
        ? 'connecting'
        : status === 'reconnecting'
          ? `reconnecting (attempt ${attempts})`
          : status === 'polling'
            ? `stream unavailable — polling every 2 s (after ${attempts} failures)`
            : 'disconnected'
  return (
    <span className={`conn conn-${status}`} title={`SSE /updates · last update seq ${lastId ?? '—'} · resyncs ${resyncs}`}>
      <span className="dot" /> updates: {text}
      {lastId !== null ? <span className="muted"> · seq {lastId}</span> : null}
      {resyncs > 0 ? <span className="muted"> · resynced ×{resyncs}</span> : null}
    </span>
  )
}

// ------------------------------------------------------------------ replay controls

function ReplayControls({ run, onChanged }: { run: Run; onChanged: (r: Run) => void }) {
  // Draft speed: null means "show the run's current speed".
  const [speedDraft, setSpeedDraft] = useState<string | null>(null)
  const speed = speedDraft ?? String(run.speed ?? '')
  const setSpeed = setSpeedDraft
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown | null>(null)

  async function act(action: 'start' | 'pause' | 'resume' | 'speed') {
    setBusy(action)
    setErr(null)
    try {
      const body = action === 'speed' ? { action, speed: Number(speed) } : { action }
      const updated = await api.replay(run.run_id, body)
      if (action === 'speed') setSpeedDraft(null)
      onChanged(updated)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }

  if (run.mode !== 'replay') {
    return (
      <div>
        <h3>Live ingestion</h3>
        <p className="small muted">This run is fed by POST /events with an ingest token. Replay controls do not apply.</p>
      </div>
    )
  }
  const s = run.state
  const canStart = s === 'created'
  const canPause = s === 'warming' || s === 'running'
  const canResume = s === 'paused'
  const terminal = s === 'completed' || s === 'blocked'
  const e = err ? describeError(err) : null
  return (
    <div>
      <h3>Replay controls</h3>
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn btn-primary" disabled={!canStart || busy !== null} onClick={() => void act('start')}>
          {busy === 'start' ? '…' : 'Start'}
        </button>
        <button type="button" className="btn" disabled={!canPause || busy !== null} onClick={() => void act('pause')}>
          {busy === 'pause' ? '…' : 'Pause'}
        </button>
        <button type="button" className="btn" disabled={!canResume || busy !== null} onClick={() => void act('resume')}>
          {busy === 'resume' ? '…' : 'Resume'}
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">
          speed (0 = fast-forward, unbounded)
          <span className="row">
            <input type="number" min={0} step="any" value={speed} onChange={(ev) => setSpeed(ev.target.value)} style={{ width: 110 }} disabled={terminal} />
            <button type="button" className="btn btn-sm" disabled={terminal || busy !== null || speed === ''} onClick={() => void act('speed')}>
              {busy === 'speed' ? '…' : 'Apply'}
            </button>
          </span>
        </label>
        <span className="small muted">current: {speedLabel(run.speed)}</span>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        {s === 'created'
          ? 'Not started. Start admits the historical warmup first, then the visible window.'
          : s === 'completed'
            ? 'Completed: everything admissible was processed. A reset is a new run.'
            : s === 'blocked'
              ? 'Blocked: controls disabled; create a new run to retry.'
              : run.pause_at_visible_start
                ? 'Will pause automatically when the visible window begins.'
                : ''}
      </p>
      {e ? (
        <div className="notice notice-danger">
          Control rejected (HTTP {e.status ?? '—'}): {e.text}
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ events feed

interface Filters {
  threat_class: ThreatClass | ''
  phase: Phase | ''
  account: string
}

function EventsFeed({ runId, tick, cutoff }: { runId: string; tick: number; cutoff: number }) {
  const nav = useNavigate()
  const [filters, setFilters] = useState<Filters>({ threat_class: '', phase: '', account: '' })
  const [accountDraft, setAccountDraft] = useState('')
  const [follow, setFollow] = useState(true)
  const filterKey = `${filters.threat_class}|${filters.phase}|${filters.account}`
  const baseQuery = useCallback(
    (extra: Partial<EventsQuery>): EventsQuery => ({
      order: 'desc',
      limit: PAGE,
      threat_class: filters.threat_class || undefined,
      phase: filters.phase || undefined,
      account: filters.account || undefined,
      ...extra,
    }),
    [filters],
  )

  // Newest page under the cutoff (bounded; refetched on throttled progress ticks while following).
  const newest = useFetch<EventsPage>(() => api.listEvents(runId, baseQuery({})), [runId, filterKey])
  const firstTick = useRef(true)
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false
      return
    }
    if (follow) void newest.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, follow])

  // Older pages loaded on demand; tagged with the filter key so a filter change discards them.
  const [older, setOlder] = useState<{ key: string; pages: EventsPage[] }>({ key: filterKey, pages: [] })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<unknown | null>(null)
  const olderPages = useMemo(() => (older.key === filterKey ? older.pages : []), [older, filterKey])

  // The bounded window is derived: newest page + older pages, de-duplicated, sorted desc, capped.
  const rows = useMemo(() => {
    const seen = new Set<number>()
    const out: EventRow[] = []
    for (const page of [newest.data, ...olderPages]) {
      for (const it of page?.items ?? []) {
        if (!seen.has(it.run_seq)) {
          seen.add(it.run_seq)
          out.push(it)
        }
      }
    }
    out.sort((a, b) => b.run_seq - a.run_seq)
    if (out.length <= WINDOW_ROWS) return out
    // Following live: keep the newest rows. Browsing history: keep the oldest rows the user paged to.
    return follow ? out.slice(0, WINDOW_ROWS) : out.slice(out.length - WINDOW_ROWS)
  }, [newest.data, olderPages, follow])

  const lastPage = olderPages.length ? olderPages[olderPages.length - 1] : newest.data
  const hasOlder = !!lastPage?.has_more

  async function loadOlder() {
    if (rows.length === 0) return
    setLoadingOlder(true)
    setFollow(false) // browsing history pauses the live merge so the window is stable
    try {
      const oldest = rows[rows.length - 1].run_seq
      const page = await api.listEvents(runId, baseQuery({ before_seq: oldest }))
      setOlder((o) => ({ key: filterKey, pages: [...(o.key === filterKey ? o.pages : []), page] }))
      setOlderError(null)
    } catch (e) {
      setOlderError(e)
    } finally {
      setLoadingOlder(false)
    }
  }

  function resumeFollow() {
    setOlder({ key: filterKey, pages: [] })
    setFollow(true)
    void newest.reload()
  }

  const error = newest.error ?? olderError
  const errText = error ? describeError(error) : null
  const activeFilters = !!(filters.threat_class || filters.phase || filters.account)

  return (
    <Section
      title={
        <span className="row">
          Event feed
          <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0 }}>
            processed evidence under cutoff #{fmtNum(newest.data?.cutoff_seq ?? cutoff)} · window {rows.length}/{WINDOW_ROWS}
          </span>
        </span>
      }
      aside={
        <div className="filters">
          <select value={filters.threat_class} onChange={(e) => setFilters((f) => ({ ...f, threat_class: e.target.value as Filters['threat_class'] }))}>
            <option value="">all classes</option>
            <option value="normal">normal</option>
            <option value="suspicious">suspicious</option>
            <option value="high_risk">high risk</option>
          </select>
          <select value={filters.phase} onChange={(e) => setFilters((f) => ({ ...f, phase: e.target.value as Filters['phase'] }))}>
            <option value="">all phases</option>
            <option value="warmup">historical warmup</option>
            <option value="visible">visible</option>
          </select>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setFilters((f) => ({ ...f, account: accountDraft.trim() }))
            }}
            className="row"
          >
            <input value={accountDraft} onChange={(e) => setAccountDraft(e.target.value)} placeholder="account (exact)" style={{ width: 130 }} />
            <button type="submit" className="btn btn-sm">
              Filter
            </button>
          </form>
          {follow ? (
            <Tag tone="ok">following live</Tag>
          ) : (
            <button type="button" className="btn btn-sm" onClick={resumeFollow}>
              Resume following
            </button>
          )}
        </div>
      }
    >
      <div className="legend" style={{ marginBottom: 6 }}>
        <span>
          <ClassBadge threatClass="normal" /> no configured detector flagged this
        </span>
        <span>
          <ClassBadge threatClass="suspicious" /> flagged for review
        </span>
        <span>
          <ClassBadge threatClass="high_risk" /> investigate urgently, not established guilt
        </span>
        <span>
          <ClassBadge threatClass={null} /> processing state, not a verdict
        </span>
        <span>
          <PhaseBadge phase="warmup" /> historical state-building, not a live decision
        </span>
      </div>
      {newest.error && !newest.data ? (
        <ErrorState error={newest.error} onRetry={() => void newest.reload()} what="events" />
      ) : newest.loading && !newest.data ? (
        <Loading what="events" />
      ) : rows.length === 0 ? (
        <Empty>No processed events under the current cutoff{activeFilters ? ' match these filters' : ''}.</Empty>
      ) : (
        <>
          {errText ? (
            <div className="notice notice-warn" style={{ marginBottom: 6 }}>
              {errText.status === 503 ? 'Database unavailable' : 'Refresh failed'} (HTTP {errText.status ?? '—'}): {errText.text}. Showing last loaded rows.{' '}
              <button type="button" className="btn btn-sm" onClick={() => void newest.reload()}>
                Retry
              </button>
            </div>
          ) : null}
          {newest.loading ? <Loading what="events" /> : null}
          <div className="table-wrap feed-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="right">seq</th>
                  <th>time (UTC)</th>
                  <th>phase</th>
                  <th>account@ip</th>
                  <th>request</th>
                  <th className="right">status</th>
                  <th className="right">bytes</th>
                  <th>class</th>
                  <th>rules</th>
                  <th>rarity pct.</th>
                  <th>reasons</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ev) => {
                  const tone = classTone(ev.threat_class, ev.processing_status)
                  return (
                    <tr
                      key={ev.run_seq}
                      className={`clickable row-${tone} ${ev.phase === 'warmup' ? 'row-warmup' : ''}`}
                      onClick={() => nav(`/runs/${encodeURIComponent(runId)}/events/${ev.run_seq}`)}
                    >
                      <td className="right mono">
                        <Link className="link" to={`/runs/${encodeURIComponent(runId)}/events/${ev.run_seq}`} onClick={(e) => e.stopPropagation()}>
                          {ev.run_seq}
                        </Link>
                      </td>
                      <td className="mono nowrap">{fmtTime(ev.event_time)}</td>
                      <td>{ev.phase === 'warmup' ? <PhaseBadge phase="warmup" /> : <span className="muted small">visible</span>}</td>
                      <td className="mono">
                        {ev.username}@{ev.ip_raw}
                      </td>
                      <td className="mono">
                        {ev.method} {ev.path}
                      </td>
                      <td className="right mono">{ev.status}</td>
                      <td className="right mono">{ev.response_bytes ?? '—'}</td>
                      <td>
                        <ClassBadge threatClass={ev.threat_class} processingStatus={ev.processing_status} />
                      </td>
                      <td>
                        <RuleTags ids={ev.rule_ids} />
                      </td>
                      <td className="mono small" title="rarity percentile from the baseline model; not a confidence or attack probability">
                        {ev.anomaly_percentile !== null ? fmtPercentile(ev.anomaly_percentile) : ev.model_score !== null ? ev.model_score.toFixed(3) : '—'}
                      </td>
                      <td className="small">{ev.reason_codes.length ? ev.reason_codes.join(', ') : <span className="muted">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="row row-between" style={{ marginTop: 8 }}>
            <span className="muted small">
              oldest shown #{rows[rows.length - 1]?.run_seq} · newest #{rows[0]?.run_seq}
            </span>
            <button type="button" className="btn btn-sm" disabled={!hasOlder || loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? 'Loading…' : hasOlder ? 'Load older' : 'No older events'}
            </button>
          </div>
        </>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ incidents panel

function IncidentsPanel({ runId, tick }: { runId: string; tick: number }) {
  const [q, setQ] = useState<IncidentsQuery>({ threat_class: '', status: '', phase: '', limit: 50, offset: 0 })
  const inc = useFetch<IncidentsPage>(() => api.listIncidents(runId, q), [runId, q.threat_class, q.status, q.phase, q.offset])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void inc.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const total = inc.data?.total ?? 0
  const limit = q.limit ?? 50
  const offset = q.offset ?? 0
  return (
    <Section
      title={
        <span className="row">
          Incidents <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0 }}>{inc.data ? `${fmtNum(total)} under cutoff #${fmtNum(inc.data.cutoff_seq)}` : ''}</span>
        </span>
      }
      aside={
        <div className="filters">
          <select value={q.threat_class} onChange={(e) => setQ((s) => ({ ...s, offset: 0, threat_class: e.target.value as IncidentsQuery['threat_class'] }))}>
            <option value="">all classes</option>
            <option value="suspicious">suspicious</option>
            <option value="high_risk">high risk</option>
            <option value="normal">normal</option>
          </select>
          <select value={q.status} onChange={(e) => setQ((s) => ({ ...s, offset: 0, status: e.target.value as IncidentsQuery['status'] }))}>
            <option value="">open + closed</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
          <select value={q.phase} onChange={(e) => setQ((s) => ({ ...s, offset: 0, phase: e.target.value as IncidentsQuery['phase'] }))}>
            <option value="">all phases</option>
            <option value="visible">visible</option>
            <option value="warmup">historical warmup</option>
          </select>
        </div>
      }
    >
      {inc.loading && !inc.data ? (
        <Loading what="incidents" />
      ) : inc.error && !inc.data ? (
        <ErrorState error={inc.error} onRetry={() => void inc.reload()} what="incidents" />
      ) : !inc.data || inc.data.items.length === 0 ? (
        <Empty>No incidents under the current cutoff{q.threat_class || q.status || q.phase ? ' match these filters' : ''}.</Empty>
      ) : (
        <>
          {inc.error ? (
            <div className="notice notice-warn" style={{ marginBottom: 6 }}>
              Refresh failed (HTTP {describeError(inc.error).status ?? '—'}). Showing last loaded incidents.
            </div>
          ) : null}
          <ul className="plain feed-scroll inc-list">
            {inc.data.items.map((i) => (
              <li key={i.incident_id} className={`inc-row inc-${i.current_class}`}>
                <div className="row">
                  <ClassBadge threatClass={i.current_class} />
                  <StateBadge state={i.status} />
                  <PhaseBadge phase={i.phase} />
                  <RuleTags ids={i.rule_ids} />
                  <span className="muted small mono">v{i.current_version}</span>
                  {i.evidence_strength?.evaluation_incomplete ? <Tag tone="warn">evaluation incomplete</Tag> : null}
                </div>
                <div className="inc-headline">
                  <IncidentLink runId={runId} incidentId={i.incident_id}>
                    <span style={{ fontFamily: 'var(--sans)' }}>{i.summary?.headline ?? i.primary_rule_id}</span>
                  </IncidentLink>
                </div>
                <div className="row small muted inc-meta">
                  <span className="mono">
                    {i.account ?? '—'}@{i.ip_raw ?? '—'}
                  </span>
                  <span className="mono nowrap">
                    {fmtTime(i.first_event_time)} → {fmtTime(i.last_event_time)}
                  </span>
                  <span>{i.evidence_count} evidence</span>
                  <span className="row">
                    delivery:{' '}
                    {i.delivery_states ? (
                      Array.from(new Set(i.delivery_states.split(','))).map((s) => <StateBadge key={s} state={s} />)
                    ) : (
                      <span>none</span>
                    )}
                  </span>
                  <StateBadge state={i.explanation_state ?? 'none'} label={explanationStateLabel(i.explanation_state)} />
                  <span className="mono">{shortId(i.incident_id, 12)}</span>
                </div>
              </li>
            ))}
          </ul>
          {total > limit ? (
            <div className="row row-between" style={{ marginTop: 8 }}>
              <span className="muted small">
                {offset + 1}–{Math.min(total, offset + limit)} of {fmtNum(total)}
              </span>
              <span className="row">
                <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => setQ((s) => ({ ...s, offset: Math.max(0, offset - limit) }))}>
                  Newer
                </button>
                <button type="button" className="btn btn-sm" disabled={offset + limit >= total} onClick={() => setQ((s) => ({ ...s, offset: offset + limit }))}>
                  Older
                </button>
              </span>
            </div>
          ) : null}
        </>
      )}
    </Section>
  )
}


/** Actionable incidents vs. those an operator contained, and how long that took in console time. */
function Containment({ counts }: { counts?: { actionable: number; contained: number; preview: number; applied: number; median_seconds: number | null } }) {
  if (!counts) return null
  const open = Math.max(0, counts.actionable - counts.contained)
  const pct = counts.actionable > 0 ? Math.round((counts.contained / counts.actionable) * 100) : 0
  return (
    <>
      <h3 style={{ marginTop: 10 }}>Containment</h3>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
        <span className="small">
          <strong className="mono">{fmtNum(counts.contained)}</strong> of <span className="mono">{fmtNum(counts.actionable)}</span> actionable incidents
          contained ({pct}%)
        </span>
        <span className="small muted">
          awaiting action: <span className="mono">{fmtNum(open)}</span>
        </span>
        <span className="small muted">
          median time to containment:{' '}
          <span className="mono">{counts.median_seconds === null ? '—' : fmtDuration(counts.median_seconds)}</span>
        </span>
        {counts.preview > 0 ? <Tag tone="muted">{fmtNum(counts.preview)} preview</Tag> : null}
        {counts.applied > 0 ? <Tag tone="warn">{fmtNum(counts.applied)} applied</Tag> : null}
      </div>
      <div className="small muted" style={{ marginTop: 2 }}>
        Console time from the incident record being created to an operator approving a containment action. A preview containment records the
        approval without contacting any external system.
      </div>
    </>
  )
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
}
