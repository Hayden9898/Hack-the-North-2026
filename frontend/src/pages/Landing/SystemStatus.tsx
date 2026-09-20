import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  Database,
  type LucideIcon,
  RefreshCw,
  X,
} from 'lucide-react'
import * as motionReact from 'motion/react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, describeError, type Health } from '@/api'
import {
  Legend,
  LegendItem,
  LegendLabel,
  LegendMarker,
  LegendValue,
  Ring,
  RingCenter,
  RingChart,
} from '@/components/charts'
import { LiquidGlassCard } from '@/components/kokonutui/liquid-glass-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { degradedModeLabel } from '@/format'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'
import { useFetch } from '@/useFetch'
import { DATASET, EXHIBIT, INCIDENTS, RULES, RUN, UNKNOWNS } from './data'
import { Pressable } from './interactive'
import { Section, Stamp } from './parts'

const { AnimatePresence, motion } = motionReact

/**
 * Live, not hardcoded. This page makes a point of only showing provable things, so the one
 * claim about the system's *current* state has to come from the system.
 *
 * Rebuilt as a board rather than a paragraph: a readiness dial (bklit RingChart — one ring per
 * readiness gate in the live payload), three labelled cells for api/db/models, and a pop-out
 * that opens the raw sub-fields on demand. Everything rendered here is a field of the
 * /health/ready response or a constant from ./data.ts; nothing is asserted.
 *
 * Degraded modes are rendered as hatched neutral tags: they are neither a verdict nor a
 * record processing state, and must not borrow the colour language of either.
 */

type CellId = 'api' | 'db' | 'models'

type DetailRow = { label: string; value: string }

type Cell = {
  id: CellId
  icon: LucideIcon
  caption: string
  /** The path this cell reads in the response, so a reader can check it against the JSON. */
  path: string
  value: string
  detail: DetailRow[]
}

/** The three headline cells, plus the sub-fields each one hides behind its pop-out. */
function buildCells(h: Health): Cell[] {
  return [
    {
      id: 'api',
      icon: Activity,
      caption: 'API',
      path: 'status',
      value: h.status,
      detail: [
        { label: 'status', value: h.status },
        { label: 'sentry', value: h.sentry_active ? 'active' : 'inactive' },
        { label: 'integrations.sentry', value: h.integrations.sentry },
        { label: 'integrations.llm', value: h.integrations.llm },
        { label: 'integrations.slack', value: h.integrations.slack },
      ],
    },
    {
      id: 'db',
      icon: Database,
      caption: 'Database',
      path: 'database.detail',
      value: h.database.detail ?? '—',
      detail: [
        { label: 'database.ok', value: h.database.ok ? 'true' : 'false' },
        { label: 'database.detail', value: h.database.detail ?? '—' },
        { label: 'migrations.ok', value: h.migrations.ok ? 'true' : 'false' },
        { label: 'migrations.current', value: h.migrations.current ?? '—' },
        { label: 'migrations.head', value: h.migrations.head ?? '—' },
        ...(h.migrations.error ? [{ label: 'migrations.error', value: h.migrations.error }] : []),
        { label: 'config.ok', value: h.config.ok ? 'true' : 'false' },
        { label: 'config.hash', value: h.config.hash ?? '—' },
      ],
    },
    {
      id: 'models',
      icon: Boxes,
      caption: 'Model artifacts',
      path: 'models.artifacts',
      value: formatArtifacts(h.models.artifacts),
      detail: [
        { label: 'artifacts', value: formatArtifacts(h.models.artifacts) },
        { label: 'entries', value: String(h.models.artifacts.length) },
        { label: 'run.model_health', value: RUN.modelHealth },
      ],
    },
  ]
}

/** The gates /health/ready itself is reporting on. Every value is a live boolean. */
function readinessGates(h: Health) {
  return [
    { label: 'API ready', ok: h.status === 'ready' },
    { label: 'Database', ok: h.database.ok },
    { label: 'Migrations', ok: h.migrations.ok },
    { label: 'Config', ok: h.config.ok },
  ]
}

type LiveTone = 'ready' | 'error' | 'pending'

/** Complete literal class strings: Tailwind cannot see a class name built by interpolation. */
const LIVE_DOT: Record<LiveTone, string> = {
  ready: 'bg-normal',
  error: 'bg-high-risk',
  pending: 'bg-pending',
}

export function SystemStatus() {
  const health = useFetch<Health>(() => api.health(), [])

  // One derivation for the pill, so the dot colour and the word can never disagree.
  const live: { tone: LiveTone; word: string } =
    health.loading && !health.data
      ? { tone: 'pending', word: 'checking' }
      : health.error
        ? { tone: 'error', word: 'unreachable' }
        : health.data
          ? { tone: health.data.status === 'ready' ? 'ready' : 'pending', word: health.data.status }
          : { tone: 'pending', word: 'idle' }

  return (
    <Section className="py-20 sm:py-28">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <Stamp className="w-auto min-w-40 flex-1">System state</Stamp>
        <div className="flex shrink-0 items-center gap-2">
          <LivePill tone={live.tone} word={live.word} />
          <Button
            variant="outline"
            size="xs"
            onClick={() => void health.reload()}
            disabled={health.loading || health.refreshing}
            aria-label="Re-check system state"
          >
            <RefreshCw
              aria-hidden
              className={cn('size-3', health.refreshing && 'animate-spin motion-reduce:animate-none')}
            />
            Re-check
          </Button>
        </div>
      </div>

      <p className="mt-5 max-w-[68ch] text-body text-fg-muted">
        Read live from <span className="font-mono text-fg">/health/ready</span> when this page
        loaded. Degraded modes are declared. The console tells you when it is running with
        something switched off.
      </p>

      {/*
        The glass reads only if there is something behind it to refract, so the board sits on
        a tinted wash and the card itself stays translucent.
      */}
      <div className="relative mt-8">
        <AmbientWash className="rounded-xl" />
        <LiquidGlassCard className="relative rounded-xl border-border/80 bg-surface/55 p-0 shadow-lg backdrop-blur-xl hover:shadow-lg">
          {health.loading && !health.data ? (
            <LoadingBoard />
          ) : health.error ? (
            <p className="p-5 font-mono text-mono text-blocked sm:p-6">
              health check unreachable — {describeError(health.error).text || 'no response'}. Nothing
              on this page depends on it; the figures above come from the recorded dataset.
            </p>
          ) : health.data ? (
            <ReadyBoard h={health.data} />
          ) : null}
        </LiquidGlassCard>
      </div>
    </Section>
  )
}

/**
 * The live pill. The dot pulses while the page believes the reading is current; the pulse is a
 * plain CSS animation so the global prefers-reduced-motion rule in styles/base.css stops it,
 * and it is never rendered at all when the user has asked for reduced motion.
 */
function LivePill({ tone, word }: { tone: LiveTone; word: string }) {
  const reduced = useReducedMotion()
  return (
    <span
      role="status"
      aria-label={`System state: ${word}`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 py-1 pr-3 pl-2.5 shadow-sm backdrop-blur-sm"
    >
      <span className="relative flex size-2 items-center justify-center">
        {reduced ? null : (
          <span
            aria-hidden
            className={cn(
              'absolute inline-flex size-2 animate-ping rounded-full opacity-75 motion-reduce:animate-none',
              LIVE_DOT[tone],
            )}
          />
        )}
        <span aria-hidden className={cn('relative inline-flex size-2 rounded-full', LIVE_DOT[tone])} />
      </span>
      <span className="font-mono text-[0.6875rem] text-fg uppercase tracking-[0.08em]">{word}</span>
    </span>
  )
}

function LoadingBoard() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr]">
      <div className="flex items-center justify-center border-border/70 border-b p-5 sm:p-6 lg:border-r lg:border-b-0">
        <Skeleton className="size-40 rounded-full" />
      </div>
      <div className="p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {['api', 'db', 'models'].map((k) => (
            <div key={k} className="rounded-lg border border-border bg-surface/70 p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-5 w-full" />
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>
      </div>
    </div>
  )
}

function ReadyBoard({ h }: { h: Health }) {
  const reduced = Boolean(useReducedMotion())
  const [open, setOpen] = useState<CellId | null>(null)
  const panelId = useId()
  const cells = buildCells(h)
  const active = cells.find((c) => c.id === open) ?? null
  const triggerId = (id: CellId) => `${panelId}-${id}`

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr]">
      <div className="border-border/70 border-b p-5 sm:p-6 lg:border-r lg:border-b-0">
        <ReadinessDial h={h} reduced={reduced} />
      </div>

      <div className="min-w-0 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {cells.map((cell) => (
            <CellButton
              key={cell.id}
              id={triggerId(cell.id)}
              cell={cell}
              open={open === cell.id}
              panelId={panelId}
              onToggle={() => setOpen(open === cell.id ? null : cell.id)}
            />
          ))}
        </div>

        {/* Detail on demand: one pop-out at a time, never everything at once. */}
        <AnimatePresence initial={false} mode="wait">
          {active ? (
            <DetailPanel
              key={active.id}
              id={panelId}
              cell={active}
              reduced={reduced}
              onClose={() => {
                // Closing must not drop focus on the floor: hand it back to the cell that
                // opened the panel, which is still mounted.
                setOpen(null)
                document.getElementById(triggerId(active.id))?.focus()
              }}
            />
          ) : null}
        </AnimatePresence>

        {h.degraded_modes.length > 0 ? (
          <div className="mt-5">
            <p className="font-mono text-[0.6875rem] text-fg-subtle uppercase tracking-[0.08em]">
              Degraded modes · {h.degraded_modes.length} · not a verdict
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {h.degraded_modes.map((m) => (
                <li
                  key={m}
                  className="state-hatch rounded-sm border border-pending/45 px-2 py-1 font-mono text-[0.6875rem] text-pending uppercase"
                >
                  {degradedModeLabel(m)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
          Derived from the live response, never asserted. The machine's model artifacts
          can change underneath this page; the demo run's own model_health cannot, because
          it is a recorded property of a run that already finished.
        */}
        <p className="mt-5 max-w-[68ch] border-border/70 border-t pt-5 text-body text-fg-muted">
          {h.models.artifacts.length === 0 ? (
            <>
              No model artifacts are present on this machine, so scoring is{' '}
              <span className="font-mono text-fg">rules_only</span>.
            </>
          ) : (
            <>
              Model artifacts are present now, but the run shown above was replayed before they
              existed and is recorded as <span className="font-mono text-fg">{RUN.modelHealth}</span>.
            </>
          )}{' '}
          Every verdict on this page therefore came from the deterministic rules. The Isolation
          Forest would add a second opinion; it did not contribute to these three incidents and
          nothing here pretends otherwise.
        </p>
      </div>
    </div>
  )
}

/**
 * Readiness dial — one concentric ring per gate in the live payload, drawn with the bklit
 * RingChart. A full ring is a gate that reported ok; an empty track is one that did not.
 *
 * The chart is aria-hidden: every value it draws is also written out in the caption below it
 * and in the db pop-out, so nothing is only available to a mouse.
 */
function ReadinessDial({ h, reduced }: { h: Health; reduced: boolean }) {
  // One hover index, two components: hovering a legend row lights the matching ring and
  // retitles the ring centre, and vice versa. Both sides are the chart kit's own controlled API.
  const [hovered, setHovered] = useState<number | null>(null)
  const gates = readinessGates(h)
  const passing = gates.filter((g) => g.ok).length

  // Shape is shared by RingData and LegendItemData, so one array drives both.
  const items = gates.map((g) => ({
    label: g.label,
    value: g.ok ? 1 : 0,
    maxValue: 1,
    color: g.ok ? 'var(--color-normal)' : 'var(--color-high-risk)',
  }))

  return (
    <figure className="flex flex-col items-center">
      {/* aria-hidden: every value drawn here is also written out in the legend below. */}
      <div aria-hidden className="flex justify-center">
        <RingChart
          data={items}
          size={192}
          strokeWidth={9}
          ringGap={5}
          baseInnerRadius={54}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
        >
          {items.map((r, i) => (
            <Ring index={i} key={r.label} animate={!reduced} />
          ))}
          <RingCenter defaultLabel={`of ${gates.length} gates`}>
            {({ data }) => (
              <div className="text-center">
                <p className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]">
                  {data.label}
                </p>
                <p
                  className={cn(
                    'font-mono text-mono uppercase',
                    data.value ? 'text-normal' : 'text-high-risk',
                  )}
                >
                  {data.value ? 'ok' : 'down'}
                </p>
              </div>
            )}
          </RingCenter>
        </RingChart>
      </div>

      <figcaption className="mt-2 font-mono text-[0.6875rem] text-fg-subtle uppercase tracking-[0.08em]">
        Readiness · {passing} of {gates.length} gates
      </figcaption>

      <Legend
        items={items}
        hoveredIndex={hovered}
        onHoverChange={setHovered}
        className="mt-3 w-full gap-0.5"
      >
        <LegendItem className="flex items-center gap-2 rounded-sm px-1.5 py-1 data-[hovered]:bg-hover">
          <LegendMarker className="size-2" />
          <LegendLabel className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]" />
          <LegendValue
            className="ml-auto font-mono text-[0.625rem] text-fg-muted uppercase tabular-nums"
            formatValue={(v) => (v ? 'ok' : 'down')}
          />
        </LegendItem>
      </Legend>
    </figure>
  )
}

function CellButton({
  id,
  cell,
  open,
  panelId,
  onToggle,
}: {
  id: string
  cell: Cell
  open: boolean
  panelId: string
  onToggle: () => void
}) {
  const Icon = cell.icon
  return (
    <button
      type="button"
      id={id}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      className={cn(
        'rounded-lg border bg-surface/70 p-3 text-left shadow-sm backdrop-blur-sm',
        'transition-[border-color,box-shadow,background-color] duration-150 ease-out-quint',
        'hover:border-border-strong hover:bg-surface hover:shadow-md',
        open ? 'border-accent/45 bg-surface shadow-md' : 'border-border',
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden className="size-3 shrink-0 text-fg-subtle" />
        <span className="font-mono text-[0.6875rem] text-fg-subtle uppercase tracking-[0.08em]">
          {cell.caption}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'ml-auto size-3 shrink-0 text-fg-subtle transition-transform duration-150 ease-out-quint',
            open && 'rotate-180',
          )}
        />
      </span>
      <span className="mt-2 block break-words font-mono text-mono text-fg">{cell.value}</span>
      <span className="mt-1 block font-mono text-[0.625rem] text-fg-subtle">{cell.path}</span>
    </button>
  )
}

function DetailPanel({
  id,
  cell,
  reduced,
  onClose,
}: {
  id: string
  cell: Cell
  reduced: boolean
  onClose: () => void
}) {
  return (
    <motion.div
      id={id}
      className="overflow-hidden"
      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: reduced ? DUR.instant : DUR.base, ease: EASE.out }}
    >
      <div className="mt-3 rounded-lg border border-border bg-surface-raised/85 p-4 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[0.6875rem] text-fg-subtle uppercase tracking-[0.08em]">
            {cell.caption} · live fields
          </span>
          <span aria-hidden className="h-px flex-1 bg-border" />
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${cell.caption} detail`}
            className="rounded-sm p-0.5 text-fg-subtle transition-colors duration-150 hover:bg-hover hover:text-fg"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
          {cell.detail.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4 border-border/60 border-b py-1.5"
            >
              <dt className="shrink-0 font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]">
                {row.label}
              </dt>
              <dd className="min-w-0 break-all text-right font-mono text-mono text-fg">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </motion.div>
  )
}

/**
 * Soft index-coloured wash. Its only job is to give the glass surfaces something to refract —
 * without it a translucent card on warm paper is just a flat card.
 */
function AmbientWash({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div
        className="-top-20 -left-12 absolute size-64 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--color-accent) 16%, transparent), transparent)',
        }}
      />
      <div
        className="-right-16 -bottom-24 absolute size-72 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--chart-1) 18%, transparent), transparent)',
        }}
      />
      <div
        className="absolute top-1/4 left-1/3 size-56 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--chart-2) 14%, transparent), transparent)',
        }}
      />
    </div>
  )
}

/**
 * The API can list the same artifact filename more than once (one entry per model directory).
 * Repeating the identical string tells the reader nothing, so collapse duplicates and show the
 * count instead — no information is dropped.
 */
function formatArtifacts(artifacts: string[]) {
  if (artifacts.length === 0) return 'none on this machine'
  const counts = new Map<string, number>()
  for (const a of artifacts) counts.set(a, (counts.get(a) ?? 0) + 1)
  return [...counts].map(([name, n]) => (n > 1 ? `${name} (${n})` : name)).join(', ')
}

/** Every figure below is a verified constant from ./data.ts — the closing claims nothing new. */
const CLOSING_STATS: { label: string; value: string }[] = [
  { label: 'Incidents', value: String(RUN.incidentsTotal) },
  { label: 'Accounts', value: String(DATASET.accounts) },
  { label: 'Lines replayed', value: DATASET.lines.toLocaleString() },
]

export function Closing() {
  return (
    // Positioning context + clip for AmbientWash. The band itself is the shell's job.
    <div className="relative overflow-hidden">
      <AmbientWash />
      <Section className="relative py-20 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_auto] lg:items-end">
          <div className="min-w-0">
            <Stamp>Closing</Stamp>
            <p className="mt-6 max-w-[20ch] font-serif text-title sm:text-display">
              Everything above resolves to a line you can open.
            </p>
            <p className="mt-5 max-w-[46ch] text-body text-fg-muted">
              The console is the same data, live.
            </p>
          </div>

          <div className="flex flex-col items-start gap-6 lg:items-end">
            <dl className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border shadow-sm lg:w-auto">
              {CLOSING_STATS.map((s) => (
                <div key={s.label} className="bg-surface/85 px-4 py-3 backdrop-blur-sm">
                  <dt className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]">
                    {s.label}
                  </dt>
                  <dd className="mt-1 font-mono text-heading text-fg tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>

            <Pressable>
              <Button asChild size="lg">
                <Link to="/app">
                  Open the console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </Pressable>

            <p className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]">
              run {RUN.id.slice(0, 8)} · {RUN.state}
            </p>
          </div>
        </div>
      </Section>
    </div>
  )
}

/*
 * Derived at module load, never retyped: the footer cannot drift from the sections it points
 * at. Same ids the masthead and the section anchors use.
 */
const FOOTER_SECTIONS: { href: string; label: string; hint: string }[] = [
  { href: '#docket', label: 'Docket', hint: `${INCIDENTS.length} incidents` },
  { href: '#exhibit', label: 'Exhibit A', hint: `${EXHIBIT.count} denials` },
  { href: '#limits', label: 'Limits', hint: `${UNKNOWNS.length} unknowns` },
  { href: '#method', label: 'Method', hint: `R1–R${RULES.length}` },
]

export function Footer() {
  return (
    <footer className="border-border border-t bg-bg">
      <Section className="py-12 sm:py-14">
        <div className="grid gap-8 md:grid-cols-[1.7fr_1fr_1fr]">
          <div className="min-w-0">
            {/* Closes the loop with the masthead's accent hairline. */}
            <div aria-hidden className="h-0.5 w-14 rounded-full bg-accent" />
            <p className="mt-4 font-serif text-title leading-none">Log &amp; Order</p>
            <p className="mt-3 max-w-[52ch] font-normal text-caption text-fg-subtle normal-case">
              Built for Hack the North 2026 · CSE challenge. Dataset{' '}
              <span className="font-mono">{DATASET.id}</span> — {DATASET.lines.toLocaleString()} lines,{' '}
              {DATASET.rejects} rejected. Account names and addresses identify recorded actors and
              sources, not people.
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.625rem] text-fg-subtle">
              <span>sha-256 {DATASET.sha256Short}</span>
              <span>
                {DATASET.from} — {DATASET.to}
              </span>
            </p>
          </div>

          <nav
            aria-label="Sections"
            className="min-w-0 border-border border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8"
          >
            <p className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]">
              Sections
            </p>
            <ul className="mt-3 space-y-2">
              {FOOTER_SECTIONS.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    className="flex items-baseline gap-2 rounded-sm text-body text-fg-muted transition-colors duration-150 hover:text-fg"
                  >
                    {s.label}
                    <span className="font-mono text-[0.625rem] text-fg-subtle">{s.hint}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 border-border border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8">
            <p className="font-mono text-[0.625rem] text-fg-subtle uppercase tracking-[0.08em]">
              Live
            </p>
            <a
              href="/health/ready"
              className="mt-3 block rounded-sm font-mono text-caption text-fg-muted transition-colors duration-150 hover:text-fg"
            >
              /health/ready
            </a>
            <Link
              to="/app"
              className="mt-2 inline-flex items-baseline gap-1 rounded-sm text-body text-fg-muted transition-colors duration-150 hover:text-fg"
            >
              Open the console
              <ArrowUpRight aria-hidden className="size-3" />
            </Link>
            <p className="mt-3 max-w-[22ch] font-normal text-caption text-fg-subtle normal-case">
              The same readiness endpoint the board above reads.
            </p>
          </div>
        </div>
      </Section>
    </footer>
  )
}
