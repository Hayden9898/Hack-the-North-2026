import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, describeError, type EventRow, type EventsPage, type EventsQuery, type Phase, type ThreatClass } from '../../api'
import { fmtNum, fmtPercentile, fmtTime } from '../../format'
import { useFetch } from '../../useFetch'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusChip, resolveStatus } from '@/components/ui/status-chip'
import { useVirtualRows } from './useVirtualRows'

const WINDOW_ROWS = 300
const PAGE = 100
const ROW_H = 30

/**
 * The evidence substrate: every processed event under the run's cutoff.
 *
 * Secondary to the findings by design — it is what the findings are made of, not the answer.
 * Rows are virtualised: the window holds 300 and the dataset holds 180,800, and neither should
 * ever become that many DOM nodes.
 */
export function EventFeed({ runId, tick, cutoff }: { runId: string; tick: number; cutoff: number }) {
  const nav = useNavigate()
  const [filters, setFilters] = useState<{ threat_class: ThreatClass | ''; phase: Phase | ''; account: string }>({
    threat_class: '',
    phase: '',
    account: '',
  })
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

  const [older, setOlder] = useState<{ key: string; pages: EventsPage[] }>({ key: filterKey, pages: [] })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<unknown>(null)
  const olderPages = useMemo(() => (older.key === filterKey ? older.pages : []), [older, filterKey])

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
    return follow ? out.slice(0, WINDOW_ROWS) : out.slice(out.length - WINDOW_ROWS)
  }, [newest.data, olderPages, follow])

  const virt = useVirtualRows(rows.length, ROW_H)
  const lastPage = olderPages.length ? olderPages[olderPages.length - 1] : newest.data
  const hasOlder = !!lastPage?.has_more

  async function loadOlder() {
    if (rows.length === 0) return
    setLoadingOlder(true)
    setFollow(false)
    try {
      const page = await api.listEvents(runId, baseQuery({ before_seq: rows[rows.length - 1].run_seq }))
      setOlder((o) => ({ key: filterKey, pages: [...(o.key === filterKey ? o.pages : []), page] }))
      setOlderError(null)
    } catch (e) {
      setOlderError(e)
    } finally {
      setLoadingOlder(false)
    }
  }

  const error = newest.error ?? olderError
  const errText = error ? describeError(error) : null
  const active = !!(filters.threat_class || filters.phase || filters.account)
  const select =
    'rounded-md border border-border bg-surface-raised px-2 py-1 text-caption text-fg normal-case tracking-normal focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'

  return (
    <section aria-labelledby="feed" className="rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="feed" className="text-heading normal-case tracking-normal text-fg">
            Event feed
          </h2>
          <p className="text-caption text-fg-muted normal-case tracking-normal">
            every event evaluated under cutoff #{fmtNum(newest.data?.cutoff_seq ?? cutoff)} · showing the newest{' '}
            {fmtNum(rows.length)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by verdict"
            className={select}
            value={filters.threat_class}
            onChange={(e) => setFilters((f) => ({ ...f, threat_class: e.target.value as ThreatClass | '' }))}
          >
            <option value="">all verdicts</option>
            <option value="high_risk">high risk</option>
            <option value="suspicious">suspicious</option>
            <option value="normal">normal</option>
          </select>
          <select
            aria-label="Filter by phase"
            className={select}
            value={filters.phase}
            onChange={(e) => setFilters((f) => ({ ...f, phase: e.target.value as Phase | '' }))}
          >
            <option value="">all phases</option>
            <option value="visible">visible window</option>
            <option value="warmup">historical warmup</option>
          </select>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              setFilters((f) => ({ ...f, account: accountDraft.trim() }))
            }}
          >
            <input
              value={accountDraft}
              onChange={(e) => setAccountDraft(e.target.value)}
              placeholder="account"
              aria-label="Filter by account"
              className="w-24 rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-mono text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
          </form>
          {follow ? (
            <span className="flex items-center gap-1.5 text-caption text-normal normal-case tracking-normal">
              <span aria-hidden className="inline-block size-1.5 rounded-full bg-normal" />
              following
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOlder({ key: filterKey, pages: [] })
                setFollow(true)
                void newest.reload()
              }}
            >
              Resume following
            </Button>
          )}
        </div>
      </header>

      {errText ? (
        <p className="border-b border-border bg-surface-raised px-4 py-2 text-caption text-late normal-case tracking-normal">
          {errText.status === 503 ? 'Database unavailable' : 'Refresh failed'} — showing the last rows loaded.
        </p>
      ) : null}

      {newest.loading && !newest.data ? (
        <div className="space-y-1 p-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : newest.error && !newest.data ? (
        <div className="p-4">
          <ErrorState title="Could not load events" detail={describeError(newest.error).text} onRetry={() => void newest.reload()} />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-body text-fg-muted">
          No events under the current cutoff{active ? ' match these filters' : ''}.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[4.5rem_10.5rem_1fr_3rem_7.5rem_5rem] gap-2 border-b border-border px-4 py-1.5 text-caption text-fg-muted uppercase">
            <span className="text-right">seq</span>
            <span>time (UTC)</span>
            <span>account@ip · request</span>
            <span className="text-right">status</span>
            <span>verdict</span>
            <span className="text-right">rarity</span>
          </div>

          <div
            ref={virt.ref as (el: HTMLDivElement | null) => void}
            onScroll={virt.onScroll}
            className="max-h-[27rem] overflow-y-auto"
          >
            <div style={{ height: virt.window.padTop }} />
            {rows.slice(virt.window.start, virt.window.end).map((ev) => (
              <FeedRow key={ev.run_seq} ev={ev} onOpen={() => nav(`/app/runs/${encodeURIComponent(runId)}/events/${ev.run_seq}`)} />
            ))}
            <div style={{ height: virt.window.padBottom }} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <span className="font-mono text-mono text-fg-subtle">
              #{rows[rows.length - 1]?.run_seq} → #{rows[0]?.run_seq}
            </span>
            <Button variant="outline" size="sm" disabled={!hasOlder || loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? 'Loading…' : hasOlder ? 'Load older' : 'No older events'}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function FeedRow({ ev, onOpen }: { ev: EventRow; onOpen: () => void }) {
  const status = resolveStatus(ev.threat_class, ev.processing_status)
  const flagged = 'verdict' in status && status.verdict !== 'normal'
  const warmup = ev.phase === 'warmup'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      style={{ height: ROW_H }}
      className={cn(
        'grid cursor-pointer grid-cols-[4.5rem_10.5rem_1fr_3rem_7.5rem_5rem] items-center gap-2 border-b border-border/40 px-4 font-mono text-mono hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
        flagged && 'bg-surface-raised',
        // Warmup is history being replayed to build state, not a live model-evaluated decision.
        warmup && 'opacity-55',
      )}
    >
      <span className="text-right tabular-nums text-accent">{ev.run_seq}</span>
      <span className="tabular-nums text-fg-muted">{fmtTime(ev.event_time)}</span>
      <span className="min-w-0 truncate">
        <span className="text-fg-muted">
          {ev.username}@{ev.ip_raw}
        </span>{' '}
        <span className="text-fg">
          {ev.method} {ev.path}
        </span>
        {warmup ? <span className="ms-2 text-[0.6875rem] text-fg-subtle uppercase">warmup</span> : null}
      </span>
      <span className="text-right tabular-nums text-fg-muted">{ev.status}</span>
      <span className="min-w-0">
        <StatusChip {...status} size="sm" showIcon={flagged} />
      </span>
      <span className="text-right tabular-nums text-fg-subtle">
        {ev.anomaly_percentile !== null ? fmtPercentile(ev.anomaly_percentile) : '—'}
      </span>
    </div>
  )
}
