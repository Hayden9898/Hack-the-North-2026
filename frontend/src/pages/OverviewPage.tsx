import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Database, Plus, RefreshCw, ShieldCheck, Workflow } from 'lucide-react'
import { api } from '../api'
import { useFetch, useInterval } from '../useFetch'
import { useWorkspace } from '../workspace'
import { Empty, ErrorState, Loading, ModelHealthBadge, StateBadge } from '../ui'
import { ExecutionScope, PageHeader } from '../components/Page'
import { useExecutionScope } from '../useExecutionScope'
import { ActivityPanel } from './ActivityPanel'
import { ExecutionMetrics } from './RunConsole'
import { IncidentsTable } from './IncidentsPage'
import { fmtNum } from '../format'

export function OverviewPage({ analytics = false }: { analytics?: boolean }) {
  const { id, setId, runs } = useExecutionScope()
  const { sources, health } = useWorkspace()
  const result = useFetch(() => api.getRun(id), [id], !!id)
  useInterval(() => {
    if (id && !document.hidden) void result.reload()
  }, 10_000)
  const r = result.data
  return (
    <div className="stack page-stack">
      <PageHeader
        eyebrow={analytics ? 'OBSERVABILITY' : 'WORKSPACE OVERVIEW'}
        title={analytics ? 'Analytics' : 'Security overview'}
        description={
          analytics
            ? 'Measured activity, response patterns, and detection outcomes.'
            : 'A clear view of your logs, detections, and investigations.'
        }
        actions={
          <>
            <button
              className="btn"
              disabled={result.refreshing}
              onClick={() => {
                void runs.reload()
                if (id) void result.reload()
              }}
            >
              <RefreshCw size={15} className={result.refreshing ? 'spin' : ''} />
              Refresh
            </button>
            <Link className="btn btn-primary" to="/runs?create=1">
              <Plus size={16} />
              Create execution
            </Link>
          </>
        }
      />
      <div className="overview-scope">
        <ExecutionScope id={id} onChange={setId} />
        {r && (
          <div className="row">
            <StateBadge state={r.state} />
            <span className="small muted">
              {r.mode === 'replay' ? 'Historical replay' : 'Live ingestion'}
            </span>
          </div>
        )}
      </div>
      {runs.loading || result.loading ? (
        <Loading what="overview" />
      ) : runs.error ? (
        <ErrorState error={runs.error} what="executions" onRetry={() => void runs.reload()} />
      ) : result.error ? (
        <ErrorState error={result.error} what="execution overview" onRetry={() => void result.reload()} />
      ) : !r ? (
        <div className="onboarding">
          <span className="onboarding-icon">
            <ShieldCheck size={30} />
          </span>
          <h2>Every investigation starts with evidence.</h2>
          <p>
            Connect a log source, run detection, and follow the signal from a finding to the original event.
          </p>
          <div className="setup-steps">
            <Link to="/sources?upload=1">
              <span>01</span>
              <Database size={22} />
              <h3>Add a log source</h3>
              <p>Upload your HTTP access logs.</p>
              <ArrowRight size={17} />
            </Link>
            <Link to="/runs?create=1">
              <span>02</span>
              <Workflow size={22} />
              <h3>Create an execution</h3>
              <p>Build a baseline and detect changes.</p>
              <ArrowRight size={17} />
            </Link>
            <Link to="/incidents">
              <span>03</span>
              <ShieldCheck size={22} />
              <h3>Investigate findings</h3>
              <p>Review facts and their evidence.</p>
              <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ExecutionMetrics run={r} />
          <ActivityPanel runId={id} processedSeq={r.processed_seq} run={r} />
          {!analytics && <IncidentsTable runId={id} compact />}
        </>
      )}
      {!analytics && (
        <div className="overview-bottom">
          <section className="resource-panel">
            <header className="resource-panel-heading">
              <h2>
                Log sources <span className="count">{sources.data?.length ?? '—'}</span>
              </h2>
              <Link className="link small" to="/sources">
                Manage sources
                <ArrowUpRight size={13} />
              </Link>
            </header>
            {sources.loading ? (
              <Loading what="sources" />
            ) : sources.error ? (
              <ErrorState error={sources.error} what="sources" onRetry={() => void sources.reload()} />
            ) : !sources.data?.length ? (
              <Empty>No log sources connected yet.</Empty>
            ) : (
              sources.data.slice(0, 3).map((s) => (
                <Link
                  className="source-summary"
                  key={s.dataset_id}
                  to={`/sources/${encodeURIComponent(s.dataset_id)}`}
                >
                  <span className="source-icon">
                    <Database size={17} />
                  </span>
                  <span>
                    <strong>{s.original_name}</strong>
                    <small>{fmtNum(s.valid_count)} records · HTTP access logs</small>
                  </span>
                  <StateBadge state={s.import_state} />
                </Link>
              ))
            )}
          </section>
          <section className="resource-panel">
            <header className="resource-panel-heading">
              <h2>Detection coverage</h2>
              <Link className="link small" to="/detection">
                Configuration
                <ArrowUpRight size={13} />
              </Link>
            </header>
            <div className="coverage-row">
              <span>Deterministic rules</span>
              <strong>R1–R5</strong>
            </div>
            <div className="coverage-row">
              <span>Behavioral model</span>
              {r ? (
                <ModelHealthBadge health={r.model_health} />
              ) : (
                <span className="muted">No execution selected</span>
              )}
            </div>
            <div className="coverage-row">
              <span>AI review</span>
              <span>
                {health.data?.integrations.llm.startsWith('enabled')
                  ? 'Enabled'
                  : health.data
                    ? 'Deterministic fallback'
                    : 'Unavailable'}
              </span>
            </div>
            <div className="coverage-note">
              <ShieldCheck size={15} />
              <span>Detector findings remain separate from AI hypotheses.</span>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
