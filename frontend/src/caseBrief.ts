import type { IncidentDetail } from './api'

/** A portable evidence snapshot, not a dump of mutable operational state or AI proposals. */
export function buildCaseBrief(detail: IncidentDetail) {
  const { incident, version, packet } = detail
  if (!packet || !detail.packet_hash) throw new Error('An evidence packet is required for export.')
  return {
    schema_version: 'logorder.case-brief.v1',
    scope: 'Recorded evidence at the selected incident version; not a verdict or a complete log archive.',
    incident: {
      run_id: incident.run_id,
      incident_id: incident.incident_id,
      version: version.version,
      account: incident.account,
      trigger_source_ip:
        detail.timeline.find((event) => event.event_id === version.trigger_event_id)?.ip_raw ?? null,
      classification: version.threat_class,
      trigger_seq: version.trigger_seq,
      trigger_event_id: version.trigger_event_id,
      timeline_start: version.timeline_start,
      timeline_end: version.timeline_end,
      rule_ids: version.rule_ids,
    },
    evidence_cutoff_seq: detail.evidence_cutoff_seq,
    provenance: detail.provenance,
    summary: version.summary,
    evidence_strength: version.evidence_strength,
    packet_hash: detail.packet_hash,
    packet,
    timeline: detail.timeline
      .filter(
        (event) => event.run_seq <= detail.evidence_cutoff_seq && event.added_version <= version.version,
      )
      // Event decisions combine every rule at the sequence (including R5 after
      // R2/v1); do not present that final decision as this version's evidence.
      .map(({ threat_class: _eventDecision, ...evidence }) => evidence),
    rule_matches: detail.rule_matches.filter(
      (match) => match.run_seq <= detail.evidence_cutoff_seq && version.rule_ids.includes(match.rule_id),
    ),
    limitations: [
      'Accounts and source IPs are recorded identifiers, not proof of the person responsible.',
      'Request order and rule matches do not establish intent, exploitation, or causation.',
      'Raw log lines and live aggregate recounts are not included; use the versioned fact evidence endpoint to verify them.',
      'The packet hash fingerprints the embedded packet, not the entire export, and is not a digital signature.',
      'AI proposals, current dispositions, delivery state, and later incident relationships are intentionally excluded.',
      ...(packet.completeness.listing_truncated
        ? ['The packet evidence listing is truncated; inspect its completeness metadata.']
        : []),
    ],
  }
}

export function downloadCaseBrief(detail: IncidentDetail) {
  const blob = new Blob([JSON.stringify(buildCaseBrief(detail), null, 2) + '\n'], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const id = detail.incident.incident_id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  anchor.href = url
  anchor.download = `logorder-${id}-v${detail.version.version}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Allow the browser to begin consuming the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
