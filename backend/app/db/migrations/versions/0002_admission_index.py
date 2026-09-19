"""Registry ordering index for replay admission by (dataset, event_time, line_number).

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS event_registry_dataset_order ON event_registry (dataset_id, event_time, line_number)")
    op.execute("CREATE INDEX IF NOT EXISTS processed_events_acct_path ON processed_events (run_id, username, path, event_time)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS event_registry_dataset_order")
    op.execute("DROP INDEX IF EXISTS processed_events_acct_path")
