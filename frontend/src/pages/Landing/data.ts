/*
 * Verified constants for the landing page.
 *
 * RULE: nothing in this file may be invented. Every value below was read out of the running
 * system on 2026-09-19 and the source is named next to it. If you cannot cite where a number
 * came from, it does not belong on this page — a placeholder figure would be a correctness
 * bug in a product whose entire pitch is that its claims are provable.
 *
 * Re-verify with:
 *   curl -s localhost:8000/api/v1/runs/$RUN                      # counts, model_health
 *   curl -s localhost:8000/api/v1/runs/$RUN/incidents            # headlines, qualifiers
 *   curl -s localhost:8000/api/v1/runs/$RUN/events/168338        # the raw grant line
 *   curl -s ".../facts/f_835847db3186ab94?...&version=2"         # the 77-denial proof
 */

/** Source: GET /health/ready and the import report — 180,800 rows, 0 rejects. */
export const DATASET = {
  lines: 180_800,
  rejects: 0,
  id: 'ds_9f773643335352d8aa8cc9f0',
  sha256Short: '9f773643…0575',
  from: '01 Aug 2025',
  to: '31 Mar 2026',
  accounts: 10,
} as const

/** Source: GET /api/v1/runs/5ffdaacd… — `counts` and `model_health`. */
export const RUN = {
  id: '5ffdaacd-f111-49a7-807d-149ae5b63441',
  state: 'completed',
  modelHealth: 'rules_only',
  warmupNormal: 157_818,
  visibleNormal: 22_975,
  visibleSuspicious: 5,
  visibleHighRisk: 2,
  incidentsTotal: 3,
  lateEvents: 0,
  backlog: 0,
} as const

/**
 * Source: GET /api/v1/runs/{run}/incidents. Headlines and qualifiers are verbatim from the
 * API — they are the product's own words, which is the point. Do not "improve" the wording.
 */
export const INCIDENTS = [
  {
    docket: '01',
    verdict: 'high_risk',
    rules: ['R1', 'R4'],
    key: 'sarah_j | 10.0.8.45',
    headline:
      'Sensitive resource served to an unfamiliar account/source pair shortly after a successful login, following an earlier failed-login episode',
    qualifier:
      'Repeated failures indicate attempts, not who made them. Suspected account misuse; session identity is not recorded in these logs.',
    span: '168314 → 168345',
    when: '14–16 Mar 2026',
  },
  {
    docket: '02',
    verdict: 'high_risk',
    rules: ['R2', 'R5'],
    key: 'david_m | q1_draft_CONFIDENTIAL.zip',
    headline: "Access change linked to another account's forum-object view and admin request",
    qualifier:
      'A measured change in the observed response, not proof of unauthorized access; an approved grant looks identical. Does not assert who created the object or whose role changed.',
    span: '168338',
    when: '15 Mar 2026',
  },
  {
    docket: '03',
    verdict: 'suspicious',
    rules: ['R3'],
    key: 'sarah_j | /api/admin/role_update',
    headline: 'First successful admin request by this account, seconds after viewing a forum object',
    qualifier: 'Linked recorded requests; no causal assertion about the forum content.',
    span: '168336',
    when: '15 Mar 2026',
  },
] as const

/**
 * Exhibit A. Source: the `prior_denials_count` fact f_835847db3186ab94 on incident
 * 09c1b229 v2, and GET /events/168338. Both raw lines are byte-exact from the dataset.
 */
export const EXHIBIT = {
  factId: 'f_835847db3186ab94',
  count: 77,
  /** The first of the 77 denials, run_seq 2598. */
  denial: {
    line: 2598,
    when: '05 Aug 2025',
    raw: '10.0.8.45 - david_m [05/Aug/2025:13:05:36 -0400] "GET /finance/reports/q1_draft_CONFIDENTIAL.zip HTTP/1.1" 403 245',
  },
  /** The grant that fired R2, escalated to high risk by R5. */
  grant: {
    line: 168338,
    when: '15 Mar 2026',
    raw: '10.0.8.45 - david_m [15/Mar/2026:11:26:59 -0400] "GET /finance/reports/q1_draft_CONFIDENTIAL.zip HTTP/1.1" 200 8459200',
  },
  /** Verbatim from the fact's `query` block — this is what makes the count reproducible. */
  query: {
    id: 'account_path_status_count',
    version: 1,
    params: {
      account: 'david_m',
      path: '/finance/reports/q1_draft_CONFIDENTIAL.zip',
      status: 403,
      before_seq: 168338,
    },
  },
  /** Verbatim from `aggregate_proof`. The API recomputes the count and compares. */
  proof: { recomputed: 77, recorded: 77, matches: true },
  provenanceHashShort: '15f7510f…6257',
} as const

/** Source: the `unknowns` arrays on the three incidents, deduplicated. */
export const UNKNOWNS = [
  ['session_identity_unavailable', 'No session IDs exist in these logs. A successful login does not prove who was at the keyboard.'],
  ['credential_source_unknown', 'Nothing records where the credentials came from.'],
  ['authorized_change_record_unavailable', 'There is no change-approval feed to check the grant against.'],
  ['role_change_contents_unavailable', 'The role-update request body is not logged.'],
  ['external_transfer_unproven', 'A 200 and a byte count are not proof that data left the network.'],
  ['object_creator_unknown', 'The logs do not say who created the object.'],
] as const

/** Source: the five deterministic detectors, as named in the incident `rule_ids`. */
export const RULES = [
  ['R1', 'Repeated login failures for one account/source pair inside a short window.'],
  ['R2', 'First successful response for a sensitive resource after repeated denials.'],
  ['R3', 'First successful admin request by an account, close behind a related view.'],
  ['R4', 'Escalates a match when the account/source pair is unfamiliar against the frozen August reference.'],
  ['R5', 'Escalates an access change on a resource classed as confidential.'],
] as const
