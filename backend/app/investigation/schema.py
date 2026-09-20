"""Structured selection contract returned by the LLM (architecture.md §8) and the reviewed hypothesis templates.

The model may only *select* fact ids, hypothesis codes, unknown codes and playbook ids. No free prose is published.
"""
from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = "1"
FACT_ID_RE = re.compile(r"^f_[0-9a-f]{16}$")

# Minimum supporting predicates per hypothesis (any-of). These gates must be discriminating: kinds that every packet
# carries as context (pair_history, time_delta_seconds, local_hour_typicality, account_history_count) never appear
# here, otherwise any hypothesis would validate on any packet. source_familiarity is qualified by its value.
HYPOTHESIS_CODES: dict[str, dict[str, Any]] = {
    "possible_account_misuse": {
        "text": "Possible account misuse (unproven): the recorded account/source activity is consistent with someone other than "
                "the usual user acting for this account. Session identity is not recorded, so this cannot be confirmed from logs.",
        # Requires auth evidence: a failed-login burst or a source outside (or absent from) the login reference.
        "min_fact_kinds": {"auth_failures_in_window", "source_familiarity:unfamiliar", "source_familiarity:reference_unknown"},
    },
    "possible_privilege_abuse": {
        "text": "Possible privilege or access change (unproven): a previously denied resource or a privileged endpoint returned success. "
                "An authorised change would produce the same record; approval records are needed.",
        "min_fact_kinds": {"prior_denials_count", "first_success_after_denials", "prior_endpoint_post_2xx_count"},
    },
    "possible_forum_mediated_request": {
        "text": "Possible forum-mediated request (unproven): a privileged request followed a forum-object view within seconds. "
                "Request bodies and page content are not logged; the mechanism is not established.",
        # Requires the shared forum-object link itself; a time delta alone links any two requests.
        "min_fact_kinds": {"same_object"},
    },
    "legitimate_authorized_activity": {
        "text": "Possibly legitimate, authorised activity: prior history for this account/resource or source is consistent with routine use. "
                "This does not clear the incident; it identifies what an approval record would need to show.",
        # Requires a familiar source or prior account/resource success history.
        "min_fact_kinds": {"account_resource_history", "source_familiarity:familiar", "prior_successes_count"},
    },
    "insufficient_evidence": {
        "text": "Insufficient evidence in the access logs to prefer any explanation; the listed unknowns must be resolved from other systems.",
        "min_fact_kinds": set(),
    },
}

FP_STATUSES = ("not_assessed", "insufficient_evidence", "unlikely_false_positive", "likely_false_positive")

GLOBAL_UNKNOWN_CODES = {
    "session_identity_unavailable",
    "credential_source_unknown",
    "request_body_unavailable",
    "user_agent_unavailable",
    "role_change_contents_unavailable",
    "authorized_change_record_unavailable",
    "object_creator_unknown",
    "causal_link_unproven",
    "external_transfer_unproven",
    "destination_unavailable",
}

MISSING_EVIDENCE_CODES = GLOBAL_UNKNOWN_CODES | {"authorized_change_record", "owner_confirmation", "audit_log_entry"}


class Hypothesis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str
    supporting_fact_ids: list[str] = Field(default_factory=list, max_length=20)
    counterevidence_fact_ids: list[str] = Field(default_factory=list, max_length=20)
    unknown_codes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v not in HYPOTHESIS_CODES:
            raise ValueError(f"unknown hypothesis code {v!r}")
        return v

    @field_validator("supporting_fact_ids", "counterevidence_fact_ids")
    @classmethod
    def _ids(cls, v: list[str]) -> list[str]:
        for x in v:
            if not FACT_ID_RE.match(x):
                raise ValueError(f"not a fact id: {x!r}")
        return v


class FalsePositiveAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    supporting_fact_ids: list[str] = Field(default_factory=list, max_length=20)
    missing_evidence_codes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in FP_STATUSES:
            raise ValueError(f"unknown status {v!r}")
        return v

    @field_validator("supporting_fact_ids")
    @classmethod
    def _ids(cls, v: list[str]) -> list[str]:
        for x in v:
            if not FACT_ID_RE.match(x):
                raise ValueError(f"not a fact id: {x!r}")
        return v


class Selections(BaseModel):
    """Exactly the JSON the model must return. Anything else is rejected."""

    model_config = ConfigDict(extra="forbid")
    schema_version: str
    packet_hash: str
    summary_fact_ids: list[str] = Field(max_length=12)
    hypotheses: list[Hypothesis] = Field(max_length=4)
    false_positive_assessment: FalsePositiveAssessment
    playbook_ids: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("schema_version")
    @classmethod
    def _sv(cls, v: str) -> str:
        if v != SCHEMA_VERSION:
            raise ValueError("unsupported schema_version")
        return v

    @field_validator("summary_fact_ids")
    @classmethod
    def _ids(cls, v: list[str]) -> list[str]:
        for x in v:
            if not FACT_ID_RE.match(x):
                raise ValueError(f"not a fact id: {x!r}")
        return v


SELECTIONS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schema_version", "packet_hash", "summary_fact_ids", "hypotheses", "false_positive_assessment", "playbook_ids"],
    "properties": {
        "schema_version": {"type": "string", "enum": [SCHEMA_VERSION]},
        "packet_hash": {"type": "string"},
        "summary_fact_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
        "hypotheses": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "supporting_fact_ids", "counterevidence_fact_ids", "unknown_codes"],
                "properties": {
                    "type": {"type": "string", "enum": sorted(HYPOTHESIS_CODES)},
                    "supporting_fact_ids": {"type": "array", "items": {"type": "string"}},
                    "counterevidence_fact_ids": {"type": "array", "items": {"type": "string"}},
                    "unknown_codes": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "false_positive_assessment": {
            "type": "object",
            "additionalProperties": False,
            "required": ["status", "supporting_fact_ids", "missing_evidence_codes"],
            "properties": {
                "status": {"type": "string", "enum": list(FP_STATUSES)},
                "supporting_fact_ids": {"type": "array", "items": {"type": "string"}},
                "missing_evidence_codes": {"type": "array", "items": {"type": "string"}},
            },
        },
        "playbook_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
    },
}
