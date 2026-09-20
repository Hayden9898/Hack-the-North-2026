/**
 * Containment actions on an incident: the step from "here is what happened" to "here is what I did about it".
 *
 * Each action arrives from the API already bound — every parameter carries the fact id it was read out of — so this
 * component renders provenance rather than a form. The operator's path is dry run → execute → verify, with rollback
 * available on anything reversible, and the page states plainly whether an execution reached a real system.
 */
import { type ReactNode, useCallback, useState } from 'react'
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
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

const PHASE_LABEL: Record<ActionLogEntry['phase'], string> = {
  dry_run: 'dry run',
  execute: 'executed',
  verify: 'verified',
  rollback: 'rolled back',
}

type Tone = 'ok' | 'danger' | 'warn' | 'muted'

const VERIFICATION_TONE: Record<Verification['status'], Tone> = {
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

  if (res.loading && !res.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    )
  }
  if (res.error && !res.data) {
    const e = describeError(res.error)
    return <ErrorState compact title="Could not load actions" detail={e.text} onRetry={() => void res.reload()} />
  }
  const d = res.data
  if (!d) return null

  const containment = d.actions.filter((a) => a.severity === 'containment')
  const handoff = d.actions.filter((a) => a.severity === 'handoff')

  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-heading">Containment actions</h2>
        <span className="flex items-center gap-2">
          <Tag tone={d.execution_mode === 'live' ? 'danger' : 'muted'}>{d.execution_mode === 'live' ? 'live execution' : 'preview mode'}</Tag>
          <span className="text-caption text-fg-muted">catalog v{d.catalog_version}</span>
        </span>
      </header>

      <div className="space-y-5 px-4 py-4">
        <p className="max-w-[80ch] text-caption text-fg-muted">
          Every parameter below was bound by code from a typed fact or from the incident record. The assistant selects
          playbooks; it never supplies a target.{' '}
          {d.execution_mode === 'preview'
            ? 'In preview mode an approved action is recorded in full and no external system is contacted.'
            : 'Live mode sends the approved request to the configured remediation endpoint.'}
        </p>

        {d.contained_at ? (
          <Notice tone={d.containment_mode === 'applied' ? 'ok' : 'warn'}>
            <strong>Contained</strong> at {fmtTime(d.contained_at)} ({d.containment_mode}).
            {d.containment_mode === 'preview' ? ' Recorded as a preview; no external system was changed.' : ''}
          </Notice>
        ) : null}

        {containment.length === 0 ? (
          <Empty>No containment action in the catalog applies to this incident's playbooks.</Empty>
        ) : (
          <ul className="grid gap-3">
            {containment.map((a) => (
              // Keyed by version too: switching incident version must drop the previous version's dry-run/verification state.
              <ActionCard key={`${version}-${a.action_id}`} runId={runId} incidentId={incidentId} version={version} action={a} mode={d.execution_mode} onChanged={reload} />
            ))}
          </ul>
        )}

        {handoff.length > 0 ? (
          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-body font-medium text-fg">Handoff</h3>
            <PacketCard runId={runId} incidentId={incidentId} version={version} />
          </div>
        ) : null}

        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-body font-medium text-fg">Action log</h3>
          {d.log.length === 0 ? (
            <Empty>Nothing has been proposed or executed for this incident.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {d.log.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={e.error ? 'danger' : e.phase === 'execute' ? 'warn' : 'muted'}>{PHASE_LABEL[e.phase]}</Tag>
                    <span className="font-mono text-caption text-fg">{e.action_id}</span>
                    <span className="text-caption text-fg-muted">
                      {e.operator} · {e.adapter} · {e.outcome} · {fmtTime(e.created_at)}
                    </span>
                  </div>
                  {e.error ? <p className="mt-1 text-caption text-high-risk">{e.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
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
    <li className={cn('rounded-lg border border-border bg-surface-raised px-4 py-3.5', !action.available && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-body font-medium text-fg">{action.title}</strong>
        {executed ? <Tag tone="warn">executed ({mode})</Tag> : null}
        {rolledBack ? <Tag tone="muted">rolled back</Tag> : null}
        {failed ? <Tag tone="danger">failed</Tag> : null}
        {!action.available ? <Tag tone="muted">unavailable</Tag> : null}
        {action.stale_approval ? <Tag tone="danger">binding changed</Tag> : null}
        {!action.reversible ? <Tag tone="danger">not reversible</Tag> : null}
      </div>
      <p className="mt-0.5 font-mono text-caption text-fg-muted">
        {action.action_id} · {action.kind} · from playbook {action.playbook_id}
      </p>

      <p className="mt-2 max-w-[80ch] text-body text-fg">{action.summary}</p>

      {Object.keys(action.params).length > 0 ? (
        <table className="mt-3 w-full border-collapse text-caption">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="py-1 pr-3 font-medium">Parameter</th>
              <th className="py-1 pr-3 font-medium">Value</th>
              <th className="py-1 font-medium">Bound from</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(action.params).map(([k, v]) => (
              <tr key={k} className="border-b border-border/50 last:border-0">
                <td className="py-1 pr-3 font-mono text-fg-muted">{k}</td>
                <td className="py-1 pr-3 font-mono text-fg">{v}</td>
                <td className="py-1 font-mono text-fg-muted">{action.bound_from[k] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!action.available ? (
        <ul className="mt-3 list-disc space-y-1 ps-5 text-caption text-fg-muted">
          {action.unmet.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      ) : (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-caption sm:grid-cols-2">
            <Pair k="Impact" v={action.impact} />
            <Pair k="Permissions" v={asText(action.permissions)} />
            <Pair k="Rollback" v={asText(action.rollback)} />
            <Pair k="Verification" v={action.verification.criterion} />
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run('dry', () => api.dryRunAction(runId, incidentId, action.action_id, version), (r) => setDryRun(r.result.would_issue))
              }
            >
              {busy === 'dry' ? 'Running…' : 'Dry run'}
            </Button>

            {confirming ? (
              <>
                <span className="text-caption text-high-risk">
                  {mode === 'live' ? 'This will be sent to the remediation endpoint.' : 'Record this action as approved?'}
                </span>
                <Button
                  size="sm"
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
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
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
                Approve and execute
              </Button>
            )}

            {executed || rolledBack ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run('verify', () => api.verifyAction(runId, incidentId, action.action_id, version), (r) => setVerification(r.verification))}
              >
                {busy === 'verify' ? 'Checking…' : 'Verify'}
              </Button>
            ) : null}

            {executed && action.reversible ? (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('rb', () => api.rollbackAction(runId, incidentId, action.action_id, version))}>
                {busy === 'rb' ? 'Rolling back…' : 'Roll back'}
              </Button>
            ) : null}

            {e ? (
              <span className="text-caption text-high-risk">
                HTTP {e.status ?? '—'}: {detail}
              </span>
            ) : null}
            {execFailure ? (
              <span className="text-caption text-high-risk" role="alert">
                Execution failed: {execFailure}
              </span>
            ) : null}
          </div>
        </>
      )}

      {verification ? (
        <Notice tone={VERIFICATION_TONE[verification.status] === 'ok' ? 'ok' : VERIFICATION_TONE[verification.status] === 'danger' ? 'danger' : 'warn'} className="mt-3">
          <strong>Verification {verification.status}</strong> — {verification.detail}
          <p className="mt-1 font-mono text-caption text-fg-muted">
            query {verification.query_id} · after #{verification.after_seq} · cutoff #{verification.cutoff_seq}
          </p>
        </Notice>
      ) : null}

      {dryRun ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-caption text-fg-muted hover:text-fg">Exact request this approval would issue</summary>
          <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-sunken px-3 py-2 font-mono text-mono whitespace-pre-wrap text-fg">
            <code>{JSON.stringify(dryRun, null, 2)}</code>
          </pre>
        </details>
      ) : null}
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
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-body font-medium text-fg">Response packet</strong>
        <span className="font-mono text-caption text-fg-muted">report.export_packet</span>
      </div>
      <p className="mt-2 max-w-[80ch] text-caption text-fg-muted">
        One Markdown handoff for whoever performs the remediation: the incident, every typed fact with its evidence
        references, what these logs cannot show, the applicable playbooks, and each bound action with its parameters
        and verification criterion. Rendered from committed rows only.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            void act('preview', async () => {
              const p = await api.getResponsePacket(runId, incidentId, version)
              setPreview(p.markdown)
            })
          }
        >
          {busy === 'preview' ? 'Rendering…' : 'Preview'}
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={api.responsePacketDownloadUrl(runId, incidentId, version)} download className="no-underline">
            Download .md
          </a>
        </Button>
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void act('store', async () => {
              setStored(await api.storeResponsePacket(runId, incidentId, version))
            })
          }
        >
          {busy === 'store' ? 'Sending…' : 'Store and send handoff'}
        </Button>
        {stored ? (
          <span className="text-caption text-normal">
            stored {shortId(stored.content_sha256, 12)} · {stored.notification_queued ? 'queued for delivery' : 'already queued'}
          </span>
        ) : null}
        {e ? (
          <span className="text-caption text-high-risk">
            HTTP {e.status ?? '—'}: {e.text}
          </span>
        ) : null}
      </div>
      {preview ? (
        <details open className="mt-3">
          <summary className="cursor-pointer text-caption text-fg-muted hover:text-fg">Rendered packet</summary>
          <pre className="mt-2 max-h-[26rem] overflow-auto rounded-md border border-border bg-sunken px-3 py-2 font-mono text-mono whitespace-pre-wrap text-fg">
            <code>{preview}</code>
          </pre>
        </details>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ small parts

const TAG_TONE: Record<Tone, string> = {
  ok: 'border-normal/30 bg-normal-wash text-normal',
  danger: 'border-high-risk/35 bg-high-risk-wash text-high-risk',
  warn: 'border-suspicious/35 bg-suspicious-wash text-suspicious',
  muted: 'border-border bg-chip text-fg-muted',
}

function Tag({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cn('rounded-sm border px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium', TAG_TONE[tone])}>{children}</span>
}

const NOTICE_TONE: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'border-normal/30 bg-normal-wash',
  warn: 'border-suspicious/35 bg-suspicious-wash',
  danger: 'border-high-risk/35 bg-high-risk-wash',
}

function Notice({ tone, children, className }: { tone: 'ok' | 'warn' | 'danger'; children: ReactNode; className?: string }) {
  return <div className={cn('rounded-md border px-3 py-2 text-caption text-fg', NOTICE_TONE[tone], className)}>{children}</div>
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-caption text-fg-muted">{children}</p>
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="text-fg">{v}</dd>
    </div>
  )
}

function asText(v: string | string[] | null | undefined): string {
  if (!v) return '—'
  return Array.isArray(v) ? v.join('; ') : v
}
