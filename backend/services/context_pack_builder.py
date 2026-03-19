"""Context pack builder — compiles scoped context for governance agents."""

from __future__ import annotations

import json
from typing import Any

from backend.models import AgentOpinion, MemoryEntry
from backend.services.governance_memory import get_governance_memory


def build_supervisor_context(
    request: dict[str, Any],
    constraint_snapshot_summary: dict[str, Any],
) -> dict[str, Any]:
    memory = get_governance_memory()
    entries = memory.get_scoped_context("supervisor", limit=5)
    return {
        "request_summary": {
            "request_id": request.get("request_id"),
            "category": f"{request.get('category_l1', '')}/{request.get('category_l2', '')}",
            "country": request.get("country"),
            "quantity": request.get("quantity"),
            "budget": request.get("budget_amount"),
            "currency": request.get("currency"),
        },
        "constraint_signals": {
            "eligible_count": len(constraint_snapshot_summary.get("eligible_suppliers", [])),
            "excluded_count": len(constraint_snapshot_summary.get("excluded_suppliers", [])),
            "validation_issue_count": len(constraint_snapshot_summary.get("validation_issues", [])),
            "escalation_count": len(constraint_snapshot_summary.get("escalations", [])),
            "has_catalog_gap": constraint_snapshot_summary.get("catalog_gap", {}).get("has_gap", False),
            "has_bundle_opportunity": constraint_snapshot_summary.get("bundle_opportunity", {}).get("has_opportunity", False),
        },
        "governance_memory": [e.model_dump() for e in entries],
    }


def build_critic_context(
    specialist_opinions: list[AgentOpinion],
    constraint_summary: dict[str, Any],
) -> dict[str, Any]:
    memory = get_governance_memory()
    entries = memory.get_scoped_context("critic", limit=5)
    return {
        "specialist_opinions": [
            o.model_dump() if hasattr(o, "model_dump") else o
            for o in specialist_opinions
        ],
        "constraint_summary": {
            "eligible_supplier_count": len(constraint_summary.get("eligible_suppliers", [])),
            "validation_issues": constraint_summary.get("validation_issues", []),
            "escalations": constraint_summary.get("escalations", []),
            "policy_evaluation": constraint_summary.get("policy_evaluation", {}),
        },
        "governance_memory": [e.model_dump() for e in entries],
    }


def _summarize_opinion(opinion: Any) -> dict[str, Any]:
    """Compress a specialist opinion to key fields only for the judge."""
    o = opinion.model_dump() if hasattr(opinion, "model_dump") else opinion
    # Keep only top 3 rankings and trim verbose fields
    rankings = o.get("supplier_rankings", [])
    compact_rankings = [
        {
            "supplier_id": r.get("supplier_id", ""),
            "supplier_name": r.get("supplier_name", ""),
            "score": r.get("score", 50),
            "rationale": (r.get("rationale") or "")[:150],
        }
        for r in rankings[:5]
    ]
    return {
        "agent_name": o.get("agent_name", ""),
        "opinion_summary": (o.get("opinion_summary") or "")[:300],
        "supplier_rankings": compact_rankings,
        "confidence": o.get("confidence"),
        "key_factors": (o.get("key_factors") or [])[:5],
    }


def _summarize_eligible(suppliers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compress eligible supplier list to essential fields for the judge."""
    return [
        {
            "supplier_id": s.get("supplier_id", ""),
            "supplier_name": s.get("supplier_name", ""),
            "quality_score": s.get("quality_score"),
            "risk_score": s.get("risk_score"),
            "esg_score": s.get("esg_score"),
            "is_preferred": s.get("is_preferred", False),
        }
        for s in suppliers
    ]


def build_judge_context(
    specialist_opinions: list[AgentOpinion],
    critic_findings: list[dict[str, Any]],
    constraint_snapshot: dict[str, Any],
) -> dict[str, Any]:
    memory = get_governance_memory()
    entries = memory.get_scoped_context("judge", limit=3)
    return {
        "specialist_opinions": [
            _summarize_opinion(o) for o in specialist_opinions
        ],
        "critic_findings": critic_findings,
        "deterministic_constraints": {
            "eligible_suppliers": _summarize_eligible(
                constraint_snapshot.get("eligible_suppliers", [])
            ),
            "validation_issues": constraint_snapshot.get("validation_issues", []),
            "escalations": constraint_snapshot.get("escalations", []),
            "contract_value": constraint_snapshot.get("contract_value", 0),
        },
        "governance_memory": [e.model_dump() for e in entries],
    }


def build_reviewer_context(
    recommendation: dict[str, Any],
    judge_decision: dict[str, Any],
    escalations: list[dict[str, Any]],
    audit_trail: dict[str, Any],
) -> dict[str, Any]:
    memory = get_governance_memory()
    entries = memory.get_scoped_context("reviewer", limit=5)
    return {
        "recommendation": recommendation,
        "judge_decision": judge_decision,
        "escalations": escalations,
        "audit_trail": audit_trail,
        "governance_memory": [e.model_dump() for e in entries],
    }
