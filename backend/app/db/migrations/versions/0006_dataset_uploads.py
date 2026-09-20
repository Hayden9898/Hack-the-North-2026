"""Durable upload handoff for split API and worker deployments.

Revision ID: 0006
Revises: 0005
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE dataset_uploads (
               dataset_id text PRIMARY KEY REFERENCES datasets(id) ON DELETE CASCADE,
               content bytea NOT NULL,
               created_at timestamptz NOT NULL DEFAULT now()
           )"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS dataset_uploads")
