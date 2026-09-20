import { useCallback, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Pause, Play } from 'lucide-react'
import { api, type Run } from '../api'
import { fmtNum, fmtTime, integrationLabel, shortId, speedLabel } from '../format'
import { useFetch, useInterval, useThrottledCallback } from '../useFetch'
import { useRunUpdates } from '../useRunUpdates'
import {
  Empty,
  ErrorState,
  KV,
  Loading,
  ModelHealthBadge,
  ModelHealthBanner,
  Section,
  StateBadge,
  Tag,
} from '../ui'
import { Metric, PageHeader } from '../components/Page'
import { ActivityPanel } from './ActivityPanel'
import { EventsTable } from './ExplorerPage'
import { IncidentsTable } from './IncidentsPage'

export function RunConsole() {
  const { runId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'overview'
  const run = useFetch(() => api.getRun(runId), [runId])
  const [tick, setTick] = useState(0)
  const refresh = useThrottledCallback(() => {
    void run.reload()
    setTick((t) => t + 1)
  }, 1500)
  const onEvent = useCallback(
    (type: string) => {
      if (type !== 'heartbeat') refresh()
    },
    [refresh],
  )
  const updates = useRunUpdates(runId, { onEvent, onResync: refresh })
  useInterval(
    () => {
      if (!document.hidden) refresh()
    },
    updates.polling ? 3000 : 15_000,
  )
  const r = run.data
  function applyControl(next: Run) {
    // The mutation response omits aggregates. Keep the last measured counts until GET refreshes them.
    run.set((previous) => ({ ...next, counts: previous?.counts ?? next.counts }))
    refresh()
  }
  if (run.loading) return <Loading what="execution" />
  if (!!run.error && !r)
    return <ErrorState error={run.error} what="execution" onRetry={() => void run.reload()} />
  if (!r) return <Empty>Execution not found.</Empty>
  return (
    <div className="stack page-stack">
      <div className="crumbs">
        <Link to="/runs">Executions</Link>
        <span>/</span>
        {r.name || shortId(runId, 14)}
      </div>
      <PageHeader
        eyebrow="EXECUTION"
        title={r.name || shortId(runId, 14)}
        description={`${r.mode === 'replay' ? 'Historical replay' : 'Live ingestion'} · Created ${fmtTime(r.created_at)}`}
        actions={
          <>
            <StateBadge state={r.state} />
            <ReplayControls run={r} onChanged={applyControl} />
          </>
        }
      />
      {!!run.error && (
        <div className="notice notice-warn">Refresh failed. Showing the last known execution state.</div>
      )}
      {r.state === 'blocked' && (
        <div className="notice notice-danger" role="alert">
          <strong>Execution blocked at sequence {fmtNum(r.blocked_seq)}.</strong> {r.block_reason} Evidence
          before the cutoff is preserved.
        </div>
      )}
      <ModelHealthBanner health={r.model_health} />
      <div className="execution-meta">
        <div>
          <span>Source</span>
          {r.dataset_id ? (
            <Link to={`/sources/${encodeURIComponent(r.dataset_id)}`}>{shortId(r.dataset_id, 20)}</Link>
          ) : (
            <strong>{r.source_id}</strong>
          )}
        </div>
        <div>
          <span>Detection</span>
          <ModelHealthBadge health={r.model_health} />
        </div>
        <div>
          <span>Phase</span>
          <strong>{r.phase === 'warmup' ? 'Historical warmup' : 'Visible window'}</strong>
        </div>
        <div>
          <span>Updates</span>
          <span className={`conn conn-${updates.status}`}>
            <i className="dot" />
            {updates.polling ? 'Polling fallback' : updates.status === 'live' ? 'Connected' : updates.status}
          </span>
        </div>
        <div>
          <span>Replay speed</span>
          <strong>{speedLabel(r.speed)}</strong>
        </div>
      </div>
      <div className="resource-tabs" role="navigation" aria-label="Execution sections">
        {[
          ['overview', 'Overview'],
          ['events', 'Events'],
          ['incidents', 'Incidents'],
          ['configuration', 'Configuration'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? 'active' : ''}
            aria-current={tab === value ? 'page' : undefined}
            onClick={() =>
              setParams((p) => {
                p.set('tab', value)
                return p
              })
            }
          >
            {label}
            {tab === value && <motion.span layoutId="execution-tab" className="tab-indicator" />}
          </button>
        ))}
      </div>
      {tab === 'events' ? (
        <EventsTable key={runId} runId={runId} tick={tick} />
      ) : tab === 'incidents' ? (
        <IncidentsTable runId={runId} />
      ) : tab === 'configuration' ? (
        <ExecutionConfiguration run={r} onChanged={applyControl} />
      ) : (
        <>
          <ExecutionMetrics run={r} />
          <ActivityPanel runId={runId} processedSeq={r.processed_seq} run={r} />
          <IncidentsTable runId={runId} compact />
        </>
      )}
    </div>
  )
}

export function ExecutionMetrics({ run }: { run: Run }) {
  const counts = run.counts?.visible ?? {}
  const incidentCount = Object.values(run.counts?.incidents ?? {}).reduce((sum, n) => sum + n, 0)
  return (
    <div className="metrics-strip">
      <Metric
        label="Events processed"
        value={fmtNum(run.processed_seq)}
        detail={
          <>
            <progress
              aria-label="Execution progress"
              value={run.processed_seq}
              max={Math.max(1, run.admitted_seq)}
            />
            {fmtNum(run.admitted_seq)} admitted
          </>
        }
      />
      <Metric
        label="Suspicious findings"
        value={fmtNum(counts.suspicious ?? 0)}
        detail="Visible detection window"
        tone={(counts.suspicious ?? 0) > 0 ? 'warn' : undefined}
      />
      <Metric
        label="High-risk findings"
        value={fmtNum(counts.high_risk ?? 0)}
        detail="Visible detection window"
        tone={(counts.high_risk ?? 0) > 0 ? 'danger' : undefined}
      />
      <Metric label="Incidents" value={fmtNum(incidentCount)} detail="Related evidence groups" />
    </div>
  )
}

function ReplayControls({ run, onChanged }: { run: Run; onChanged: (run: Run) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  if (run.mode !== 'replay' || ['completed', 'blocked'].includes(run.state)) return null
  const action = run.state === 'created' ? 'start' : run.state === 'paused' ? 'resume' : 'pause'
  async function act() {
    setBusy(true)
    setError(null)
    try {
      onChanged(await api.replay(run.run_id, { action }))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="control-action">
      <button
        className={action === 'pause' ? 'btn' : 'btn btn-primary'}
        disabled={busy}
        onClick={() => void act()}
      >
        {action === 'pause' ? <Pause size={15} /> : <Play size={15} />}
        {busy ? 'Applying…' : `${action[0].toUpperCase() + action.slice(1)} execution`}
      </button>
      {!!error && <ErrorState error={error} what="execution action" />}
    </div>
  )
}

function ExecutionConfiguration({ run, onChanged }: { run: Run; onChanged: (r: Run) => void }) {
  const [speed, setSpeed] = useState(String(run.speed))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  async function save() {
    if (speed === '' || !Number.isFinite(Number(speed)) || Number(speed) < 0) return
    setBusy(true)
    setError(null)
    try {
      onChanged(await api.replay(run.run_id, { action: 'speed', speed: Number(speed) }))
      setSaved(true)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack">
      <Section title="Execution configuration">
        <dl className="detail-grid">
          <KV k="Execution ID" mono>
            {run.run_id}
          </KV>
          <KV k="Model ID" mono>
            {run.model_id || 'Rules only'}
          </KV>
          <KV k="Feature version" mono>
            {run.feature_version}
          </KV>
          <KV k="Configuration hash" mono>
            {run.config_hash}
          </KV>
          <KV k="Reference hash" mono>
            {run.reference_hash || '—'}
          </KV>
          <KV k="Visible window starts">{fmtTime(run.visible_start)}</KV>
          <KV k="Event range">
            {fmtTime(run.range_start)} → {fmtTime(run.range_end)}
          </KV>
          <KV k="Last processed event">{fmtTime(run.last_processed_time)}</KV>
          <KV k="Backlog">{fmtNum(run.backlog)} events</KV>
          <KV k="Late arrivals">{fmtNum(run.late_count)} stored without scoring</KV>
        </dl>
      </Section>
      {run.mode === 'replay' && (
        <Section title="Replay speed">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <label className="field">
              Speed multiplier
              <input
                type="number"
                min="0"
                step="any"
                required
                value={speed}
                disabled={['completed', 'blocked'].includes(run.state)}
                onChange={(e) => {
                  setSpeed(e.target.value)
                  setSaved(false)
                }}
              />
            </label>
            <button
              type="submit"
              className="btn"
              disabled={busy || ['completed', 'blocked'].includes(run.state)}
            >
              {busy ? 'Saving…' : 'Apply speed'}
            </button>
            {saved && (
              <span role="status" className="text-ok small">
                Speed updated
              </span>
            )}
          </form>
          <p className="muted small">
            0 processes events as fast as possible.{' '}
            {run.pause_at_visible_start
              ? 'This execution pauses when the visible window begins.'
              : 'Replay progresses through the configured window.'}
          </p>
          {!!error && <ErrorState error={error} what="speed update" />}
        </Section>
      )}
      <Section title="Integration modes">
        <div className="integration-modes">
          {Object.entries(run.integrations).map(([name, mode]) => (
            <div key={name}>
              <strong>{name === 'llm' ? 'AI review' : name === 'sentry' ? 'Sentry' : 'Slack'}</strong>
              <Tag tone={mode === 'live' || mode === 'active' ? 'ok' : 'muted'}>
                {integrationLabel(name as 'sentry' | 'llm' | 'slack', mode).text}
              </Tag>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
