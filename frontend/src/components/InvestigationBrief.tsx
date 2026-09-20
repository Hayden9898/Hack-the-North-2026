import { useState } from 'react'
import { Download } from 'lucide-react'
import type { Fact, IncidentDetail } from '../api'
import { downloadCaseBrief } from '../caseBrief'
import { factKindLabel, factValueText, fmtNum, fmtTime, unknownLabel } from '../format'
import { EventLink, Section, Tag } from '../ui'

export function InvestigationBrief({
  detail,
  onEvidence,
}: {
  detail: IncidentDetail
  onEvidence: (fact: Fact) => void
}) {
  const [exportError, setExportError] = useState('')
  const { version, packet, provenance } = detail
  const trigger = detail.timeline.find((event) => event.event_id === version.trigger_event_id)
  const reasons = (packet?.facts ?? []).filter(
    (fact) => fact.role !== 'context' && fact.kind !== 'event_observed',
  )
  const context = (packet?.facts ?? []).filter((fact) => fact.role === 'context')
  const unknowns = [...new Set([...(packet?.unknown_codes ?? []), ...version.summary.unknowns])]

  function download() {
    setExportError('')
    try {
      downloadCaseBrief(detail)
    } catch {
      setExportError('The evidence brief could not be downloaded. Retry after reloading this version.')
    }
  }

  return (
    <Section title="Investigation brief" aside={<Tag tone="muted">Evidence version {version.version}</Tag>}>
      <dl className="brief-summary">
        <div>
          <dt>Who is recorded</dt>
          <dd>
            <strong>{detail.incident.account || 'No account recorded'}</strong>
            <span className="cell-secondary">Account identity is not human attribution.</span>
          </dd>
        </div>
        <div>
          <dt>What triggered this version</dt>
          <dd>
            {trigger ? (
              <>
                <span className="mono">
                  {trigger.method} {trigger.path} → {trigger.status}
                </span>
                <span className="cell-secondary">
                  {trigger.ip_raw} ·{' '}
                  {trigger.line_number
                    ? `Source line ${fmtNum(trigger.line_number)}`
                    : 'No source line recorded'}{' '}
                  · <EventLink runId={detail.incident.run_id} seq={trigger.run_seq} />
                </span>
              </>
            ) : (
              'Trigger details are not available in this evidence listing.'
            )}
          </dd>
        </div>
        <div>
          <dt>When it was observed</dt>
          <dd>
            {fmtTime(trigger?.event_time ?? version.timeline_end)}
            <span className="cell-secondary">
              Evidence cutoff #{fmtNum(detail.evidence_cutoff_seq)} · UTC
            </span>
          </dd>
        </div>
      </dl>
      <div className="brief-columns">
        <div>
          <h3>Why it was flagged</h3>
          <p className="small muted">
            Measured conditions, not an inferred attack narrative. Open any fact to inspect its proof.
          </p>
          {reasons.length ? (
            <ul className="brief-facts">
              {reasons.map((fact) => (
                <li key={fact.fact_id}>
                  <button className="brief-fact" onClick={() => onEvidence(fact)}>
                    <span>{factValueText(fact.kind, fact.value, fact.args)}</span>
                    <span className="cell-secondary">{factKindLabel(fact.kind)} · inspect evidence →</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No explanatory facts are available for this version.</p>
          )}
        </div>
        <div>
          <h3>What remains unproven</h3>
          <p className="small muted">The observed sequence does not establish the mechanism or intent.</p>
          {unknowns.length ? (
            <ul className="brief-unknowns">
              {unknowns.map((code) => (
                <li key={code}>{unknownLabel(code)}</li>
              ))}
            </ul>
          ) : (
            <p className="small muted">
              No additional unknowns were enumerated. This does not establish wrongdoing.
            </p>
          )}
          {context.length > 0 && (
            <details className="brief-context">
              <summary>Context & counterevidence · {context.length} facts</summary>
              <ul className="brief-facts">
                {context.map((fact) => (
                  <li key={fact.fact_id}>
                    <button className="brief-fact" onClick={() => onEvidence(fact)}>
                      {factValueText(fact.kind, fact.value, fact.args)}
                      <span className="cell-secondary">{factKindLabel(fact.kind)} · inspect evidence →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      <div className="brief-footer">
        <div className="small muted">
          <span>
            {provenance?.dataset_name ||
              (provenance?.source_id
                ? `Live source ${provenance.source_id}`
                : 'Source provenance unavailable')}{' '}
            · {version.rule_ids.join(', ')}
          </span>
          <span className="cell-secondary">
            Local export contains sensitive identifiers. Share only with authorized reviewers.
          </span>
        </div>
        <button className="btn btn-sm" disabled={!packet || !detail.packet_hash} onClick={download}>
          <Download size={14} aria-hidden="true" /> Download evidence brief (.json)
        </button>
      </div>
      {exportError && (
        <p role="alert" className="notice notice-warn">
          {exportError}
        </p>
      )}
    </Section>
  )
}
