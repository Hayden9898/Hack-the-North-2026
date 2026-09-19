import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  api,
  describeError,
  type Baseline,
  type Delivery,
  type Disposition,
  type Explanation,
  type ExplanationJob,
  type Fact,
  type FactResponse,
  type FeedbackRow,
  type IncidentDetail,
  type Packet,
  type PlaybooksBlock,
} from '../api'
import {
  DELIVERY_STATE_LABEL,
  DISPOSITIONS,
  factKindLabel,
  factValueText,
  fmtNum,
  fmtTime,
  hypothesisText,
  shortId,
  unknownLabel,
} from '../format'
import { useFetch } from '../useFetch'
import { ClassBadge, Code, Empty, ErrorState, EventLink, IncidentLink, Loading, PhaseBadge, RuleTags, Section, StateBadge, Tag } from '../ui'

export function IncidentPage() {
  const { runId = '', incidentId = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const versionParam = sp.get('version')
  const version = versionParam ? Number(versionParam) : undefined
  const inc = useFetch<IncidentDetail>(() => api.getIncident(runId, incidentId, version), [runId, incidentId, version])
  const [drawerFact, setDrawerFact] = useState<Fact | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)

  useEffect(() => {
    if (!highlight) return
    const el = document.getElementById(`fact-${highlight}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setHighlight(null), 2_500)
    return () => clearTimeout(t)
  }, [highlight])

  if (inc.loading && !inc.data) return <Loading what="incident" />
  if (inc.error && !inc.data) return <ErrorState error={inc.error} onRetry={() => void inc.reload()} what="incident" />
  const d = inc.data
  if (!d) return <Empty>No incident under the current cutoff.</Empty>

  const v = d.version
  const s = v.summary
  const strength = v.evidence_strength
  const isCurrent = v.version === d.incident.current_version
  const packet = d.packet

  const facts = packet?.facts ?? []
  const factById = new Map(facts.map((f) => [f.fact_id, f]))
  const rulesIncomplete = rulesIncompleteCodes(packet)
  const gotoFact = (id: string) => setHighlight(id)

  return (
    <div className="stack">
      <div className="crumbs">
        <Link to="/">Runs</Link> / <Link to={`/runs/${encodeURIComponent(runId)}`}>{shortId(runId, 18)}</Link> / incident{' '}
        <span className="mono">{shortId(incidentId, 18)}</span>
      </div>

      <Section
        title={
          <span className="row">
            <ClassBadge threatClass={v.threat_class} />
            <StateBadge state={d.incident.status} />
            <PhaseBadge phase={d.incident.phase} />
            <Tag tone="muted">historical replay evidence</Tag>
            {!isCurrent ? <Tag tone="warn">viewing version {v.version} (current is v{d.incident.current_version})</Tag> : null}
          </span>
        }
        aside={
          <label className="field">
            version
            <select
              value={String(v.version)}
              onChange={(e) => {
                const nv = e.target.value
                if (Number(nv) === d.incident.current_version) sp.delete('version')
                else sp.set('version', nv)
                setSp(sp, { replace: true })
              }}
            >
              {d.versions.map((x) => (
                <option key={x.version} value={String(x.version)}>
                  v{x.version} · {x.threat_class} · trigger #{x.trigger_seq}
                  {x.version === d.incident.current_version ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <div className="headline">{s.headline}</div>
        <div className="qualifier">{s.qualifier || 'Qualified detector finding; not an assertion of intent.'}</div>
        <dl className="kvs">
          <div className="kv">
            <dt>account / ip</dt>
            <dd className="mono">
              {d.incident.account ?? '—'} / {d.incident.ip_raw ?? '—'}
            </dd>
          </div>
          <div className="kv">
            <dt>key</dt>
            <dd className="mono small">
              {d.incident.key_type}={d.incident.key_value}
            </dd>
          </div>
          <div className="kv">
            <dt>timeline</dt>
            <dd className="mono small">
              {fmtTime(v.timeline_start)} → {fmtTime(v.timeline_end)}
            </dd>
          </div>
          <div className="kv">
            <dt>rules</dt>
            <dd>
              <RuleTags ids={v.rule_ids} />
            </dd>
          </div>
          <div className="kv">
            <dt>trigger event</dt>
            <dd>
              <EventLink runId={runId} seq={v.trigger_seq} /> <span className="muted small mono">{shortId(v.trigger_event_id, 12)}</span>
            </dd>
          </div>
          <div className="kv">
            <dt>cutoff</dt>
            <dd className="mono">#{fmtNum(d.cutoff_seq)}</dd>
          </div>
          <div className="kv">
            <dt>packet hash</dt>
            <dd className="mono small">{shortId(d.packet_hash, 16)}</dd>
          </div>
          <div className="kv">
            <dt>incident id</dt>
            <dd className="mono small">{d.incident.incident_id}</dd>
          </div>
        </dl>
        <hr className="hr" />
        <h3>Evidence strength</h3>
        <div className="row" style={{ marginTop: 4 }}>
          <Tag tone={strength.legs_present ? 'ok' : 'warn'}>{strength.legs_present ? 'all rule legs present in evidence' : 'some rule legs missing from evidence'}</Tag>
          <Tag tone="muted">{strength.distinct_evidence_events} distinct evidence events</Tag>
          {strength.evaluation_incomplete || rulesIncomplete.length > 0 ? (
            <Tag tone="danger">EVALUATION INCOMPLETE{rulesIncomplete.length > 0 ? `: ${rulesIncomplete.join(', ')}` : ''}</Tag>
          ) : (
            <Tag tone="ok">evaluation complete</Tag>
          )}
          {packet?.completeness.listing_truncated ? <Tag tone="warn">evidence listing truncated at {packet.completeness.max_events}</Tag> : null}
        </div>
        {strength.evaluation_incomplete ? (
          <div className="notice notice-danger" style={{ marginTop: 8 }}>
            <strong>Evaluation incomplete.</strong> Some rule evaluation or fact computation did not finish under this cutoff. Treat this incident as
            provisional; the missing pieces are listed under "What we cannot establish".
          </div>
        ) : null}
      </Section>

      <div className="grid-2">
        <div className="stack">
          <Section title="Timeline of evidence events">
            {d.timeline.length === 0 ? (
              <Empty>No evidence events under the current cutoff.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="right">seq</th>
                      <th>time (UTC)</th>
                      <th>account@ip</th>
                      <th>request</th>
                      <th className="right">status</th>
                      <th>relation</th>
                      <th>rule</th>
                      <th>class</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.timeline.map((t) => (
                      <tr
                        key={`${t.event_id}-${t.relation_type}`}
                        className={`clickable ${t.run_seq === v.trigger_seq ? 'row-high_risk' : ''}`}
                        onClick={() => nav(`/runs/${encodeURIComponent(runId)}/events/${t.run_seq}`)}
                      >
                        <td className="right mono">
                          <EventLink runId={runId} seq={t.run_seq}>
                            {t.run_seq}
                          </EventLink>
                        </td>
                        <td className="mono nowrap">{fmtTime(t.event_time)}</td>
                        <td className="mono">
                          {t.username}@{t.ip_raw}
                        </td>
                        <td className="mono">
                          {t.method} {t.path}
                        </td>
                        <td className="right mono">{t.status}</td>
                        <td>
                          <Tag>{t.relation_type}</Tag>
                          {t.added_version !== v.version ? <span className="muted small"> v{t.added_version}</span> : null}
                        </td>
                        <td>{t.rule_id ? <Tag tone="info">{t.rule_id}</Tag> : <span className="muted">—</span>}</td>
                        <td>
                          <ClassBadge threatClass={t.threat_class} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Related episodes">
            {d.relations.length === 0 ? (
              <Empty>No related episodes recorded.</Empty>
            ) : (
              <ul className="plain">
                {d.relations.map((r) => (
                  <li key={`${r.related_incident_id}-${r.relation_type}`} className="row" style={{ padding: '4px 0' }}>
                    <ClassBadge threatClass={r.current_class} />
                    <IncidentLink runId={runId} incidentId={r.related_incident_id}>
                      {shortId(r.related_incident_id, 14)}
                    </IncidentLink>
                    <Tag tone="info">{r.primary_rule_id}</Tag>
                    <Tag>{r.relation_type}</Tag>
                    <span className="mono small muted">
                      {r.account ?? r.key_value} · link {r.link_key} · since v{r.created_version}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <ExplanationSection
            summaryLines={s.lines}
            triggerEvents={s.trigger_events}
            explanation={d.explanation}
            job={d.explanation_job}
            packet={packet}
            factById={factById}
            gotoFact={gotoFact}
          />

          <PlaybooksSection playbooks={d.playbooks ?? null} />

          <BaselineSection baseline={d.baseline} account={d.incident.account} triggerSeq={v.trigger_seq} />
        </div>

        <div className="stack">
          <FactsPanel packet={packet} highlight={highlight} onShowEvidence={setDrawerFact} />
          <DeliverySection deliveries={d.deliveries} />
          <FeedbackSection runId={runId} incidentId={incidentId} feedback={d.feedback} onSaved={() => void inc.reload()} />
        </div>
      </div>

      {drawerFact ? (
        <FactDrawer runId={runId} incidentId={incidentId} version={v.version} fact={drawerFact} onClose={() => setDrawerFact(null)} />
      ) : null}
    </div>
  )
}

/** packet.completeness.rules_incomplete is a string[] of rule/fact codes (empty = complete); tolerate a legacy boolean. */
function rulesIncompleteCodes(packet: { completeness?: { rules_incomplete?: boolean | string[] } } | null | undefined): string[] {
  const v = packet?.completeness?.rules_incomplete
  if (Array.isArray(v)) return v
  if (v === true) return ['unspecified']
  return []
}

// ------------------------------------------------------------------ playbooks

function asList(v: string | string[] | undefined | null): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

function PlaybooksSection({ playbooks }: { playbooks: PlaybooksBlock | null }) {
  const selected = new Set(playbooks?.selected_by_ai ?? [])
  return (
    <Section title="Remediation playbooks" aside={playbooks ? <span className="muted">catalog v{playbooks.catalog_version}</span> : null}>
      <p className="muted small">Recommendations are review steps; nothing here executes against any system.</p>
      {!playbooks || playbooks.applicable.length === 0 ? (
        <Empty>No playbook in the catalog applies to this incident's rules or fact kinds.</Empty>
      ) : (
        <ul className="plain stack">
          {playbooks.applicable.map((pb) => (
            <li key={pb.id}>
              <details className="playbook">
                <summary>
                  <span className="row">
                    <strong>{pb.title}</strong>
                    {selected.has(pb.id) ? <Tag tone="warn">AI suggested</Tag> : <Tag tone="muted">applicable (deterministic)</Tag>}
                    <span className="mono small muted">{pb.id}</span>
                  </span>
                  <div className="qualifier small" style={{ margin: '4px 0 0' }}>
                    {pb.uncertainty}
                  </div>
                </summary>
                <div className="playbook-body">
                  <h3>Proposed steps (for a human reviewer)</h3>
                  <ol className="bul">
                    {pb.proposed_steps.map((s, i) =>
                      typeof s === 'string' ? (
                        <li key={i}>{s}</li>
                      ) : (
                        Object.entries(s).map(([cond, step]) => (
                          <li key={`${i}-${cond}`}>
                            <em>{cond}:</em> {step}
                          </li>
                        ))
                      ),
                    )}
                  </ol>
                  <h3>Required evidence (not in these logs)</h3>
                  <ul className="bul">
                    {pb.required_evidence.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <dl className="kvs" style={{ marginTop: 6 }}>
                    <div className="kv">
                      <dt>permissions</dt>
                      <dd>{asList(pb.permissions).join('; ') || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>impact</dt>
                      <dd>{pb.impact || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>verification</dt>
                      <dd>{asList(pb.verification).join('; ') || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>rollback</dt>
                      <dd>{asList(pb.rollback).join('; ') || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>applies when</dt>
                      <dd className="small">
                        {pb.applicability.any_rules?.length ? `rules ${pb.applicability.any_rules.join(', ')}` : ''}
                        {pb.applicability.any_rules?.length && pb.applicability.any_fact_kinds?.length ? ' or ' : ''}
                        {pb.applicability.any_fact_kinds?.length ? `facts ${pb.applicability.any_fact_kinds.join(', ')}` : ''}
                      </dd>
                    </div>
                  </dl>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ facts

function FactsPanel({ packet, highlight, onShowEvidence }: { packet: Packet | null; highlight: string | null; onShowEvidence: (f: Fact) => void }) {
  if (!packet) {
    return (
      <Section title="Facts (deterministic)" tone="fact">
        <Empty>No fact packet stored for this version.</Empty>
      </Section>
    )
  }
  const groups: { role: Fact['role']; title: string }[] = [
    { role: 'trigger', title: 'Trigger' },
    { role: 'support', title: 'Supporting' },
    { role: 'context', title: 'Context / counterevidence' },
  ]
  return (
    <Section title="Facts (deterministic)" tone="fact" aside={<span>{packet.facts.length} facts · schema {packet.schema_version ?? '1'}</span>}>
      <p className="muted small">
        Every fact was computed by code from committed evidence before any AI involvement. "Show evidence" opens the exact log lines or a recomputed
        aggregate proof.
      </p>
      {groups.map((g) => {
        const list = packet.facts.filter((f) => f.role === g.role)
        if (list.length === 0) return null
        return (
          <div key={g.role} style={{ marginBottom: 8 }}>
            <h3>{g.title}</h3>
            <ul className="plain facts">
              {list.map((f) => (
                <li key={f.fact_id} id={`fact-${f.fact_id}`} className={highlight === f.fact_id ? 'highlight' : ''}>
                  <div>
                    <div className="kind">
                      <span className="kind-name">{factKindLabel(f.kind)}</span> · <span className="mono">{f.fact_id}</span> · cutoff #{f.cutoff_seq}
                    </div>
                    <div>{factValueText(f.kind, f.value, f.args)}</div>
                    {f.query ? <div className="muted small mono">aggregate query: {f.query.id}</div> : null}
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => onShowEvidence(f)}>
                    Show evidence
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </Section>
  )
}

function FactDrawer({ runId, incidentId, version, fact, onClose }: { runId: string; incidentId: string; version: number; fact: Fact; onClose: () => void }) {
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const res = useFetch<FactResponse>(() => api.getFact(runId, fact.fact_id, incidentId, version, limit, offset), [runId, fact.fact_id, incidentId, version, limit, offset])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const proof = res.data?.aggregate_proof ?? null
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Fact evidence">
        <div className="drawer-head">
          <div>
            <strong>{factKindLabel(fact.kind)}</strong> <span className="mono small muted">{fact.fact_id}</span>
            <div className="small muted">
              role {fact.role} · cutoff #{fact.cutoff_seq} · provenance {shortId(fact.provenance_hash, 16)}
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body stack">
          <div>
            <h3>Recorded value</h3>
            <div>{factValueText(fact.kind, fact.value, fact.args)}</div>
            <details style={{ marginTop: 4 }}>
              <summary className="small muted">args and raw value</summary>
              <Code block>{{ args: fact.args, value: fact.value }}</Code>
            </details>
          </div>

          {res.loading && !res.data ? (
            <Loading what="evidence" />
          ) : res.error && !res.data ? (
            <ErrorState error={res.error} onRetry={() => void res.reload()} what="evidence" />
          ) : res.data ? (
            <>
              <div>
                <h3>Exact evidence lines ({res.data.evidence.length})</h3>
                {res.data.evidence.length === 0 ? (
                  <Empty>{fact.query ? 'This fact is an aggregate; see the recomputed proof below.' : 'No evidence lines referenced.'}</Empty>
                ) : (
                  <ul className="plain" style={{ marginTop: 6 }}>
                    {res.data.evidence.map((e) => (
                      <li key={e.event_id} className="evidence-line">
                        <div className="meta row">
                          <EventLink runId={runId} seq={e.run_seq} /> line {e.line_number ?? '—'} · dataset {e.dataset_id ?? '—'} · {fmtTime(e.event_time)} ·{' '}
                          <ClassBadge threatClass={e.threat_class} />
                        </div>
                        <pre className="code-block">
                          <code>{e.raw_line}</code>
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {proof ? (
                <div>
                  <h3>Recomputed aggregate proof</h3>
                  {proof.error ? (
                    <div className="notice notice-warn">Could not recompute: {proof.error}</div>
                  ) : (
                    <>
                      <dl className="kvs" style={{ marginTop: 6 }}>
                        <div className="kv">
                          <dt>query id</dt>
                          <dd className="mono">{proof.query.id}</dd>
                        </div>
                        <div className="kv">
                          <dt>recomputed count</dt>
                          <dd className="mono">{fmtNum(proof.recomputed_count)}</dd>
                        </div>
                        <div className="kv">
                          <dt>recorded value</dt>
                          <dd className="mono">{String(proof.recorded_value)}</dd>
                        </div>
                        <div className="kv">
                          <dt>matches recorded</dt>
                          <dd>
                            {proof.matches_recorded === true ? (
                              <span className="check-ok">✓ yes</span>
                            ) : proof.matches_recorded === false ? (
                              <span className="check-bad">✗ NO — recomputation differs from the recorded value</span>
                            ) : (
                              <span className="muted">n/a (non-integer value)</span>
                            )}
                          </dd>
                        </div>
                      </dl>
                      <details>
                        <summary className="small muted">query params</summary>
                        <Code block>{proof.query.params ?? {}}</Code>
                      </details>
                      <div className="row row-between" style={{ margin: '8px 0 4px' }}>
                        <span className="small muted">
                          rows {offset + 1}–{Math.min(offset + limit, (proof.recomputed_count ?? 0) || offset + (proof.rows?.length ?? 0))} of{' '}
                          {fmtNum(proof.recomputed_count)}
                        </span>
                        <span className="row">
                          <label className="small muted">
                            limit{' '}
                            <select
                              value={limit}
                              onChange={(e) => {
                                setLimit(Number(e.target.value))
                                setOffset(0)
                              }}
                            >
                              {[25, 50, 100, 200].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                            Prev
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={offset + limit >= (proof.recomputed_count ?? 0)}
                            onClick={() => setOffset(offset + limit)}
                          >
                            Next
                          </button>
                        </span>
                      </div>
                      {res.refreshing ? <Loading what="page" /> : null}
                      <div className="table-wrap">
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th className="right">seq</th>
                              <th>time (UTC)</th>
                              <th>account@ip</th>
                              <th>request</th>
                              <th className="right">status</th>
                              <th className="right">line</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(proof.rows ?? []).map((r) => (
                              <tr key={r.event_id}>
                                <td className="right mono">
                                  <EventLink runId={runId} seq={r.run_seq}>
                                    {r.run_seq}
                                  </EventLink>
                                </td>
                                <td className="mono nowrap">{fmtTime(r.event_time)}</td>
                                <td className="mono">
                                  {r.username}@{r.ip_raw}
                                </td>
                                <td className="mono">
                                  {r.method} {r.path}
                                </td>
                                <td className="right mono">{r.status}</td>
                                <td className="right mono">{r.line_number ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </>
  )
}

// ------------------------------------------------------------------ explanation

function FactRefs({ ids, factById, gotoFact, label }: { ids: string[]; factById: Map<string, Fact>; gotoFact: (id: string) => void; label: string }) {
  return (
    <div className="small">
      <span className="muted">{label}: </span>
      {ids.length === 0 ? (
        <span className="muted">none</span>
      ) : (
        ids.map((id) => (
          <button key={id} type="button" className="factref" onClick={() => gotoFact(id)} title={factById.get(id) ? factKindLabel(factById.get(id)!.kind) : 'fact id not in packet'}>
            {factById.has(id) ? `${factKindLabel(factById.get(id)!.kind)} (${shortId(id, 10)})` : `${shortId(id, 12)} (not in packet)`}
          </button>
        ))
      )}
    </div>
  )
}

function ExplanationSection({
  summaryLines,
  triggerEvents,
  explanation,
  job,
  packet,
  factById,
  gotoFact,
}: {
  summaryLines: string[]
  triggerEvents: string[]
  explanation: Explanation | null
  job: ExplanationJob | null
  packet: Packet | null
  factById: Map<string, Fact>
  gotoFact: (id: string) => void
}) {
  const validated = explanation?.validated ?? null
  const unknowns = packet?.unknown_codes ?? []
  return (
    <Section
      title="Explanation"
      aside={
        job ? (
          <span>
            AI review job: <StateBadge state={job.state} /> attempts {job.attempts}
            {job.next_attempt_at && (job.state === 'pending' || job.state === 'failed') ? ` · next ${fmtTime(job.next_attempt_at)}` : ''}
            {job.last_error ? <span className="muted"> · {job.last_error}</span> : null}
          </span>
        ) : (
          <span className="muted">no AI review job</span>
        )
      }
    >
      <div className="stack">
        <div className="card card-fact">
          <header className="card-head">
            <h2>Observed facts (deterministic)</h2>
            <span className="small muted">rendered from typed facts by code; the AI cannot change these</span>
          </header>
          <div className="card-body">
            {summaryLines.length === 0 && triggerEvents.length === 0 ? (
              <Empty>No summary lines for this version.</Empty>
            ) : (
              <>
                <ul className="bul">
                  {summaryLines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                {triggerEvents.length > 0 ? (
                  <>
                    <h3 style={{ marginTop: 6 }}>Trigger events</h3>
                    <ul className="plain">
                      {triggerEvents.map((t, i) => (
                        <li key={i}>
                          <code className="code-inline">{t}</code>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="card card-ai">
          <header className="card-head">
            <h2>AI suggested hypotheses (qualified, unproven)</h2>
            <span className="small" style={{ color: 'var(--ai)' }}>
              {explanation ? `${explanation.model_name} · prompt ${explanation.prompt_version}` : 'no explanation record'}
            </span>
          </header>
          <div className="card-body">
            {!explanation || explanation.state === 'fallback' ? (
              <div className="notice notice-ai">
                <strong>AI review unavailable — deterministic summary shown.</strong>
                {validated?.ai_review_reason ? <div className="small">Reason: {validated.ai_review_reason}</div> : null}
                {!explanation ? <div className="small muted">No explanation has been recorded for this version yet.</div> : null}
              </div>
            ) : explanation.state === 'rejected' ? (
              <div className="notice notice-danger">
                <strong>AI proposal rejected by validator.</strong> The deterministic summary above stands; nothing from the proposal was published.
                {explanation.rejection_reasons.length > 0 ? (
                  <ul className="bul">
                    {explanation.rejection_reasons.map((r, i) => (
                      <li key={i} className="mono small">
                        {r}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <>
                <p className="small muted">
                  These are AI-suggested, validator-checked hypotheses that reference only facts in the packet. They are possibilities to investigate,
                  not findings. The detector verdict above is unaffected by them.
                </p>
                {validated?.cached ? (
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    <Tag tone="info">cached result</Tag> same fact packet and model as an earlier review; no new provider call was made.
                  </div>
                ) : null}
                {validated && validated.hypotheses.length > 0 ? (
                  validated.hypotheses.map((h, i) => (
                    <div key={i} className="hyp">
                      <div className="hyp-title">AI suggested: {h.text?.trim() ? h.text : hypothesisText(h.type)}</div>
                      <FactRefs ids={h.supporting_fact_ids} factById={factById} gotoFact={gotoFact} label="supporting facts" />
                      <FactRefs ids={h.counterevidence_fact_ids} factById={factById} gotoFact={gotoFact} label="counterevidence facts" />
                      {h.unknown_codes.length > 0 ? (
                        <div className="small">
                          <span className="muted">what this hypothesis cannot establish: </span>
                          {h.unknown_codes.map(unknownLabel).join('; ')}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <Empty>The AI review produced no hypotheses.</Empty>
                )}
                {validated ? (
                  <div className="small" style={{ marginTop: 6 }}>
                    <span className="muted">False-positive assessment (AI suggested): </span>
                    {validated.false_positive_assessment.status}
                    {validated.false_positive_assessment.missing_evidence_codes.length > 0
                      ? ` · missing: ${validated.false_positive_assessment.missing_evidence_codes.map(unknownLabel).join('; ')}`
                      : ''}
                    {validated.playbook_ids.length > 0 ? (
                      <div>
                        <span className="muted">Suggested playbooks: </span>
                        {validated.playbook_ids.map((p) => (
                          <Tag key={p}>{p}</Tag>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {validated && validated.forced_inclusions && validated.forced_inclusions.length > 0 ? (
                  <div className="small" style={{ marginTop: 6 }}>
                    <span className="muted">Force-included by the system (counterevidence/context the AI could not omit): </span>
                    {validated.forced_inclusions.map((id) => (
                      <button key={id} type="button" className="factref" onClick={() => gotoFact(id)}>
                        {factById.has(id) ? `${factKindLabel(factById.get(id)!.kind)} (${shortId(id, 10)})` : shortId(id, 12)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {validated && validated.tool_log && validated.tool_log.length > 0 ? (
                  <details style={{ marginTop: 6 }}>
                    <summary className="small muted">AI tool calls (read-only, under cutoff): {validated.tool_log.length}</summary>
                    <ul className="plain small" style={{ marginTop: 4 }}>
                      {validated.tool_log.map((t, i) => (
                        <li key={i} className="mono">
                          {t.tool}
                          {t.error ? <span style={{ color: 'var(--danger)' }}> — {t.error}</span> : <span className="muted"> — {fmtNum(t.rows ?? 0)} rows</span>}
                          {t.args && Object.keys(t.args).length > 0 ? <span className="muted"> {JSON.stringify(t.args)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {explanation.rejection_reasons.length > 0 ? (
                  <div className="small muted" style={{ marginTop: 6 }}>
                    Validator notes: {explanation.rejection_reasons.join('; ')}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="card card-unknown">
          <header className="card-head">
            <h2>Unknowns — what we cannot establish</h2>
            <span className="small muted">from the fact packet</span>
          </header>
          <div className="card-body">
            {unknowns.length === 0 ? (
              <Empty>No unknown codes recorded for this version.</Empty>
            ) : (
              <ul className="bul">
                {unknowns.map((u) => (
                  <li key={u}>
                    {unknownLabel(u)} <span className="mono small muted">({u})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ baseline chart (inline SVG, no library)

function BaselineSection({ baseline, account, triggerSeq }: { baseline: Baseline | null; account: string | null; triggerSeq: number }) {
  return (
    <Section title="Baseline comparison" aside={<span className="muted">prior events for this account before trigger #{fmtNum(triggerSeq)}</span>}>
      {!baseline || !account ? (
        <Empty>No account baseline available (incident has no account key).</Empty>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 8 }}>
            <div className="stat">
              <div className="v">{fmtNum(baseline.total)}</div>
              <div className="k">prior events</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(baseline.c401)}</div>
              <div className="k">prior 401</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(baseline.c403)}</div>
              <div className="k">prior 403</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(baseline.ips)}</div>
              <div className="k">distinct source IPs</div>
            </div>
            <div className="stat">
              <div className="v" style={{ fontSize: 13 }}>
                {fmtTime(baseline.first_seen)}
              </div>
              <div className="k">first seen</div>
            </div>
          </div>
          <HourHistogram hist={baseline.hour_histogram} />
          <p className="muted small" style={{ marginTop: 4 }}>
            Prior events for <span className="mono">{account}</span> by local hour (log timezone offset), counted from processed evidence before the trigger.
            A measured distribution, not a model output.
          </p>
        </>
      )}
    </Section>
  )
}

function HourHistogram({ hist }: { hist: Record<string, number> }) {
  const values = Array.from({ length: 24 }, (_, h) => hist[String(h)] ?? 0)
  const max = Math.max(1, ...values)
  const W = 720
  const H = 140
  const padL = 36
  const padB = 22
  const padT = 8
  const bw = (W - padL - 8) / 24
  const scaleY = (n: number) => ((H - padB - padT) * n) / max
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Prior events by local hour">
      <line x1={padL} y1={H - padB} x2={W - 4} y2={H - padB} stroke="var(--line-strong)" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--line-strong)" />
      <text x={padL - 6} y={padT + 4} fill="var(--fg-3)" fontSize="10" textAnchor="end">
        {fmtNum(max)}
      </text>
      <text x={padL - 6} y={H - padB} fill="var(--fg-3)" fontSize="10" textAnchor="end">
        0
      </text>
      {values.map((n, h) => {
        const bh = scaleY(n)
        const x = padL + h * bw + 2
        return (
          <g key={h}>
            <rect x={x} y={H - padB - bh} width={Math.max(1, bw - 4)} height={bh} fill="var(--accent-2)" opacity={n === 0 ? 0.25 : 0.9}>
              <title>{`${String(h).padStart(2, '0')}:00 — ${fmtNum(n)} events`}</title>
            </rect>
            {h % 3 === 0 ? (
              <text x={x + (bw - 4) / 2} y={H - padB + 14} fill="var(--fg-3)" fontSize="10" textAnchor="middle">
                {String(h).padStart(2, '0')}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

// ------------------------------------------------------------------ delivery

function DeliverySection({ deliveries }: { deliveries: Delivery[] }) {
  return (
    <Section title="Delivery (Slack)">
      {deliveries.length === 0 ? (
        <Empty>No notifications queued for this incident.</Empty>
      ) : (
        <ul className="plain stack">
          {deliveries.map((n) => (
            <li key={n.idempotency_key} className="notice" style={{ padding: 10 }}>
              <div className="row">
                <Tag>{n.notification_kind}</Tag>
                <span className="muted small">v{n.version}</span>
                <StateBadge state={n.state} label={DELIVERY_STATE_LABEL[n.state] ?? n.state} />
                <span className="small muted">attempts {n.attempts}</span>
                {n.delivery_ambiguous ? <Tag tone="danger">duplicate delivery possible</Tag> : null}
              </div>
              {n.state === 'preview' ? (
                <div className="notice notice-warn small" style={{ marginTop: 6 }}>
                  Preview mode: nothing left the application. This is the exact message that would have been sent.
                </div>
              ) : null}
              <dl className="kvs" style={{ marginTop: 6 }}>
                <div className="kv">
                  <dt>next attempt</dt>
                  <dd className="mono small">{fmtTime(n.next_attempt_at)}</dd>
                </div>
                <div className="kv">
                  <dt>sent at</dt>
                  <dd className="mono small">{fmtTime(n.sent_at)}</dd>
                </div>
                <div className="kv">
                  <dt>idempotency key</dt>
                  <dd className="mono small">{shortId(n.idempotency_key, 20)}</dd>
                </div>
              </dl>
              {n.last_error ? <div className="notice notice-danger small" style={{ marginTop: 6 }}>last error: {n.last_error}</div> : null}
              {n.preview_text ? (
                <pre className="code-block" style={{ marginTop: 6 }}>
                  <code>{n.preview_text}</code>
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ analyst disposition

function FeedbackSection({ runId, incidentId, feedback, onSaved }: { runId: string; incidentId: string; feedback: FeedbackRow[]; onSaved: () => void }) {
  const [reviewer, setReviewer] = useState('')
  const [disposition, setDisposition] = useState<Disposition>('needs_more_evidence')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setSaved(false)
    try {
      await api.postFeedback(runId, incidentId, { reviewer: reviewer.trim(), disposition, reason: reason.trim() })
      setReason('')
      setSaved(true)
      onSaved()
    } catch (ex) {
      setErr(ex)
    } finally {
      setBusy(false)
    }
  }
  const e = err ? describeError(err) : null
  return (
    <Section title="Analyst disposition">
      <p className="muted small">
        Append-only audit record. Closing an incident records your disposition; it never erases detections, facts or versions.
      </p>
      <form onSubmit={(ev) => void submit(ev)} className="stack">
        <div className="form-grid">
          <label className="field">
            reviewer
            <input value={reviewer} onChange={(ev) => setReviewer(ev.target.value)} required maxLength={100} placeholder="your name" />
          </label>
          <label className="field">
            disposition
            <select value={disposition} onChange={(ev) => setDisposition(ev.target.value as Disposition)}>
              {DISPOSITIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          reason
          <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} required maxLength={2000} rows={3} placeholder="what you checked and why" />
        </label>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !reviewer.trim() || !reason.trim()}>
            {busy ? 'Saving…' : 'Record disposition'}
          </button>
          {saved ? <span className="small check-ok">recorded</span> : null}
          {e ? (
            <span className="small" style={{ color: 'var(--danger)' }}>
              Failed (HTTP {e.status ?? '—'}): {e.text}
            </span>
          ) : null}
        </div>
      </form>
      <hr className="hr" />
      <h3>Recorded dispositions</h3>
      {feedback.length === 0 ? (
        <Empty>No dispositions recorded yet.</Empty>
      ) : (
        <ul className="plain">
          {feedback.map((f) => (
            <li key={f.id} style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
              <div className="row">
                <Tag tone={f.disposition === 'confirmed_suspicious' ? 'danger' : f.disposition === 'needs_more_evidence' ? 'warn' : 'info'}>
                  {DISPOSITIONS.find((d) => d.value === f.disposition)?.label ?? f.disposition}
                </Tag>
                <span className="small muted">
                  {f.reviewer} · v{f.version} · {fmtTime(f.created_at)}
                </span>
              </div>
              <div className="small">{f.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
