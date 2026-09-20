import { Pause, Play, Rewind } from 'lucide-react'
import { useState } from 'react'
import { api, describeError, type Run } from '../../api'
import { fmtNum, speedLabel } from '../../format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'

/** Replay transport. Compact by design — it is a control, not the subject of the screen. */
export function RunTransport({ run, onChanged }: { run: Run; onChanged: (r: Run) => void }) {
  const [speedDraft, setSpeedDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const speed = speedDraft ?? String(run.speed ?? '')

  async function act(action: 'start' | 'pause' | 'resume' | 'speed') {
    setBusy(action)
    setErr(null)
    try {
      const updated = await api.replay(run.run_id, action === 'speed' ? { action, speed: Number(speed) } : { action })
      if (action === 'speed') setSpeedDraft(null)
      onChanged(updated)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }

  if (run.mode !== 'replay') {
    return <p className="text-caption text-fg-muted normal-case tracking-normal">Live ingestion — replay controls do not apply.</p>
  }

  const s = run.state
  const terminal = s === 'completed' || s === 'blocked'
  const e = err ? describeError(err) : null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {s === 'created' ? (
        <Button size="sm" disabled={busy !== null} onClick={() => void act('start')}>
          <Play /> Start
        </Button>
      ) : s === 'paused' ? (
        <Button size="sm" disabled={busy !== null} onClick={() => void act('resume')}>
          <Play /> Resume
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={terminal || busy !== null} onClick={() => void act('pause')}>
          <Pause /> Pause
        </Button>
      )}

      <label className="flex items-center gap-1.5 text-caption text-fg-muted normal-case tracking-normal">
        <Rewind className="size-3.5" aria-hidden />
        <span className="sr-only">replay speed multiplier, 0 for fast-forward</span>
        <input
          type="number"
          min={0}
          step="any"
          value={speed}
          disabled={terminal}
          onChange={(ev) => setSpeedDraft(ev.target.value)}
          className="w-20 rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-mono text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={terminal || busy !== null || speed === ''}
          onClick={() => void act('speed')}
        >
          Apply
        </Button>
        <span className="text-fg-muted">now {speedLabel(run.speed)}</span>
      </label>

      {e ? <span className="text-caption text-high-risk normal-case tracking-normal">{e.text}</span> : null}
    </div>
  )
}

/** Cursor progress: how much of the dataset this run has actually evaluated. */
export function RunProgress({ run }: { run: Run }) {
  const backlog = Math.max(0, run.admitted_seq - run.processed_seq)
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <span className="flex items-baseline gap-2">
        <span className="font-sans text-heading tabular-nums text-fg">{fmtNum(run.processed_seq)}</span>
        <span className="text-caption text-fg-muted uppercase">events evaluated</span>
      </span>
      {backlog > 0 ? (
        <span className="flex items-baseline gap-1.5 text-caption normal-case tracking-normal">
          <span className="font-mono tabular-nums text-late">{fmtNum(backlog)}</span>
          <span className="text-fg-muted">admitted, not yet evaluated</span>
        </span>
      ) : null}
      {run.late_count > 0 ? (
        <span className="flex items-baseline gap-1.5 text-caption normal-case tracking-normal">
          <span className="font-mono tabular-nums text-late">{fmtNum(run.late_count)}</span>
          <span className="text-fg-muted">late — persisted, excluded from live inference</span>
        </span>
      ) : null}
    </div>
  )
}

/** SSE transport health. A disconnected stream is a processing state, never a verdict. */
export function ConnectionDot({
  status,
  attempts,
  lastId,
  resyncs,
  terminal = false,
}: {
  status: string
  attempts: number
  lastId: number | null
  resyncs: number
  /** run has finished or is blocked, so no further updates are expected */
  terminal?: boolean
}) {
  // On a finished run the stream has nothing left to deliver, so a permanent "connecting"
  // is misleading -- it reads as a broken transport rather than a run that is simply done.
  const label = terminal
    ? status === 'live'
      ? 'stream open · run finished, no further updates'
      : 'run finished · no further updates expected'
    : status === 'live'
      ? 'live'
      : status === 'connecting'
        ? 'connecting'
        : status === 'reconnecting'
          ? `reconnecting · attempt ${attempts}`
          : status === 'polling'
            ? `stream unavailable · polling every 2 s`
            : 'disconnected'
  const tone = terminal
    ? 'text-fg-muted'
    : status === 'live'
      ? 'text-normal'
      : status === 'connecting'
        ? 'text-fg-muted'
        : 'text-late'

  return (
    <span
      className={cn('flex items-center gap-1.5 text-caption normal-case tracking-normal', tone)}
      title={`SSE /updates · last seq ${lastId ?? '—'} · resyncs ${resyncs}`}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-1.5 rounded-full',
          terminal ? 'bg-fg-subtle' : status === 'live' ? 'bg-normal' : status === 'connecting' ? 'bg-fg-subtle' : 'bg-late',
        )}
      />
      {label}
    </span>
  )
}
