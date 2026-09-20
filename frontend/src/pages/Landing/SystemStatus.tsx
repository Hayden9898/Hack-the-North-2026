import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'
import { api, describeError, type Health } from '@/api'
import { degradedModeLabel } from '@/format'
import { useFetch } from '@/useFetch'
import { Skeleton } from '@/components/ui/skeleton'
import { DATASET, RUN } from './data'
import { Section, Stamp } from './parts'

/**
 * Live, not hardcoded. This page makes a point of only showing provable things, so the one
 * claim about the system's *current* state has to come from the system.
 *
 * Degraded modes are rendered as hatched neutral tags: they are neither a verdict nor a
 * record processing state, and must not borrow the colour language of either.
 */
export function SystemStatus() {
  const health = useFetch<Health>(() => api.health(), [])

  return (
    <Section className="pt-16 pb-10">
      <div className="rounded-doc border border-border bg-surface p-6 shadow-md sm:p-8">
        <Stamp>System state</Stamp>
        <div className="mt-5">
          <p className="max-w-[68ch] text-body text-fg-muted">
            Read live from <span className="font-mono text-fg">/health/ready</span> when this page
            loaded. Degraded modes are declared. The console tells you when it is running with
            something switched off.
          </p>

          <div className="mt-5">
            {health.loading && !health.data ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-64" />
              </div>
            ) : health.error ? (
              <p className="font-mono text-mono text-blocked">
                health check unreachable — {describeError(health.error).text || 'no response'}. Nothing
                on this page depends on it; the figures above come from the recorded dataset.
              </p>
            ) : health.data ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 font-mono text-mono">
                  <span className="text-fg-subtle">
                    api <span className="text-fg">{health.data.status}</span>
                  </span>
                  <span className="text-fg-subtle">
                    db <span className="text-fg">{health.data.database.detail ?? '—'}</span>
                  </span>
                  <span className="text-fg-subtle">
                    models{' '}
                    <span className="text-fg">
                      {formatArtifacts(health.data.models.artifacts)}
                    </span>
                  </span>
                </div>

                {health.data.degraded_modes.length > 0 ? (
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {health.data.degraded_modes.map((m) => (
                      <li
                        key={m}
                        className="state-hatch rounded-sm border border-pending/45 px-2 py-1 font-mono text-[0.6875rem] text-pending uppercase"
                      >
                        {degradedModeLabel(m)}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/*
                  Derived from the live response, never asserted. The machine's model artifacts
                  can change underneath this page; the demo run's own model_health cannot, because
                  it is a recorded property of a run that already finished.
                */}
                <p className="mt-5 max-w-[68ch] text-body text-fg-muted">
                  {health.data.models.artifacts.length === 0 ? (
                    <>
                      No model artifacts are present on this machine, so scoring is{' '}
                      <span className="font-mono text-fg">rules_only</span>.
                    </>
                  ) : (
                    <>
                      Model artifacts are present now, but the run shown above was replayed before they
                      existed and is recorded as{' '}
                      <span className="font-mono text-fg">{RUN.modelHealth}</span>.
                    </>
                  )}{' '}
                  Every verdict on this page therefore came from the deterministic rules. The
                  Isolation Forest would add a second opinion; it did not contribute to these three
                  incidents and nothing here pretends otherwise.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Section>
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

export function Closing() {
  return (
    <Section className="pt-4 pb-14">
      <div className="flex flex-col items-start gap-4 border-border border-t pt-10 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[48ch] text-body text-fg-muted">
          Everything above resolves to a line you can open. The console is the same data, live.
        </p>
        <Button asChild size="lg">
          <Link to="/app">
            Open the console
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </Section>
  )
}

export function Footer() {
  return (
    <footer className="border-border border-t">
      <Section className="flex flex-col gap-6 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-serif text-heading">Log &amp; Order</p>
          <p className="mt-1.5 max-w-[52ch] font-normal text-caption text-fg-subtle normal-case">
            Built for Hack the North 2026 · CSE challenge. Dataset{' '}
            <span className="font-mono">{DATASET.id}</span> — {DATASET.lines.toLocaleString()} lines,{' '}
            {DATASET.rejects} rejected. Account names and addresses identify recorded actors and
            sources, not people.
          </p>
        </div>
        <a
          href="/health/ready"
          className="shrink-0 rounded-sm font-mono text-caption text-fg-muted transition-colors duration-150 hover:text-fg"
        >
          /health/ready
        </a>
      </Section>
    </footer>
  )
}
