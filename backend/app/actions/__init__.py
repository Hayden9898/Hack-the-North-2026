"""Containment actions: the step from a described incident to an approved, verifiable operation.

`catalog` loads the reviewed action definitions, `binding` fills their parameters from typed facts (never from the
AI), `adapters` carries them out (preview by default), `verify` recomputes the verification criterion against the
log, `packet` renders the handoff document and `service` sequences dry run → execute → verify → rollback while
writing the append-only action log.
"""
