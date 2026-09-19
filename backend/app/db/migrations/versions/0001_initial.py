"""Initial storage model: evidence registry, raw hypertable, runs, ordered inbox, detections, incidents, jobs.

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SQL = r"""
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------- source evidence
CREATE TABLE datasets (
    id                text PRIMARY KEY,
    content_sha256    text NOT NULL UNIQUE,
    original_name     text NOT NULL,
    bytes             bigint NOT NULL,
    total_lines       bigint NOT NULL DEFAULT 0,
    valid_count       bigint NOT NULL DEFAULT 0,
    rejected_count    bigint NOT NULL DEFAULT 0,
    parse_version     text NOT NULL,
    import_state      text NOT NULL CHECK (import_state IN ('pending','importing','ready','failed')),
    progress_line     bigint NOT NULL DEFAULT 0,
    progress_bytes    bigint NOT NULL DEFAULT 0,
    first_event_time  timestamptz,
    last_event_time   timestamptz,
    stats             jsonb NOT NULL DEFAULT '{}'::jsonb,
    error             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_registry (
    event_id         text PRIMARY KEY,
    dataset_id       text REFERENCES datasets(id),
    line_number      bigint,
    source_id        text,
    client_event_id  text,
    payload_hash     text NOT NULL,
    event_time       timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((dataset_id IS NOT NULL AND line_number IS NOT NULL) OR (source_id IS NOT NULL AND client_event_id IS NOT NULL)),
    UNIQUE (dataset_id, line_number),
    UNIQUE (source_id, client_event_id)
);

CREATE TABLE raw_events (
    event_time      timestamptz NOT NULL,
    event_id        text NOT NULL,
    ip_raw          text NOT NULL,
    username        text NOT NULL,
    method          text NOT NULL,
    http_version    text NOT NULL,
    raw_target      text NOT NULL,
    path            text NOT NULL,
    query_raw       text,
    query_decoded   text,
    query_keys      text[] NOT NULL DEFAULT '{}',
    route_family    text NOT NULL,
    object_id       text,
    status          smallint NOT NULL,
    response_bytes  bigint,
    raw_line        text NOT NULL,
    original_time   text NOT NULL,
    offset_minutes  smallint NOT NULL,
    PRIMARY KEY (event_time, event_id)
);
SELECT create_hypertable('raw_events', 'event_time', chunk_time_interval => INTERVAL '1 month');
CREATE INDEX raw_events_username_time ON raw_events (username, event_time);
CREATE INDEX raw_events_ip_time ON raw_events (ip_raw, event_time);
CREATE INDEX raw_events_path_time ON raw_events (path, event_time);

CREATE TABLE ingestion_rejects (
    id            bigserial PRIMARY KEY,
    dataset_id    text,
    source_id     text,
    run_id        text,
    line_number   bigint,
    request_index integer,
    raw_input     text NOT NULL,
    reason        text NOT NULL,
    received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_rejects_dataset ON ingestion_rejects (dataset_id, line_number);

-- ---------------------------------------------------------------- models and runs
CREATE TABLE models (
    model_id             text PRIMARY KEY,
    feature_version      text NOT NULL,
    artifact_path        text NOT NULL,
    artifact_sha256      text NOT NULL,
    training_start       timestamptz,
    training_end         timestamptz,
    calibration_start    timestamptz,
    calibration_end      timestamptz,
    reference_hash       text,
    threshold            double precision,
    dependency_versions  jsonb NOT NULL DEFAULT '{}'::jsonb,
    manifest             jsonb NOT NULL DEFAULT '{}'::jsonb,
    status               text NOT NULL CHECK (status IN ('candidate','active','shadow','rejected')),
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runs (
    run_id               text PRIMARY KEY,
    name                 text NOT NULL DEFAULT '',
    dataset_id           text REFERENCES datasets(id),
    source_id            text,
    mode                 text NOT NULL CHECK (mode IN ('replay','live')),
    phase                text NOT NULL CHECK (phase IN ('warmup','visible')),
    model_id             text REFERENCES models(model_id),
    model_health         text NOT NULL DEFAULT 'rules_only',
    config_hash          text NOT NULL,
    config               jsonb NOT NULL DEFAULT '{}'::jsonb,
    feature_version      text NOT NULL,
    visible_start        timestamptz,
    range_start          timestamptz,
    range_end            timestamptz,
    admitted_seq         bigint NOT NULL DEFAULT 0,
    processed_seq        bigint NOT NULL DEFAULT 0,
    last_admitted_time   timestamptz,
    last_admitted_line   bigint NOT NULL DEFAULT 0,
    last_processed_time  timestamptz,
    virtual_time         timestamptz,
    virtual_anchor_wall  timestamptz,
    speed                double precision NOT NULL DEFAULT 60,
    state                text NOT NULL CHECK (state IN ('created','warming','running','paused','completed','blocked')),
    block_reason         text,
    blocked_seq          bigint,
    late_count           bigint NOT NULL DEFAULT 0,
    notifications_sent   integer NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE run_events (
    run_id            text NOT NULL REFERENCES runs(run_id),
    run_seq           bigint NOT NULL,
    event_id          text NOT NULL,
    event_time        timestamptz NOT NULL,
    phase             text NOT NULL,
    processing_state  text NOT NULL CHECK (processing_state IN ('admitted','processed','failed')),
    attempts          integer NOT NULL DEFAULT 0,
    last_error        text,
    admitted_at       timestamptz NOT NULL DEFAULT now(),
    processed_at      timestamptz,
    PRIMARY KEY (run_id, run_seq),
    UNIQUE (run_id, event_id)
);
CREATE INDEX run_events_time ON run_events (run_id, event_time, run_seq);
CREATE INDEX run_events_state ON run_events (run_id, processing_state, run_seq);

CREATE TABLE run_late_events (
    run_id        text NOT NULL REFERENCES runs(run_id),
    event_id      text NOT NULL,
    event_time    timestamptz NOT NULL,
    watermark     timestamptz NOT NULL,
    received_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, event_id)
);

CREATE TABLE entity_stats (
    run_id          text NOT NULL,
    key_type        text NOT NULL,
    key_value       text NOT NULL,
    schema_version  integer NOT NULL DEFAULT 1,
    state           jsonb NOT NULL,
    PRIMARY KEY (run_id, key_type, key_value)
);

CREATE TABLE feature_snapshots (
    run_id           text NOT NULL,
    run_seq          bigint NOT NULL,
    event_id         text NOT NULL,
    event_time       timestamptz NOT NULL,
    feature_version  text NOT NULL,
    history_count    bigint NOT NULL,
    numeric_vector   double precision[] NOT NULL,
    observed_context jsonb NOT NULL,
    reference_hash   text,
    PRIMARY KEY (run_id, run_seq)
);
CREATE INDEX feature_snapshots_time ON feature_snapshots (run_id, event_time);

CREATE TABLE detections (
    run_id             text NOT NULL,
    run_seq            bigint NOT NULL,
    event_id           text NOT NULL,
    event_time         timestamptz NOT NULL,
    phase              text NOT NULL,
    threat_class       text CHECK (threat_class IN ('normal','suspicious','high_risk')),
    processing_status  text NOT NULL,
    model_id           text,
    model_health       text NOT NULL,
    model_score        double precision,
    anomaly_percentile double precision,
    model_flagged      boolean,
    reason_codes       text[] NOT NULL DEFAULT '{}',
    rule_ids           text[] NOT NULL DEFAULT '{}',
    top_deviations     jsonb NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY (run_id, run_seq)
);
CREATE INDEX detections_class ON detections (run_id, threat_class, run_seq);

CREATE TABLE processed_events (
    event_time      timestamptz NOT NULL,
    run_id          text NOT NULL,
    run_seq         bigint NOT NULL,
    event_id        text NOT NULL,
    username        text NOT NULL,
    ip_raw          text NOT NULL,
    method          text NOT NULL,
    path            text NOT NULL,
    route_family    text NOT NULL,
    object_id       text,
    status          smallint NOT NULL,
    response_bytes  bigint,
    threat_class    text,
    phase           text NOT NULL,
    PRIMARY KEY (event_time, run_id, run_seq)
);
SELECT create_hypertable('processed_events', 'event_time', chunk_time_interval => INTERVAL '1 month');
CREATE INDEX processed_events_run_seq ON processed_events (run_id, run_seq);
CREATE INDEX processed_events_user_time ON processed_events (run_id, username, event_time);
CREATE INDEX processed_events_ip_time ON processed_events (run_id, ip_raw, event_time);
CREATE INDEX processed_events_object_time ON processed_events (run_id, object_id, event_time) WHERE object_id IS NOT NULL;

-- ---------------------------------------------------------------- rules and incidents
CREATE TABLE rule_matches (
    run_id         text NOT NULL,
    run_seq        bigint NOT NULL,
    rule_id        text NOT NULL,
    event_id       text NOT NULL,
    event_time     timestamptz NOT NULL,
    outcome        text NOT NULL,
    key_type       text NOT NULL,
    key_value      text NOT NULL,
    legs           jsonb NOT NULL,
    params         jsonb NOT NULL,
    incident_id    text,
    PRIMARY KEY (run_id, run_seq, rule_id)
);
CREATE INDEX rule_matches_key ON rule_matches (run_id, rule_id, key_type, key_value, event_time);

CREATE TABLE incidents (
    run_id            text NOT NULL,
    incident_id       text NOT NULL,
    key_type          text NOT NULL,
    key_value         text NOT NULL,
    primary_rule_id   text NOT NULL,
    status            text NOT NULL CHECK (status IN ('open','closed')),
    current_version   integer NOT NULL,
    current_class     text NOT NULL,
    first_seq         bigint NOT NULL,
    last_seq          bigint NOT NULL,
    first_event_time  timestamptz NOT NULL,
    last_event_time   timestamptz NOT NULL,
    account           text,
    ip_raw            text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, incident_id)
);
CREATE INDEX incidents_key ON incidents (run_id, primary_rule_id, key_type, key_value, last_event_time);
CREATE INDEX incidents_seq ON incidents (run_id, last_seq);

CREATE TABLE incident_versions (
    run_id            text NOT NULL,
    incident_id       text NOT NULL,
    version           integer NOT NULL,
    threat_class      text NOT NULL,
    trigger_seq       bigint NOT NULL,
    trigger_event_id  text NOT NULL,
    timeline_start    timestamptz NOT NULL,
    timeline_end      timestamptz NOT NULL,
    rule_ids          text[] NOT NULL,
    evidence_strength jsonb NOT NULL,
    summary           jsonb NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, incident_id, version)
);

CREATE TABLE incident_evidence (
    run_id         text NOT NULL,
    incident_id    text NOT NULL,
    event_id       text NOT NULL,
    run_seq        bigint NOT NULL,
    event_time     timestamptz NOT NULL,
    relation_type  text NOT NULL,
    rule_id        text,
    added_version  integer NOT NULL,
    PRIMARY KEY (run_id, incident_id, event_id, relation_type)
);

CREATE TABLE incident_relations (
    run_id               text NOT NULL,
    incident_id          text NOT NULL,
    related_incident_id  text NOT NULL,
    relation_type        text NOT NULL,
    link_key             text NOT NULL,
    created_version      integer NOT NULL,
    PRIMARY KEY (run_id, incident_id, related_incident_id, relation_type)
);

CREATE TABLE fact_packets (
    run_id        text NOT NULL,
    incident_id   text NOT NULL,
    version       integer NOT NULL,
    cutoff_seq    bigint NOT NULL,
    packet_hash   text NOT NULL,
    facts         jsonb NOT NULL,
    completeness  jsonb NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, incident_id, version)
);

-- ---------------------------------------------------------------- async side effects
CREATE TABLE explanation_jobs (
    job_id            text PRIMARY KEY,
    run_id            text NOT NULL,
    incident_id       text NOT NULL,
    version           integer NOT NULL,
    packet_hash       text NOT NULL,
    state             text NOT NULL CHECK (state IN ('pending','leased','done','failed','superseded')),
    lease_owner       text,
    lease_expires_at  timestamptz,
    attempts          integer NOT NULL DEFAULT 0,
    next_attempt_at   timestamptz NOT NULL DEFAULT now(),
    last_error        text,
    trace_context     jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, incident_id, version)
);
CREATE INDEX explanation_jobs_ready ON explanation_jobs (state, next_attempt_at);

CREATE TABLE explanations (
    run_id             text NOT NULL,
    incident_id        text NOT NULL,
    version            integer NOT NULL,
    packet_hash        text NOT NULL,
    prompt_version     text NOT NULL,
    model_name         text NOT NULL,
    state              text NOT NULL CHECK (state IN ('validated','fallback','rejected')),
    proposal_raw       jsonb,
    validated          jsonb,
    rejection_reasons  text[] NOT NULL DEFAULT '{}',
    latency_ms         integer,
    tool_calls         integer NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, incident_id, version)
);

CREATE TABLE notification_outbox (
    idempotency_key    text PRIMARY KEY,
    run_id             text NOT NULL,
    incident_id        text NOT NULL,
    version            integer NOT NULL,
    notification_kind  text NOT NULL,
    destination_key    text NOT NULL,
    payload            jsonb NOT NULL,
    state              text NOT NULL CHECK (state IN ('debounce','pending','leased','sent','preview','failed')),
    ready_event_time   timestamptz,
    lease_owner        text,
    lease_expires_at   timestamptz,
    attempts           integer NOT NULL DEFAULT 0,
    next_attempt_at    timestamptz NOT NULL DEFAULT now(),
    last_error         text,
    last_response      jsonb,
    delivery_ambiguous boolean NOT NULL DEFAULT false,
    trace_context      jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    sent_at            timestamptz
);
CREATE INDEX notification_outbox_ready ON notification_outbox (state, next_attempt_at);
CREATE INDEX notification_outbox_run ON notification_outbox (run_id, created_at);

CREATE TABLE ui_updates (
    run_id        text NOT NULL,
    update_seq    bigint NOT NULL,
    type          text NOT NULL,
    payload       jsonb NOT NULL,
    committed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, update_seq)
);

CREATE TABLE analyst_feedback (
    id           bigserial PRIMARY KEY,
    run_id       text NOT NULL,
    incident_id  text NOT NULL,
    version      integer NOT NULL,
    reviewer     text NOT NULL,
    disposition  text NOT NULL,
    reason       text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analyst_feedback_incident ON analyst_feedback (run_id, incident_id, created_at);
"""

DOWN = r"""
DROP TABLE IF EXISTS analyst_feedback, ui_updates, notification_outbox, explanations, explanation_jobs, fact_packets,
    incident_relations, incident_evidence, incident_versions, incidents, rule_matches, processed_events, detections,
    feature_snapshots, entity_stats, run_late_events, run_events, runs, models, ingestion_rejects, raw_events,
    event_registry, datasets CASCADE;
"""


def upgrade() -> None:
    for stmt in _split(SQL):
        op.execute(stmt)


def downgrade() -> None:
    op.execute(DOWN)


def _split(sql: str) -> list[str]:
    out: list[str] = []
    for chunk in sql.split(";\n"):
        s = chunk.strip()
        if s and not all(line.strip().startswith("--") or not line.strip() for line in s.splitlines()):
            out.append(s)
    return out
