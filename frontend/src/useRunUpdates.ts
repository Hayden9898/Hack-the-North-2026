/**
 * Durable SSE subscription to GET /api/v1/runs/:id/updates.
 *
 * Resume semantics: every message carries `id` = run-scoped update_seq. We remember the last id.
 * - Browser auto-reconnect sends Last-Event-ID for us.
 * - When we recreate the EventSource ourselves (after a hard close or leaving polling mode) we pass
 *   `?after=<lastId>` so the server resumes from the same durable cursor.
 * - `resync_required` means the cursor is too far behind: the caller refetches a snapshot
 *   (run + incidents + events) and we adopt the server's latest seq.
 * - After repeated errors we fall back to polling (the caller polls GET /runs/:id every 2 s) and
 *   keep trying to re-establish the stream in the background.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from './api'

export type UpdateType =
  | 'progress'
  | 'incident'
  | 'run_state'
  | 'delivery'
  | 'explanation'
  | 'feedback'
  | 'heartbeat'
  | 'resync_required'

export const UPDATE_TYPES: UpdateType[] = [
  'progress',
  'incident',
  'run_state',
  'delivery',
  'explanation',
  'feedback',
  'heartbeat',
  'resync_required',
]

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'disconnected'

export interface UpdatesState {
  status: ConnectionStatus
  attempts: number
  lastId: number | null
  lastMessageAt: number | null
  /** true while in polling fallback: the page should poll GET /runs/:id every 2 s */
  polling: boolean
}

export interface UseRunUpdatesOptions {
  enabled?: boolean
  /** Called for every named event. `data` is the parsed JSON payload. */
  onEvent: (type: UpdateType, data: Record<string, unknown>, id: number | null) => void
  /** Called when the server says our cursor expired; caller must refetch a snapshot. */
  onResync: (latestSeq: number) => void
  /** Consecutive errors before switching to polling fallback. */
  maxErrorsBeforePolling?: number
}

const RETRY_STREAM_WHILE_POLLING_MS = 15_000
const MANUAL_RECONNECT_BASE_MS = 1_000

export function useRunUpdates(runId: string | undefined, opts: UseRunUpdatesOptions): UpdatesState {
  const { enabled = true, maxErrorsBeforePolling = 4 } = opts
  const [state, setState] = useState<UpdatesState>({
    status: 'connecting',
    attempts: 0,
    lastId: null,
    lastMessageAt: null,
    polling: false,
  })

  // Handlers live in refs so the EventSource is not torn down when the caller re-renders.
  const onEventRef = useRef(opts.onEvent)
  const onResyncRef = useRef(opts.onResync)
  useEffect(() => {
    onEventRef.current = opts.onEvent
    onResyncRef.current = opts.onResync
  })

  const lastIdRef = useRef<number | null>(null)
  const errorsRef = useRef(0)
  const runIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!runId || !enabled) return
    if (runIdRef.current !== runId) {
      // New run: forget the previous run's cursor.
      runIdRef.current = runId
      lastIdRef.current = null
      errorsRef.current = 0
    }
    let es: EventSource | null = null
    let closed = false
    let everOpened = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const patch = (p: Partial<UpdatesState>) => setState((s) => ({ ...s, ...p }))

    const open = () => {
      if (closed) return
      if (es) {
        es.close()
        es = null
      }
      // Manual (re)creation: resume via ?after= from the last durable id we saw.
      es = new EventSource(api.updatesUrl(runId, lastIdRef.current))
      patch({ status: everOpened ? 'reconnecting' : 'connecting' })

      es.onopen = () => {
        everOpened = true
        errorsRef.current = 0
        patch({ status: 'live', attempts: 0, polling: false })
      }

      const handle = (type: UpdateType) => (raw: Event) => {
        const ev = raw as MessageEvent<string>
        let id: number | null = null
        if (ev.lastEventId) {
          const n = Number(ev.lastEventId)
          if (Number.isFinite(n)) id = n
        }
        if (id !== null) lastIdRef.current = id
        let data: Record<string, unknown> = {}
        try {
          data = ev.data ? (JSON.parse(ev.data) as Record<string, unknown>) : {}
        } catch {
          data = {}
        }
        patch({ lastId: lastIdRef.current, lastMessageAt: Date.now(), status: 'live' })
        if (type === 'resync_required') {
          const latest = typeof data.latest_seq === 'number' ? data.latest_seq : (lastIdRef.current ?? 0)
          lastIdRef.current = latest
          onResyncRef.current(latest)
        }
        onEventRef.current(type, data, id)
      }
      for (const t of UPDATE_TYPES) es.addEventListener(t, handle(t))

      es.onerror = () => {
        if (closed || !es) return
        errorsRef.current += 1
        const attempts = errorsRef.current
        if (attempts >= maxErrorsBeforePolling) {
          // Give up on the stream for now; poll, and retry the stream periodically.
          es.close()
          es = null
          patch({ status: 'polling', attempts, polling: true })
          timer = setTimeout(open, RETRY_STREAM_WHILE_POLLING_MS)
          return
        }
        if (es.readyState === EventSource.CLOSED) {
          // Browser will not retry on its own (e.g. HTTP error); recreate with ?after= and backoff.
          es = null
          patch({ status: 'reconnecting', attempts })
          timer = setTimeout(open, MANUAL_RECONNECT_BASE_MS * attempts)
        } else {
          // readyState CONNECTING: the browser is auto-reconnecting and will send Last-Event-ID.
          patch({ status: 'reconnecting', attempts })
        }
      }
    }

    if (lastIdRef.current === null) {
      // First connection: start from the durable snapshot cursor instead of replaying the run's whole
      // update history. The REST fetches the page makes at mount already reflect everything up to it.
      api
        .updatesSnapshot(runId)
        .then((snap) => {
          if (closed) return
          lastIdRef.current = snap.latest_seq
          setState((s) => ({ ...s, lastId: snap.latest_seq }))
          open()
        })
        .catch(() => open())
    } else {
      open()
    }
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      if (es) es.close()
    }
  }, [runId, enabled, maxErrorsBeforePolling])

  if (!runId || !enabled) return { ...state, status: 'disconnected', polling: false }
  return state
}
