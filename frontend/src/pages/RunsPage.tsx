import { ArrowRight, Database, FlaskConical, Play, Plus, Upload } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, describeError, type Dataset, type DatasetDetail, type Model, type Run, type RunCreateBody } from '../api'
import { fmtBytes, fmtNum, fmtTime, isFaultRun, runStateLabel, shortId, speedLabel } from '../format'
import { useFetch, useInterval } from '../useFetch'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Run list — the console entry point.
 *
 * Answers one question: which run do I open. The create form used to sit beside the list at
 * equal weight, so the first thing a judge saw was a form; it is now behind a dialog. Dataset
 * import internals answer a different question ("did ingestion work?") and collapse to a
 * provenance strip.
 */
export function RunsPage() {
  const runs = useFetch<Run[]>(() => api.listRuns(), [])
  const datasets = useFetch<Dataset[]>(() => api.listDatasets(), [])
  const models = useFetch<Model[]>(() => api.listModels(), [])
  // Imports are asynchronous, so the dataset list and the model registry have to be polled too:
  // without this a freshly uploaded dataset stays at "importing" and stays out of the run dialog
  // until the operator reloads the page.
  useInterval(() => {
    void runs.reload()
    void datasets.reload()
    void models.reload()
  }, 5_000)

  const [startOpen, setStartOpen] = useState(false)

  const items = runs.data ?? []
  const [lead, ...rest] = pickLead(items)
  const readyDatasets = (datasets.data ?? []).filter((d) => d.import_state === 'ready')

  return (
    <div className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title text-fg">Runs</h1>
          <p className="mt-1.5 max-w-[68ch] text-body text-fg-muted">
            A run is one isolated detection pass over a dataset. Each replays log lines in causal order and evaluates
            them under its own cutoff, so runs never contaminate each other.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UploadDatasetDialog
            onUploaded={() => {
              void datasets.reload()
              void models.reload()
            }}
          />
          <NewRunDialog
            datasets={datasets.data ?? []}
            models={models.data ?? []}
            open={startOpen}
            onOpenChange={setStartOpen}
            onCreated={() => void runs.reload()}
          />
        </div>
      </header>

      {!runs.loading && items.length === 0 && !runs.error ? (
        <StartHere hasDataset={readyDatasets.length > 0} onStart={() => setStartOpen(true)} />
      ) : null}

      {runs.loading && !runs.data ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : runs.error && !runs.data ? (
        <ErrorState
          title={describeError(runs.error).status === 503 ? 'Database unavailable' : 'Could not load runs'}
          detail={describeError(runs.error).text}
          onRetry={() => void runs.reload()}
        />
      ) : items.length === 0 ? (
        null
      ) : (
        <div className="space-y-3">
          {lead ? <LeadRunCard run={lead} /> : null}
          {rest.length > 0 ? (
            <ul className="grid gap-2">
              {rest.map((r) => (
                <li key={r.run_id}>
                  <RunRow run={r} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <DatasetStrip datasets={datasets.data ?? []} loading={datasets.loading} />
    </div>
  )
}

/**
 * Most-recently-updated run leads, except that fault-injection runs never do.
 *
 * A fault run exists to demonstrate the validator rejecting a bad AI proposal; it is a
 * diagnostic artifact, and letting it take the lead card just because it was touched last
 * points a first-time viewer at the wrong run.
 */
function pickLead(runs: Run[]): Run[] {
  return [...runs].sort((a, b) => {
    const fa = isFaultRun(a.name) ? 1 : 0
    const fb = isFaultRun(b.name) ? 1 : 0
    if (fa !== fb) return fa - fb
    return Date.parse(b.updated_at) - Date.parse(a.updated_at)
  })
}

function LeadRunCard({ run }: { run: Run }) {
  const pct = run.admitted_seq > 0 ? Math.round((run.processed_seq / run.admitted_seq) * 100) : 0
  return (
    <article className="rounded-xl border border-border bg-surface px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-heading text-fg">{run.name || shortId(run.run_id, 14)}</h2>
        <StatePill run={run} />
        <span className="rounded-sm border border-border px-1.5 py-0.5 text-[0.6875rem] text-fg-muted uppercase">
          {run.mode === 'replay' ? 'historical replay' : 'live'}
        </span>
        {isFaultRun(run.name) ? (
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-late/50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-late uppercase"
            title="This run deliberately submits an invalid AI proposal to demonstrate the validator rejecting it. A run configuration, not a threat level."
          >
            <FlaskConical className="size-3" aria-hidden />
            fault injection
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="flex items-baseline gap-2">
            <span className="font-sans text-title tabular-nums text-fg">{fmtNum(run.processed_seq)}</span>
            <span className="text-caption text-fg-muted">events evaluated</span>
          </p>
          <p className="mt-1 font-mono text-mono text-fg-muted">
            cutoff #{fmtNum(run.processed_seq)} of {fmtNum(run.admitted_seq)} admitted
            {run.last_processed_time ? ` · through ${fmtTime(run.last_processed_time)}` : ''}
          </p>
        </div>
        <Button asChild>
          <Link to={`/app/runs/${encodeURIComponent(run.run_id)}`}>
            Open console <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Events evaluated as a share of events admitted"
        >
          <div
            className={cn('h-full rounded-full', run.state === 'running' || run.state === 'warming' ? 'bg-accent' : 'bg-fg-subtle')}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        {/* A full bar does not mean finished -- a paused run can be caught up on its backlog
            and still have most of the dataset ahead of it. Say which. */}
        <span className="min-w-0 font-mono text-mono break-words text-fg-muted sm:shrink-0 sm:whitespace-nowrap">
          {run.state === 'completed' ? 'all admitted events evaluated' : `${runStateLabel(run.state)} · caught up to ${fmtNum(run.admitted_seq)} admitted`}
        </span>
      </div>
    </article>
  )
}

function RunRow({ run }: { run: Run }) {
  return (
    <Link
      to={`/app/runs/${encodeURIComponent(run.run_id)}`}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 hover:border-border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    >
      <span className="text-body text-fg">{run.name || shortId(run.run_id, 14)}</span>
      <StatePill run={run} />
      {isFaultRun(run.name) ? (
        <span className="inline-flex items-center gap-1 rounded-sm border border-late/50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-late uppercase">
          <FlaskConical className="size-3" aria-hidden />
          fault injection
        </span>
      ) : null}
      <span className="font-mono text-mono text-fg-muted">
        {fmtNum(run.processed_seq)} / {fmtNum(run.admitted_seq)}
      </span>
      <span className="font-mono text-mono text-fg-muted">{speedLabel(run.speed)}</span>
      <span className="ms-auto flex items-center gap-1.5 text-caption text-fg-muted">
        open <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  )
}

function StatePill({ run }: { run: Run }) {
  const live = run.state === 'running' || run.state === 'warming'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[0.6875rem] font-medium uppercase',
        run.state === 'blocked' && 'state-hatch border-blocked/50 text-blocked',
        // warming/paused are transient: not finished, and not to be read as finished.
        (run.state === 'warming' || run.state === 'paused') && 'state-hatch border-pending/50 text-pending',
        run.state === 'completed' && 'border-border text-fg-muted',
        run.state === 'running' && 'border-accent/45 text-accent',
        run.state === 'created' && 'border-border text-fg-muted',
      )}
    >
      {live ? <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" /> : null}
      {runStateLabel(run.state)}
    </span>
  )
}

/**
 * Dataset provenance, compressed to one line per dataset.
 *
 * These numbers are the product's claim to have read real data, so they stay visible — but
 * they answer "did ingestion work?", not "which run do I open", so they sit at the bottom.
 */
function DatasetStrip({ datasets, loading }: { datasets: Dataset[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-12 w-full rounded-lg" />
  if (datasets.length === 0) {
    return (
      <section aria-labelledby="datasets" className="border-t border-border pt-5">
        <h2 id="datasets" className="mb-3 text-caption text-fg-muted">
          Source data
        </h2>
        <p className="text-body text-fg-muted">
          No datasets yet. Import an Apache access-log file above; imports run asynchronously and become selectable
          once validation completes.
        </p>
      </section>
    )
  }
  return (
    <section aria-labelledby="datasets" className="border-t border-border pt-5">
      <h2 id="datasets" className="mb-3 text-caption text-fg-muted">
        Source data
      </h2>
      <ul className="grid gap-2">
        {datasets.map((d) => (
          <DatasetRow key={d.dataset_id} d={d} />
        ))}
      </ul>
    </section>
  )
}

/**
 * One dataset.
 *
 * Compressed to a line, but not to the point of lying: an import that is still running and an
 * import that FAILED both report zero valid and zero rejected, so a strip that shows only the
 * counts renders a broken import identically to a healthy empty one. State, progress and the
 * error come first; the rejected lines stay one click away, because the upload dialog promises
 * they appear here.
 */
function DatasetRow({ d }: { d: Dataset }) {
  const [showRejects, setShowRejects] = useState(false)
  const detail = useFetch<DatasetDetail>(() => api.getDataset(d.dataset_id), [d.dataset_id, showRejects], showRejects)

  const ready = d.import_state === 'ready'
  const failed = d.import_state === 'failed' || !!d.error
  const pct =
    d.total_lines && d.progress_line !== null ? Math.min(100, Math.round((d.progress_line / d.total_lines) * 100)) : null

  return (
    <li className="rounded-lg border border-border bg-surface px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Database className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        <span className="font-mono text-mono text-fg">{d.original_name}</span>

        {ready ? null : (
          <span
            className={cn(
              'rounded-sm border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase',
              failed ? 'border-high-risk/35 bg-high-risk-wash text-high-risk' : 'border-pending/35 text-pending',
            )}
          >
            {d.import_state}
            {!failed && pct !== null ? ` ${pct}%` : ''}
          </span>
        )}

        <span className="font-mono text-mono text-fg-muted">
          {fmtNum(d.valid_count)} valid
          <span className={d.rejected_count ? 'text-late' : 'text-fg-muted'}> · {fmtNum(d.rejected_count)} rejected</span>
        </span>
        <span className="font-mono text-mono text-fg-muted">{fmtBytes(d.bytes)}</span>
        {d.first_event_time ? (
          <span className="font-mono text-mono text-fg-muted">
            {fmtTime(d.first_event_time)} → {fmtTime(d.last_event_time)}
          </span>
        ) : null}
        <span className="ms-auto font-mono text-mono text-fg-muted" title={d.content_sha256}>
          sha256 {shortId(d.content_sha256, 12)}
        </span>
      </div>

      {!ready && !failed && pct !== null ? (
        <p className="mt-1.5 font-mono text-mono text-fg-muted">
          validated {fmtNum(d.progress_line)} of {fmtNum(d.total_lines)} lines
        </p>
      ) : null}

      {d.error ? <p className="mt-1.5 max-w-[80ch] text-body text-high-risk">{d.error}</p> : null}

      {d.rejected_count ? (
        <>
          <button
            type="button"
            className="mt-1.5 font-mono text-mono text-fg-muted underline underline-offset-2 hover:text-fg"
            aria-expanded={showRejects}
            onClick={() => setShowRejects((v) => !v)}
          >
            {showRejects ? 'Hide' : 'Show'} rejected lines
          </button>
          {showRejects ? (
            detail.loading && !detail.data ? (
              <Skeleton className="mt-2 h-16 w-full rounded-md" />
            ) : detail.error ? (
              <p className="mt-2 font-mono text-mono text-late">
                Could not load rejected lines: {describeError(detail.error).text}
              </p>
            ) : (
              <ul className="mt-2 grid gap-1.5">
                {(detail.data?.rejects_sample ?? []).map((r) => (
                  <li key={r.line_number} className="rounded-md border border-border bg-surface-raised px-3 py-1.5">
                    <p className="font-mono text-mono text-fg-muted">
                      line {fmtNum(r.line_number)} · {r.reason}
                    </p>
                    <p className="mt-0.5 font-mono text-mono break-all text-fg">{r.raw_input}</p>
                  </li>
                ))}
                {(detail.data?.rejects_sample ?? []).length === 0 ? (
                  <li className="font-mono text-mono text-fg-muted">
                    The API kept no sample of the rejected lines for this dataset.
                  </li>
                ) : null}
              </ul>
            )
          ) : null}
        </>
      ) : null}
    </li>
  )
}

function NewRunDialog({
  datasets,
  open,
  onOpenChange: setOpen,
  onCreated,
}: {
  datasets: Dataset[]
  models: Model[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const ready = datasets.filter((d) => d.import_state === 'ready')
  const [form, setForm] = useState({ dataset_id: '', name: '', visible_start: '', speed: '', pause: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const body: RunCreateBody = {
        dataset_id: form.dataset_id || ready[0]?.dataset_id || '',
        mode: 'replay',
        name: form.name.trim() || 'replay',
        pause_at_visible_start: form.pause,
        ...(form.visible_start ? { visible_start: form.visible_start } : {}),
        ...(form.speed ? { speed: Number(form.speed) } : {}),
      }
      await api.createRun(body)
      setOpen(false)
      onCreated()
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-body text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New run
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New replay run</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-caption text-fg-muted">
            dataset
            <select className={field} value={form.dataset_id} onChange={(e) => setForm((f) => ({ ...f, dataset_id: e.target.value }))}>
              {ready.map((d) => (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {d.original_name} ({fmtNum(d.valid_count)} lines)
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-caption text-fg-muted">
            name
            <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="march-sequence" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-caption text-fg-muted">
              visible start (ISO 8601)
              <input
                className={cn(field, 'font-mono text-mono')}
                value={form.visible_start}
                onChange={(e) => setForm((f) => ({ ...f, visible_start: e.target.value }))}
                placeholder="2026-03-01T04:00:00Z"
              />
            </label>
            <label className="grid gap-1 text-caption text-fg-muted">
              speed (0 = fast-forward)
              <input
                className={cn(field, 'font-mono text-mono')}
                value={form.speed}
                onChange={(e) => setForm((f) => ({ ...f, speed: e.target.value }))}
                placeholder="config default"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-body text-fg-muted">
            <input
              type="checkbox"
              checked={form.pause}
              onChange={(e) => setForm((f) => ({ ...f, pause: e.target.checked }))}
              className="accent-[var(--color-accent)]"
            />
            pause when the visible window begins
          </label>
          {err ? <p className="text-caption text-high-risk">{describeError(err).text}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || ready.length === 0}>
              {busy ? 'Creating…' : 'Create run'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Dataset import, from main's console-upload work.
 *
 * Kept behind a dialog for the same reason the create form is: "import a file" is an
 * occasional operator action, not the question this page answers.
 */
function UploadDatasetDialog({ onUploaded }: { onUploaded: () => void }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<(Dataset & { job: 'queued' | 'existing' }) | null>(null)
  const [err, setErr] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      setResult(await api.uploadDataset(file))
      onUploaded()
    } catch (ex) {
      setErr(ex)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Upload /> Import logs
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import access logs</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="grid gap-3">
          <label className="grid gap-1 text-caption text-fg-muted">
            Apache access-log file
            <input
              type="file"
              accept=".log,.txt,text/plain"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setResult(null)
                setErr(null)
              }}
              className="w-full rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-body text-fg file:mr-3 file:rounded file:border-0 file:bg-chip file:px-2 file:py-1 file:font-mono file:text-caption file:text-fg file:uppercase focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            />
          </label>

          {file ? (
            <p className="font-mono text-mono text-fg-muted">
              <span className="text-fg">{file.name}</span> · {fmtBytes(file.size)}
            </p>
          ) : null}

          <p className="text-caption text-fg-subtle">
            Streams to the server; the configured limit is 200 MiB. Raw evidence is never sent to an AI provider.
          </p>

          {result ? (
            <p className="rounded-md border border-border bg-chip px-3 py-2 text-body text-fg-muted" role="status">
              {result.job === 'existing' ? 'This exact file was already imported.' : 'Upload queued for import.'} Dataset{' '}
              <span className="font-mono text-mono text-fg">{shortId(result.dataset_id, 18)}</span>. Validation progress and
              rejected-line samples appear in the source-data strip.
            </p>
          ) : null}
          {err ? (
            <p className="text-caption text-high-risk" role="alert">
              Upload failed (HTTP {describeError(err).status ?? '—'}): {describeError(err).text}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="submit" disabled={!file || busy}>
              {busy ? 'Uploading…' : 'Upload and import'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}


/**
 * The first thing a new visitor sees when there are no runs yet: what to do, in order, with the
 * one button that does it.
 */
function StartHere({ hasDataset, onStart }: { hasDataset: boolean; onStart: () => void }) {
  return (
    <section className="rounded-xl border border-accent/30 bg-accent-wash px-6 py-6 sm:px-8">
      <h2 className="text-heading text-fg">Start your first run</h2>
      <p className="mt-1.5 max-w-[60ch] text-body text-fg-muted">
        A run replays a log file through the detector and turns what it finds into incidents you can open. It takes
        three steps.
      </p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        <Step n={1} done={hasDataset} title="Import a log file" body={hasDataset ? 'Done. A dataset is ready to replay.' : 'Use Import logs above. The sample dataset may already be here.'} />
        <Step n={2} title="Start a run" body="Pick the dataset, name the run, and start the replay." />
        <Step n={3} title="Open the findings" body="Incidents appear as the replay reaches them. Open one to follow the proof." />
      </ol>
      <div className="mt-5">
        <Button size="lg" onClick={onStart} disabled={!hasDataset}>
          <Play /> {hasDataset ? 'Start a run' : 'Import a log file first'}
        </Button>
      </div>
    </section>
  )
}

function Step({ n, title, body, done }: { n: number; title: string; body: string; done?: boolean }) {
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[0.75rem] font-medium', done ? 'bg-normal text-white' : 'bg-accent text-accent-fg')}>
        {done ? '✓' : n}
      </span>
      <span>
        <span className="block text-body font-medium text-fg">{title}</span>
        <span className="block text-caption text-fg-muted">{body}</span>
      </span>
    </li>
  )
}
