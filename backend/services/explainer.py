"""
Explanation service for procurement sourcing agent.
Uses Claude API to generate audit-ready explanations and recommendations.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import anthropic

from backend.config import ANTHROPIC_API_KEY, AGENT_MODEL, AGENT_MAX_TOKENS, SPECIALIST_MODEL

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY or "missing")

SYSTEM_PROMPT = (
    "You are a procurement audit specialist. Generate clear, traceable explanations "
    "for procurement decisions. Your explanations must be suitable for audit review "
    "and comply with corporate procurement governance standards.\n\n"
    "Return ONLY a JSON object with these keys:\n"
    "- overall_recommendation: object with:\n"
    "    - status: one of 'can_proceed', 'proceed_with_conditions', 'cannot_proceed'\n"
    "    - reason: clear text explanation for the overall recommendation\n"
    "    - preferred_supplier_if_resolved: supplier_id of the top-ranked supplier "
    "(if the request can proceed or could proceed with conditions), or null\n"
    "    - preferred_supplier_rationale: why this supplier is recommended\n"
    "    - minimum_budget_required: numeric value if budget increase is needed, else null\n"
    "    - minimum_budget_currency: currency code if minimum_budget_required is set\n"
    "- per_supplier_explanation: list of objects, one per ranked supplier, each with:\n"
    "    - supplier_id: str\n"
    "    - supplier_name: str\n"
    "    - rank: int\n"
    "    - recommendation_note: text explaining why this supplier is ranked here, "
    "covering price, quality, risk, lead time, policy compliance, and any agent insights\n"
    "- audit_summary: object with:\n"
    "    - policies_checked: list of policy/rule IDs that were evaluated\n"
    "    - key_decision_factors: list of strings describing the main factors\n"
    "    - data_sources_used: list of data source names consulted\n"
    "    - historical_awards_consulted: boolean\n"
    "    - traceability_note: text explaining the decision chain\n"
)


def _parse_json_response(text: str) -> dict:
    """Extract JSON from Claude response, handling markdown code blocks."""
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    return json.loads(text)


def generate_explanation(
    request: dict[str, Any],
    validation: list[dict[str, Any]],
    policy_eval: dict[str, Any],
    ranked_suppliers: list[dict[str, Any]],
    escalations: list[dict[str, Any]],
    agent_opinions: list[dict[str, Any]],
    confidence: dict[str, Any],
) -> dict[str, Any]:
    """
    Generate an audit-ready explanation for a procurement sourcing decision.

    Args:
        request: The procurement request dict.
        validation: List of validation issue dicts.
        policy_eval: Policy evaluation result dict.
        ranked_suppliers: List of ranked supplier dicts (from the shortlist).
        escalations: List of escalation dicts.
        agent_opinions: List of agent opinion dicts.
        confidence: Confidence result dict.

    Returns:
        A dict with keys:
            - recommendation: dict matching the Recommendation model
            - audit_trail: dict matching the AuditTrail model
            - per_supplier_explanations: list of per-supplier explanation dicts
    """
    # Build context for Claude
    context = {
        "request": {
            "request_id": request.get("request_id"),
            "category_l1": request.get("category_l1"),
            "category_l2": request.get("category_l2"),
            "quantity": request.get("quantity"),
            "budget_amount": request.get("budget_amount"),
            "currency": request.get("currency", "EUR"),
            "delivery_countries": request.get("delivery_countries", []),
            "required_by_date": request.get("required_by_date"),
            "preferred_supplier_mentioned": request.get("preferred_supplier_mentioned"),
            "data_residency_constraint": request.get("data_residency_constraint", False),
            "esg_requirement": request.get("esg_requirement", False),
        },
        "validation_issues": validation,
        "policy_evaluation": policy_eval,
        "ranked_suppliers": ranked_suppliers,
        "escalations": escalations,
        "agent_opinions": agent_opinions,
        "confidence": confidence,
    }

    user_prompt = (
        "Based on the complete procurement analysis results below, generate an "
        "audit-ready explanation and recommendation.\n\n"
        f"{json.dumps(context, default=str, indent=2)}\n\n"
        "Consider:\n"
        "- If there are blocking escalations, the status should be 'cannot_proceed'\n"
        "- If there are non-blocking escalations or conditions, use 'proceed_with_conditions'\n"
        "- Only use 'can_proceed' if everything is clean\n"
        "- For each ranked supplier, explain why it got that rank\n"
        "- List all policies and rules that were checked\n"
    )

    try:
        response = client.messages.create(
            model=SPECIALIST_MODEL,
            max_tokens=AGENT_MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_text = response.content[0].text
        result = _parse_json_response(raw_text)
    except Exception:
        logger.exception("Claude explanation generation failed, returning defaults")
        result = _build_default_explanation(
            request, validation, ranked_suppliers, escalations
        )

    # Normalize the output into the expected shape
    overall = result.get("overall_recommendation", {})
    per_supplier = result.get("per_supplier_explanation", [])
    audit = result.get("audit_summary", {})

    recommendation = {
        "status": overall.get("status", "cannot_proceed"),
        "reason": overall.get("reason", "Unable to generate explanation."),
        "preferred_supplier_if_resolved": overall.get("preferred_supplier_if_resolved"),
        "preferred_supplier_rationale": overall.get("preferred_supplier_rationale"),
        "minimum_budget_required": overall.get("minimum_budget_required"),
        "minimum_budget_currency": overall.get("minimum_budget_currency"),
    }

    # Enrich ranked_suppliers with recommendation_note from per_supplier explanations
    explanation_map = {e["supplier_id"]: e for e in per_supplier if "supplier_id" in e}

    audit_trail = {
        "policies_checked": audit.get("policies_checked", []),
        "supplier_ids_evaluated": [s.get("supplier_id", "") for s in ranked_suppliers],
        "data_sources_used": audit.get("data_sources_used", [
            "suppliers.csv", "pricing.csv", "policies.json",
            "historical_awards.csv", "categories.csv",
        ]),
        "historical_awards_consulted": audit.get("historical_awards_consulted", False),
        "historical_award_note": audit.get("traceability_note"),
    }

    return {
        "recommendation": recommendation,
        "audit_trail": audit_trail,
        "per_supplier_explanations": per_supplier,
        "explanation_map": explanation_map,
    }


def _build_default_explanation(
    request: dict,
    validation: list,
    ranked_suppliers: list,
    escalations: list,
) -> dict:
    """Build a minimal default explanation when Claude call fails."""
    has_blocking = any(e.get("blocking", False) for e in escalations)
    has_escalations = len(escalations) > 0
    has_critical_validation = any(
        v.get("severity") == "critical" for v in validation
    )

    if has_blocking or has_critical_validation:
        status = "cannot_proceed"
        reason = "Blocking issues found that prevent proceeding."
    elif has_escalations:
        status = "proceed_with_conditions"
        reason = "Non-blocking escalations require attention before final award."
    else:
        status = "can_proceed"
        reason = "All checks passed."

    return {
        "overall_recommendation": {
            "status": status,
            "reason": reason,
            "preferred_supplier_if_resolved": (
                ranked_suppliers[0].get("supplier_id") if ranked_suppliers else None
            ),
            "preferred_supplier_rationale": "Top-ranked by composite scoring.",
            "minimum_budget_required": None,
            "minimum_budget_currency": None,
        },
        "per_supplier_explanation": [
            {
                "supplier_id": s.get("supplier_id", ""),
                "supplier_name": s.get("supplier_name", ""),
                "rank": s.get("rank", i + 1),
                "recommendation_note": "Explanation generation unavailable.",
            }
            for i, s in enumerate(ranked_suppliers)
        ],
        "audit_summary": {
            "policies_checked": [],
            "key_decision_factors": [],
            "data_sources_used": [
                "suppliers.csv", "pricing.csv", "policies.json",
                "historical_awards.csv",
            ],
            "historical_awards_consulted": False,
            "traceability_note": "Automated fallback explanation.",
        },
    }
