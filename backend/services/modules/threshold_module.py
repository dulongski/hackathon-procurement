"""Threshold/approval review module — agent-informed threshold decisions."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def review_threshold_decision(
    request: dict[str, Any],
    policy_eval: dict[str, Any],
    escalations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Review threshold/approval decisions for agent-informable signals.

    Returns enriched threshold context for governance agents to consider.
    """
    approval = policy_eval.get("approval_threshold") or {}
    threshold_id = approval.get("threshold_id", "")
    quotes_required = approval.get("quotes_required", 1)
    deviation_needed = bool(approval.get("deviation_approval"))

    # Check for policy conflict signals
    request_text = request.get("request_text", "").lower()
    single_supplier_phrases = ["no exception", "single supplier", "only use", "must use", "exclusively"]
    has_single_supplier_instruction = any(phrase in request_text for phrase in single_supplier_phrases)

    policy_conflict = has_single_supplier_instruction and quotes_required > 1

    # Check for threshold edge cases
    budget = request.get("budget_amount") or 0
    contract_value = policy_eval.get("contract_value", budget)

    threshold_edge_case = False
    if approval.get("min_value") and contract_value:
        # Contract value is within 10% of threshold boundary
        min_val = float(approval.get("min_value", 0))
        if min_val > 0 and abs(contract_value - min_val) / min_val < 0.1:
            threshold_edge_case = True

    return {
        "threshold_id": threshold_id,
        "quotes_required": quotes_required,
        "deviation_needed": deviation_needed,
        "policy_conflict": policy_conflict,
        "threshold_edge_case": threshold_edge_case,
        "contract_value": contract_value,
        "signals_for_agents": {
            "requires_multi_quote": quotes_required > 1,
            "has_deviation_requirement": deviation_needed,
            "has_policy_conflict": policy_conflict,
            "near_threshold_boundary": threshold_edge_case,
        },
    }
