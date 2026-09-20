import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, describeError, type Fact, type IncidentDetail } from '../api'
import { shortId } from '../format'
import { useFetch } from '../useFetch'
import { AiPanel } from '../components/console/incident/AiPanel'
import { EvidenceDrawer } from '../components/console/incident/EvidenceDrawer'
import { groupFacts } from '../components/console/incident/facts'
import {
  BaselinePanel,
  DeliveryPanel,
  DispositionPanel,
  Empty,
  EvidenceStrengthRow,
  PlaybooksPanel,
  RelationsPanel,
  TimelinePanel,
  UnknownsPanel,
} from '../components/console/incident/panels'
import { ProofRail } from '../components/console/incident/ProofRail'
import { VerdictBand } from '../components/console/incident/VerdictBand'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Incident detail — the composition root.
 *
 * Was 1046 lines rendering eight co-equal sections, two of them fully expanded on load: an
 * 81-row timeline and a 92-item fact list. Now: one primary read (verdict + the ranked proof
 * rail), with every other surface exactly one interaction away. Nothing was deleted.
 */
export function IncidentPage() {
  const { runId = '', incidentId = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const versionParam = sp.get('version')
  const version = versionParam ? Number(versionParam) : undefined
  const inc = useFetch<IncidentDetail>(() => api.getIncident(runId, incidentId, version), [runId, incidentId, version])
  const [drawerFact, setDrawerFact] = useState<Fact | null>(null)

  if (inc.loading && !inc.data) return <IncidentSkeleton />
  if (inc.error && !inc.data) {
    const e = describeError(inc.error)
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <ErrorState
          title={e.status === 503 ? 'Database unavailable' : 'Could not load this incident'}
          detail={e.text}
          onRetry={() => void inc.reload()}
        />
      </div>
    )
  }
  const d = inc.data
  if (!d) return <div className="mx-auto max-w-2xl px-6 py-16"><Empty>No incident under the current cutoff.</Empty></div>

  const v = d.version
  const grouped = groupFacts(d.packet)
  const triggerHour = hourOf(d.timeline.find((t) => t.run_seq === v.trigger_seq)?.event_time ?? v.timeline_start)

  return (
    <div className="mx-auto w-full max-w-[84rem] px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb runId={runId} incidentId={incidentId} />

      <VerdictBand
        incident={d.incident}
        version={v}
        versions={d.versions}
        evidenceCount={v.evidence_strength.distinct_evidence_events}
        onVersionChange={(n) => {
          if (n === d.incident.current_version) sp.delete('version')
          else sp.set('version', String(n))
          setSp(sp, { replace: true })
        }}
      />

      <div className="mt-3">
        <EvidenceStrengthRow
          strength={v.evidence_strength}
          rulesIncomplete={rulesIncompleteCodes(d)}
          truncatedAt={d.packet?.completeness.listing_truncated ? d.packet.completeness.max_events : null}
        />
      </div>

      {v.evidence_strength.evaluation_incomplete ? (
        <p className="mt-3 rounded-lg border border-late/45 bg-surface px-4 py-3 text-body text-late">
          <strong className="font-medium">Evaluation incomplete.</strong> Some rule evaluation did not finish under this
          cutoff. Treat this incident as provisional — the gaps are listed under “What these logs cannot establish”.
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <main className="min-w-0 space-y-6">
          <section aria-labelledby="proof">
            <h2 id="proof" className="sr-only">
              Evidence
            </h2>
            <ProofRail grouped={grouped} onShowEvidence={setDrawerFact} />
          </section>

          <AiPanel explanation={d.explanation} job={d.explanation_job} packet={d.packet} onShowEvidence={setDrawerFact} />

          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">Timeline ({d.timeline.length})</TabsTrigger>
              <TabsTrigger value="related">Related ({d.relations.length})</TabsTrigger>
              <TabsTrigger value="playbooks">Playbooks ({d.playbooks?.applicable.length ?? 0})</TabsTrigger>
              <TabsTrigger value="baseline">Baseline</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline">
              <TimelinePanel timeline={d.timeline} runId={runId} triggerSeq={v.trigger_seq} />
            </TabsContent>
            <TabsContent value="related">
              <RelationsPanel relations={d.relations} runId={runId} />
            </TabsContent>
            <TabsContent value="playbooks">
              <PlaybooksPanel playbooks={d.playbooks ?? null} />
            </TabsContent>
            <TabsContent value="baseline">
              <BaselinePanel
                baseline={d.baseline}
                account={d.incident.account}
                triggerSeq={v.trigger_seq}
                triggerHour={triggerHour}
              />
            </TabsContent>
          </Tabs>
        </main>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <UnknownsPanel strength={v.evidence_strength} summary={v.summary} />
          <SideSection title="Notification">
            <DeliveryPanel deliveries={d.deliveries} />
          </SideSection>
          <SideSection title="Analyst disposition">
            <DispositionPanel runId={runId} incidentId={incidentId} feedback={d.feedback} onSaved={() => void inc.reload()} />
          </SideSection>
        </aside>
      </div>

      <EvidenceDrawer
        runId={runId}
        incidentId={incidentId}
        version={v.version}
        fact={drawerFact}
        onClose={() => setDrawerFact(null)}
      />
    </div>
  )
}

function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <h3 className="border-b border-border px-4 py-2.5 text-caption text-fg-muted uppercase">{title}</h3>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

function Breadcrumb({ runId, incidentId }: { runId: string; incidentId: string }) {
  const crumb = 'flex items-center gap-1.5 text-caption text-fg-muted normal-case tracking-normal hover:text-fg'
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5">
      <Link to="/app" className={crumb}>
        Runs
      </Link>
      <ChevronRight className="size-3 text-fg-subtle" aria-hidden />
      <Link to={`/app/runs/${encodeURIComponent(runId)}`} className={`${crumb} font-mono`}>
        {shortId(runId, 14)}
      </Link>
      <ChevronRight className="size-3 text-fg-subtle" aria-hidden />
      <span className="font-mono text-caption text-fg-subtle normal-case tracking-normal">{shortId(incidentId, 14)}</span>
    </nav>
  )
}

function IncidentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[84rem] px-4 py-6 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-4 h-52 w-full rounded-xl" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  )
}

/** `completeness.rules_incomplete` is a string[] of codes (empty = complete); tolerate a legacy boolean. */
function rulesIncompleteCodes(d: IncidentDetail): string[] {
  const v = d.packet?.completeness?.rules_incomplete
  if (Array.isArray(v)) return v
  return v === true ? ['unspecified'] : []
}

function hourOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).getUTCHours() : null
}
