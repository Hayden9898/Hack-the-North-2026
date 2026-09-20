"""Containment actions: deterministically bound proposals, an append-only action log, rendered response packets
and the containment stamp used for time-to-containment.

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SQL = r"""
ALTER TABLE incidents ADD COLUMN contained_at timestamptz;
ALTER TABLE incidents ADD COLUMN containment_mode text CHECK (containment_mode IN ('preview','applied'));

-- One proposal per (incident version, action). Parameters are bound by code from the fact packet; params_hash
-- pins the binding an operator approved, so an execute after the facts moved is refused rather than guessed.
CREATE TABLE action_proposals (
    proposal_id     text PRIMARY KEY,
    run_id          text NOT NULL,
    incident_id     text NOT NULL,
    version         integer NOT NULL,
    action_id       text NOT NULL,
    playbook_id     text NOT NULL,
    kind            text NOT NULL,
    severity        text NOT NULL,
    reversible      boolean NOT NULL DEFAULT true,
    params          jsonb NOT NULL,
    params_hash     text NOT NULL,
    bound_fact_ids  text[] NOT NULL DEFAULT '{}',
    catalog_version integer NOT NULL DEFAULT 1,
    state           text NOT NULL CHECK (state IN ('proposed','dry_run','executed','failed','rolled_back')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, incident_id, version, action_id)
);
CREATE INDEX action_proposals_incident ON action_proposals (run_id, incident_id, version);

-- Append-only. Every dry run, execution, verification and rollback is recorded with the operator, the adapter and
-- the exact request that was (or would have been) issued. Rows are never updated or deleted.
CREATE TABLE action_log (
    id           bigserial PRIMARY KEY,
    proposal_id  text NOT NULL REFERENCES action_proposals (proposal_id),
    run_id       text NOT NULL,
    incident_id  text NOT NULL,
    version      integer NOT NULL,
    action_id    text NOT NULL,
    kind         text NOT NULL,
    phase        text NOT NULL CHECK (phase IN ('dry_run','execute','verify','rollback')),
    operator     text NOT NULL,
    adapter      text NOT NULL,
    params_hash  text NOT NULL,
    request      jsonb NOT NULL,
    result       jsonb,
    outcome      text NOT NULL,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_log_incident ON action_log (run_id, incident_id, created_at);
CREATE INDEX action_log_proposal ON action_log (proposal_id, created_at);

CREATE TABLE response_packets (
    packet_id      text PRIMARY KEY,
    run_id         text NOT NULL,
    incident_id    text NOT NULL,
    version        integer NOT NULL,
    fact_packet_hash text,
    content_sha256 text NOT NULL,
    markdown       text NOT NULL,
    created_by     text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX response_packets_incident ON response_packets (run_id, incident_id, created_at);
"""

DOWN = r"""
DROP TABLE IF EXISTS response_packets, action_log, action_proposals CASCADE;
ALTER TABLE incidents DROP COLUMN IF EXISTS containment_mode;
ALTER TABLE incidents DROP COLUMN IF EXISTS contained_at;
"""


def upgrade() -> None:
    for stmt in _split(SQL):
        op.execute(stmt)


def downgrade() -> None:
    for stmt in _split(DOWN):
        op.execute(stmt)


def _split(sql: str) -> list[str]:
    out: list[str] = []
    for chunk in sql.split(";\n"):
        s = chunk.strip()
        if s and not all(line.strip().startswith("--") or not line.strip() for line in s.splitlines()):
            out.append(s)
    return out
