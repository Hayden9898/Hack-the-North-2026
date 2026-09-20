/**
 * Containment actions on an incident: the step from "here is what happened" to "here is what I did about it".
 *
 * Each action arrives from the API already bound — every parameter carries the fact id it was read out of — so this
 * component renders provenance rather than a form. The operator's path is dry run → execute → verify, with rollback
 * available on anything reversible, and the page states plainly whether an execution reached a real system.
 */
import { useCallback, useState } from 'react'
import {
  api,
  describeError,
  type ActionsBlock,
  type BoundAction,
  type ActionLogEntry,
  type StoredPacket,
  type Verification,
} from '../api'
import { fmtTime, shortId } from '../format'
import { useFetch } from '../useFetch'
import { Code, Empty, ErrorState, Loading, Section, Tag } from '../ui'

const PHASE_LABEL: Record<ActionLogEntry['phase'], string> = {
  dry_run: 'dry run',
  execute: 'executed',
  verify: 'verified',
  rollback: 'rolled back',
}

const VERIFICATION_TONE: Record<Verification['status'], 'ok' | 'danger' | 'warn' | 'muted'> = {
  satisfied: 'ok',
  contradicted: 'danger',
  pending: 'warn',
  unavailable: 'muted',
  not_applicable: 'muted',
}

export function ActionsSection({
  runId,
  incidentId,
  version,
  onChanged,
}: {
  runId: string
  incidentId: string
  version: number
  onChanged: () => void
}) {
  const res = useFetch<ActionsBlock>(() => api.listActions(runId, incidentId, version), [runId, incidentId, version])
  const reload = useCallback(() => {
    void res.reload()
    onChanged()
  }, [res, onChanged])

  if (res.loading && !res.data) return <Loading what="actions" />
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={() => void res.reload()} what="actions" />
  const d = res.data
  if (!d) return null

  const containment = d.actions.filter((a) => a.severity === 'containment')
  const handoff = d.actions.filter((a) => a.severity === 'handoff')

  return (
    <Section
      title="Containment actions"
      aside={
        <span className="row">
          <Tag tone={d.execution_mode === 'live' ? 'danger' : 'muted'}>{d.execution_mode === 'live' ? 'live execution' : 'preview mode'}</Tag>
          <span className="muted">catalog v{d.catalog_version}</span>
        </span>
      }
    >
      <p className="muted small">
        Every parameter below was bound by code from a typed fact or from the incident record — the AI selects playbooks, it never
        supplies a target.{' '}
        {d.execution_mode === 'preview'
          ? 'In preview mode an approved action is recorded in full and no external system is contacted.'
          : 'Live mode POSTs the approved request to the configured remediation endpoint.'}
      </p>

      {d.contained_at ? (
        <div className={`notice ${d.containment_mode === 'applied' ? 'notice-ok' : 'notice-warn'}`} style={{ marginBottom: 8 }}>
          <strong>Contained</strong> at {fmtTime(d.contained_at)} ({d.containment_mode}).
          {d.containment_mode === 'preview' ? ' Recorded as a preview — no external system was changed.' : ''}
        </div>
      ) : null}

      {containment.length === 0 ? (
        <Empty>No containment action in the catalog applies to this incident's playbooks.</Empty>
      ) : (
        <ul className="plain stack">
          {containment.map((a) => (
            // Keyed by version too: switching incident version must drop the previous version's dry-run/verification state.
            <ActionCard key={`${version}-${a.action_id}`} runId={runId} incidentId={incidentId} version={version} action={a} mode={d.execution_mode} onChanged={reload} />
          ))}
        </ul>
      )}

      {handoff.length > 0 ? (
        <>
          <hr className="hr" />
          <h3>Handoff</h3>
          <PacketCard runId={runId} incidentId={incidentId} version={version} />
        </>
      ) : null}

      <hr className="hr" />
      <h3>Action log (append-only)</h3>
      {d.log.length === 0 ? (
        <Empty>Nothing has been proposed or executed for this incident.</Empty>
      ) : (
        <ul className="plain">
          {d.log.map((e) => (
            <li key={e.id} style={{ padding: '5px 0', borderBottom: '1px dashed var(--line)' }}>
              <div className="row">
                <Tag tone={e.error ? 'danger' : e.phase === 'execute' ? 'warn' : 'muted'}>{PHASE_LABEL[e.phase]}</Tag>
                <span className="mono small">{e.action_id}</span>
                <span className="small muted">
                  {e.operator} · {e.adapter} · {e.outcome} · {fmtTime(e.created_at)}
                </span>
              </div>
              {e.error ? (
                <div className="small" style={{ color: 'var(--danger)' }}>
                  {e.error}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ one action

function ActionCard({
  runId,
  incidentId,
  version,
  action,
  mode,
  onChanged,
}: {
  runId: string
  incidentId: string
  version: number
  action: BoundAction
  mode: 'preview' | 'live'
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown | null>(null)
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [confirming, setConfirming] = useState(false)
  // An execute that answers HTTP 200 with outcome "failed": not a transport error, but the operator must see it.
  const [execFailure, setExecFailure] = useState<string | null>(null)

  const state = action.proposal?.state ?? null
  const executed = state === 'executed'
  const rolledBack = state === 'rolled_back'
  const failed = state === 'failed'

  async function run<T>(label: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(label)
    setErr(null)
    setExecFailure(null)
    try {
      const r = await fn()
      after?.(r)
      onChanged()
    } catch (ex) {
      setErr(ex)
    } finally {
      setBusy(null)
      setConfirming(false)
    }
  }

  const e = err ? describeError(err) : null
  const detail = e && typeof e.text === 'string' ? e.text : null

  return (
    <li>
      <div className={`action-card${action.available ? '' : ' action-unavailable'}`}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="row">
              <strong>{action.title}</strong>
              {executed ? <Tag tone="warn">executed ({mode})</Tag> : null}
              {rolledBack ? <Tag tone="muted">rolled back</Tag> : null}
              {failed ? <Tag tone="danger">failed</Tag> : null}
              {!action.available ? <Tag tone="muted">unavailable</Tag> : null}
              {action.stale_approval ? <Tag tone="danger">binding changed</Tag> : null}
              {!action.reversible ? <Tag tone="danger">not reversible</Tag> : null}
            </div>
            <div className="small muted mono">
              {action.action_id} · {action.kind} · from playbook {action.playbook_id}
            </div>
          </div>
        </div>

        <p className="small" style={{ margin: '6px 0' }}>
          {action.summary}
        </p>

        {Object.keys(action.params).length > 0 ? (
          <table className="tbl" style={{ marginBottom: 6 }}>
            <thead>
              <tr>
                <th>parameter</th>
                <th>value</th>
                <th>bound from</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(action.params).map(([k, v]) => (
                <tr key={k}>
                  <td className="mono small">{k}</td>
                  <td className="mono">{v}</td>
                  <td className="mono small muted">{action.bound_from[k] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {!action.available ? (
          <ul className="bul small" style={{ color: 'var(--muted)' }}>
            {action.unmet.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        ) : (
          <>
            <dl className="kvs">
              <div className="kv">
                <dt>impact</dt>
                <dd>{action.impact}</dd>
              </div>
              <div className="kv">
                <dt>permissions</dt>
                <dd>{asText(action.permissions)}</dd>
              </div>
              <div className="kv">
                <dt>rollback</dt>
                <dd>{asText(action.rollback)}</dd>
              </div>
              <div className="kv">
                <dt>verification</dt>
                <dd>{action.verification.criterion}</dd>
              </div>
            </dl>

            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  void run('dry', () => api.dryRunAction(runId, incidentId, action.action_id, version), (r) => setDryRun(r.result.would_issue))
                }
              >
                {busy === 'dry' ? 'Running…' : 'Dry run'}
              </button>

              {confirming ? (
                <>
                  <span className="small" style={{ color: 'var(--danger)' }}>
                    {mode === 'live' ? 'This will be sent to the remediation endpoint.' : 'Record this action as approved?'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('exec', () => api.executeAction(runId, incidentId, action.action_id, version), (r) => {
                        if (r.outcome === 'failed') setExecFailure(r.error ?? 'execution failed')
                        const v = (r.result as { verification?: Verification }).verification
                        if (v) setVerification(v)
                      })
                    }
                  >
                    {busy === 'exec' ? 'Executing…' : 'Confirm'}
                  </button>
                  <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy !== null || executed || !action.dry_run_current}
                  title={
                    action.dry_run_current
                      ? undefined
                      : failed || execFailure
                        ? 'The last execution failed; a new dry run is required before approving again'
                        : 'Run a dry run first'
                  }
                  onClick={() => setConfirming(true)}
                >
                  Approve &amp; execute
                </button>
              )}

              {executed || rolledBack ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null}
                  onClick={() => void run('verify', () => api.verifyAction(runId, incidentId, action.action_id, version), (r) => setVerification(r.verification))}
                >
                  {busy === 'verify' ? 'Checking…' : 'Verify'}
                </button>
              ) : null}

              {executed && action.reversible ? (
                <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void run('rb', () => api.rollbackAction(runId, incidentId, action.action_id, version))}>
                  {busy === 'rb' ? 'Rolling back…' : 'Roll back'}
                </button>
              ) : null}

              {e ? (
                <span className="small" style={{ color: 'var(--danger)' }}>
                  HTTP {e.status ?? '—'}: {detail}
                </span>
              ) : null}
              {execFailure ? (
                <span className="small" style={{ color: 'var(--danger)' }} role="alert">
                  Execution failed: {execFailure}
                </span>
              ) : null}
            </div>
          </>
        )}

        {verification ? (
          <div className={`notice notice-${VERIFICATION_TONE[verification.status] === 'ok' ? 'ok' : VERIFICATION_TONE[verification.status] === 'danger' ? 'danger' : 'warn'}`} style={{ marginTop: 8 }}>
            <strong>Verification {verification.status}</strong> — {verification.detail}
            <div className="small muted mono">
              query {verification.query_id} · after #{verification.after_seq} · cutoff #{verification.cutoff_seq}
            </div>
          </div>
        ) : null}

        {dryRun ? (
          <details style={{ marginTop: 8 }}>
            <summary className="small muted">Exact request this approval would issue</summary>
            <Code block>{dryRun}</Code>
          </details>
        ) : null}
      </div>
    </li>
  )
}

// ------------------------------------------------------------------ response packet

function PacketCard({ runId, incidentId, version }: { runId: string; incidentId: string; version: number }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [stored, setStored] = useState<StoredPacket | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown | null>(null)

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setErr(null)
    try {
      await fn()
    } catch (ex) {
      setErr(ex)
    } finally {
      setBusy(null)
    }
  }

  const e = err ? describeError(err) : null
  return (
    <div className="action-card">
      <div className="row">
        <strong>Response packet</strong>
        <span className="mono small muted">report.export_packet</span>
      </div>
      <p className="small" style={{ margin: '6px 0' }}>
        One Markdown handoff for whoever performs the remediation: the incident, every typed fact with its evidence references, what these
        logs cannot show, the applicable playbooks, and each bound action with its parameters and verification criterion. Rendered from
        committed rows only.
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy !== null}
          onClick={() =>
            void act('preview', async () => {
              const p = await api.getResponsePacket(runId, incidentId, version)
              setPreview(p.markdown)
            })
          }
        >
          {busy === 'preview' ? 'Rendering…' : 'Preview'}
        </button>
        <a className="btn btn-sm" href={api.responsePacketDownloadUrl(runId, incidentId, version)} download>
          Download .md
        </a>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy !== null}
          onClick={() =>
            void act('store', async () => {
              setStored(await api.storeResponsePacket(runId, incidentId, version))
            })
          }
        >
          {busy === 'store' ? 'Sending…' : 'Store & send handoff'}
        </button>
        {stored ? (
          <span className="small check-ok">
            stored {shortId(stored.content_sha256, 12)} · {stored.notification_queued ? 'queued for delivery' : 'already queued'}
          </span>
        ) : null}
        {e ? (
          <span className="small" style={{ color: 'var(--danger)' }}>
            HTTP {e.status ?? '—'}: {e.text}
          </span>
        ) : null}
      </div>
      {preview ? (
        <details open style={{ marginTop: 8 }}>
          <summary className="small muted">Rendered packet</summary>
          <pre className="code-block" style={{ maxHeight: 420, overflow: 'auto' }}>
            <code>{preview}</code>
          </pre>
        </details>
      ) : null}
    </div>
  )
}

function asText(v: string | string[] | null | undefined): string {
  if (!v) return '—'
  return Array.isArray(v) ? v.join('; ') : v
}
