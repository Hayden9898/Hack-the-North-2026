"""Record when and which incident version established a relationship.

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE incident_relations ADD COLUMN created_seq bigint, ADD COLUMN origin_incident_id text")
    # Before this migration, R5 was the only cross-incident link producer. Both
    # directions stored the producer's version, not the recipient's version.
    # Recover that provenance from its persisted rule match, never from now().
    # Unresolvable legacy links remain NULL and are excluded from as-of views.
    op.execute("""
        UPDATE incident_relations rel
        SET created_seq = m.run_seq, origin_incident_id = m.incident_id
        FROM rule_matches m, incident_versions v
        WHERE m.run_id = rel.run_id AND m.rule_id = 'R5'
          AND rel.relation_type = 'forum_object' AND rel.link_key = m.params->>'object_id'
          AND v.run_id = m.run_id AND v.incident_id = m.incident_id
          AND v.version = rel.created_version AND v.trigger_seq = m.run_seq
          AND 'R5' = ANY(v.rule_ids)
          AND ((rel.incident_id = m.incident_id AND rel.related_incident_id = m.params->>'r3_incident_id')
            OR (rel.related_incident_id = m.incident_id AND rel.incident_id = m.params->>'r3_incident_id'))
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE incident_relations DROP COLUMN origin_incident_id, DROP COLUMN created_seq")
