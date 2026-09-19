"""Tiger/TimescaleDB continuous aggregate over processed_events (5-minute buckets per run and account) plus an
explicit refresh-watermark table. The aggregate contains only committed processed records, never the raw dataset.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

CAGG = """
CREATE MATERIALIZED VIEW processed_events_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT time_bucket('5 minutes', event_time) AS bucket,
       run_id,
       username AS account,
       count(*)                                          AS events,
       count(*) FILTER (WHERE status = 401)              AS c401,
       count(*) FILTER (WHERE status = 403)              AS c403,
       sum(coalesce(response_bytes, 0))                  AS response_bytes,
       count(*) FILTER (WHERE threat_class = 'high_risk') AS high_risk,
       count(*) FILTER (WHERE threat_class = 'suspicious') AS suspicious
FROM processed_events
GROUP BY 1, 2, 3
WITH NO DATA
"""


def upgrade() -> None:
    op.execute(
        """CREATE TABLE aggregate_refreshes (
               run_id            text PRIMARY KEY,
               refreshed_through timestamptz NOT NULL,
               refreshed_at      timestamptz NOT NULL DEFAULT now(),
               buckets           bigint NOT NULL DEFAULT 0,
               duration_ms       integer
           )"""
    )
    # Continuous aggregates cannot be created inside a transaction block.
    with op.get_context().autocommit_block():
        op.execute(CAGG)
    # Freshness is explicit: no wall-clock policy (replay data is in 2025/2026, a wall-clock window would never cover it).


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP MATERIALIZED VIEW IF EXISTS processed_events_5m")
    op.execute("DROP TABLE IF EXISTS aggregate_refreshes")
