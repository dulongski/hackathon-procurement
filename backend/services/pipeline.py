"""
Pipeline orchestration for procurement sourcing agent.
Main entry point that coordinates all analysis steps.

Now delegates to the universal orchestration supervisor for the core pipeline.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, date
from typing import Any

from backend.data_loader import get_data
from backend.services.extractor import extract_requirements

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _days_until(target_date_str: str | None, from_date_str: str | None = None) -> int | None:
    """Compute days between now (or from_date) and target_date."""
    if not target_date_str:
        return None
    try:
        if isinstance(target_date_str, date):
            target = target_date_str
        else:
            target = datetime.fromisoformat(
                target_date_str.replace("Z", "+00:00")
            ).date()
    except (ValueError, AttributeError):
        return None

    if from_date_str:
        try:
            from_d = datetime.fromisoformat(
                from_date_str.replace("Z", "+00:00")
            ).date()
        except (ValueError, AttributeError):
            from_d = date.today()
    else:
        from_d = date.today()

    return (target - from_d).days


def _build_request_interpretation(request: dict) -> dict:
    """Build the request_interpretation sub-dict for the response."""
    return {
        "category_l1": request.get("category_l1", ""),
        "category_l2": request.get("category_l2", ""),
        "quantity": request.get("quantity"),
        "unit_of_measure": request.get("unit_of_measure"),
        "budget_amount": request.get("budget_amount"),
        "currency": request.get("currency", "EUR"),
        "delivery_country": (
            request.get("delivery_countries", [None])[0]
            if request.get("delivery_countries")
            else request.get("country")
        ),
        "required_by_date": request.get("required_by_date"),
        "days_until_required": _days_until(
            request.get("required_by_date"),
            request.get("created_at"),
        ),
        "data_residency_required": request.get("data_residency_constraint", False),
        "esg_requirement": request.get("esg_requirement", False),
        "preferred_supplier_stated": request.get("preferred_supplier_mentioned"),
        "incumbent_supplier": request.get("incumbent_supplier"),
        "requester_instruction": request.get("request_text"),
    }


def _build_policy_evaluation_dict(policy_eval: dict) -> dict:
    """Convert rule_engine.evaluate_policies output to AnalysisResponse shape."""
    approval = policy_eval.get("approval_threshold")
    approval_dict = None
    if approval:
        approval_dict = {
            "rule_applied": approval.get("threshold_id"),
            "basis": (
                f"{approval.get('currency', 'EUR')} "
                f"{approval.get('min_value', 0):,.0f} - "
                f"{approval.get('max_value', 'unlimited')}"
            ),
            "quotes_required": approval.get("quotes_required"),
            "approvers": (
                approval.get("managed_by")
                if isinstance(approval.get("managed_by"), list)
                else [approval.get("managed_by")]
                if approval.get("managed_by")
                else []
            ),
            "deviation_approval": (
                ", ".join(approval["deviation_approval"])
                if isinstance(approval.get("deviation_approval"), list)
                else approval.get("deviation_approval")
            ),
            "note": approval.get("policy_note"),
        }

    pref = policy_eval.get("preferred_supplier", {})
    pref_dict = None
    if pref:
        pref_dict = {
            "supplier": pref.get("supplier_name"),
            "status": "preferred" if pref.get("is_preferred") else "not_preferred",
            "is_preferred": pref.get("is_preferred", False),
            "covers_delivery_country": True,  # already filtered
            "is_restricted": False,
            "policy_note": pref.get("policy_note"),
        }

    restricted_dict = {}
    for sid, rinfo in policy_eval.get("restricted_suppliers", {}).items():
        restricted_dict[sid] = {
            "restricted": rinfo.get("restricted", False),
            "note": rinfo.get("restriction_reason"),
        }

    return {
        "approval_threshold": approval_dict,
        "preferred_supplier": pref_dict,
        "restricted_suppliers": restricted_dict,
        "category_rules_applied": policy_eval.get("category_rules", []),
        "geography_rules_applied": policy_eval.get("geography_rules", []),
    }


def _build_excluded_list(excluded: list[dict]) -> list[dict]:
    """Build the suppliers_excluded list for the response."""
    return [
        {
            "supplier_id": e.get("supplier_id", ""),
            "supplier_name": e.get("supplier_name", ""),
            "reason": e.get("exclusion_reason", "Excluded by filter"),
        }
        for e in excluded
    ]


def _build_escalation_list(escalations: list[dict]) -> list[dict]:
    """Ensure escalation dicts match the Escalation model."""
    return [
        {
            "escalation_id": e.get("escalation_id", ""),
            "rule": e.get("rule"),
            "trigger": e.get("trigger"),
            "escalate_to": e.get("escalate_to"),
            "blocking": e.get("blocking", False),
        }
        for e in escalations
    ]


# ---------------------------------------------------------------------------
# Main pipeline functions
# ---------------------------------------------------------------------------

async def analyze_request(request_id: str) -> dict[str, Any]:
    """
    Run the full procurement analysis pipeline for an existing request.

    Args:
        request_id: The ID of the request to analyze (must exist in data).

    Returns:
        A dict compatible with the AnalysisResponse model.
    """
    data = get_data()

    # 1. Load request
    request = data.requests_by_id.get(request_id)
    if not request:
        raise ValueError(f"Request {request_id} not found in data")

    # 2. Run extractor to interpret the request (fill in gaps)
    try:
        extracted = extract_requirements(
            request.get("request_text", ""),
            optional_fields={
                k: v for k, v in request.items() if v is not None
            },
        )
        # Merge extracted fields into request for any missing fields
        for key, value in extracted.items():
            if request.get(key) is None and value is not None:
                request[key] = value
    except Exception:
        logger.warning("Extractor failed for %s; proceeding with raw request", request_id)

    return await _run_pipeline(request, data)


async def analyze_custom(
    request_text: str,
    optional_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Analyze a free-text procurement request (not from stored data).

    Args:
        request_text: Free-text description of the procurement need.
        optional_fields: Optional structured fields to override extraction.

    Returns:
        A dict compatible with the AnalysisResponse model.
    """
    if optional_fields is None:
        optional_fields = {}

    # 1. Extract requirements from text
    request = extract_requirements(request_text, optional_fields)

    # 2. Run the pipeline
    data = get_data()
    return await _run_pipeline(request, data)


# ---------------------------------------------------------------------------
# Core pipeline — delegates to universal orchestration supervisor
# ---------------------------------------------------------------------------

async def _run_pipeline(
    request: dict[str, Any],
    data: Any,
) -> dict[str, Any]:
    """Core pipeline — delegates to universal orchestration supervisor."""
    from backend.services.supervisor import execute_orchestration

    request_id = request.get("request_id", "UNKNOWN")

    # Run universal orchestration
    try:
        result = await execute_orchestration(request, data)
    except Exception:
        logger.exception("Orchestration failed for %s, using deterministic fallback", request_id)
        # Fallback: run deterministic-only path
        return await _deterministic_fallback(request, data)

    # Convert OrchestrationResult to AnalysisResponse format
    return _assemble_from_orchestration(request, result)


# ---------------------------------------------------------------------------
# Assemble response from OrchestrationResult
# ---------------------------------------------------------------------------

def _assemble_from_orchestration(
    request: dict[str, Any],
    result: Any,  # OrchestrationResult
) -> dict[str, Any]:
    """Convert OrchestrationResult into AnalysisResponse dict."""
    from datetime import datetime

    snapshot = result.constraint_snapshot
    judge = result.judge_decision
    reviewer = result.reviewer_verdict
    critic = result.critic_output

    # Build supplier shortlist from judge ranking
    quantity = request.get("quantity", 1) or 1
    currency = request.get("currency", "EUR")
    incumbent = request.get("incumbent_supplier")

    # Build pricing lookup
    price_map = {}
    for p in (snapshot.pricing_info if snapshot else []):
        if p is not None:
            sid = p.get("supplier_id", "")
            if sid:
                price_map[sid] = p

    shortlist = []
    if judge and judge.final_ranking:
        for js in judge.final_ranking:
            pricing = price_map.get(js.supplier_id, {})
            unit_price = pricing.get("unit_price", 0)
            exp_price = pricing.get("expedited_unit_price", 0)

            # Find supplier info from eligible list
            sup_info = {}
            for s in (snapshot.eligible_suppliers if snapshot else []):
                if s.get("supplier_id") == js.supplier_id:
                    sup_info = s
                    break

            shortlist.append({
                "rank": js.rank,
                "supplier_id": js.supplier_id,
                "supplier_name": js.supplier_name,
                "preferred": bool(sup_info.get("preferred_supplier") or sup_info.get("is_preferred", False)),
                "incumbent": sup_info.get("supplier_name") == incumbent if incumbent else False,
                "pricing_tier_applied": f"{pricing.get('tier_min', '')}-{pricing.get('tier_max', '')} units",
                "unit_price_eur": unit_price,
                "total_price_eur": round(unit_price * quantity, 2),
                "standard_lead_time_days": pricing.get("standard_lead_time_days"),
                "expedited_lead_time_days": pricing.get("expedited_lead_time_days"),
                "expedited_unit_price_eur": exp_price,
                "expedited_total_eur": round(exp_price * quantity, 2) if exp_price else None,
                "quality_score": sup_info.get("quality_score"),
                "risk_score": sup_info.get("risk_score"),
                "esg_score": sup_info.get("esg_score"),
                "composite_score": js.composite_score,
                "currency": currency,
                "policy_compliant": True,
                "covers_delivery_country": True,
                "recommendation_note": js.justification,
            })

    # Build recommendation
    has_blocking = any(e.get("blocking", False) for e in (snapshot.escalations if snapshot else []))
    has_critical = any(v.get("severity") == "critical" for v in (snapshot.validation_issues if snapshot else []))

    if has_blocking or has_critical:
        rec_status = "cannot_proceed"
    elif snapshot and snapshot.escalations:
        rec_status = "proceed_with_conditions"
    else:
        rec_status = "can_proceed"

    top = judge.final_ranking[0] if judge and judge.final_ranking else None
    recommendation = {
        "status": rec_status,
        "reason": judge.confidence_explanation if judge else "Analysis complete.",
        "preferred_supplier_if_resolved": top.supplier_name if top else None,
        "preferred_supplier_rationale": top.justification if top else None,
        "minimum_budget_required": None,
        "minimum_budget_currency": None,
    }

    # Build governance output
    governance = None
    if critic or judge or reviewer:
        governance = {
            "critic_findings": [f.model_dump() for f in critic.findings] if critic else [],
            "judge_decision": judge.model_dump() if judge else None,
            "reviewer_verdict": reviewer.model_dump() if reviewer else None,
            "governance_memory_summary": [
                e.content for e in (result.governance_memory_entries or [])[:5]
            ],
        }

    # Build agent opinions for display
    agent_opinions = []
    for op in (result.specialist_opinions or []):
        if hasattr(op, "model_dump"):
            agent_opinions.append(op.model_dump())
        elif isinstance(op, dict):
            agent_opinions.append(op)

    # Build audit trail
    audit_trail = {
        "policies_checked": [],
        "supplier_ids_evaluated": [s.get("supplier_id", "") for s in (snapshot.eligible_suppliers if snapshot else [])],
        "data_sources_used": ["requests.json", "suppliers.csv", "pricing.csv", "policies.json", "historical_awards.csv"],
        "historical_awards_consulted": True,
    }

    # Confidence from judge
    confidence = {
        "overall_score": judge.confidence_assessment if judge else 0.5,
        "per_supplier": [],
        "explanation": judge.confidence_explanation if judge else "",
        "factors": judge.bias_checks if judge else [],
    }

    # Build excluded list
    excluded = [
        {
            "supplier_id": e.get("supplier_id", ""),
            "supplier_name": e.get("supplier_name", ""),
            "reason": e.get("exclusion_reason", "Excluded by filter"),
        }
        for e in (snapshot.excluded_suppliers if snapshot else [])
    ]

    # Build escalation list
    escalation_list = [
        {
            "escalation_id": e.get("escalation_id", ""),
            "rule": e.get("rule"),
            "trigger": e.get("trigger"),
            "escalate_to": e.get("escalate_to"),
            "blocking": e.get("blocking", False),
            "source": e.get("source", "deterministic"),
        }
        for e in (snapshot.escalations if snapshot else [])
    ]

    # Build approval routing
    approval_steps = []
    if snapshot:
        approval = snapshot.policy_evaluation.get("approval_threshold") or {}
        managed_by = approval.get("managed_by", [])
        for role in (managed_by if isinstance(managed_by, list) else [managed_by] if managed_by else []):
            approval_steps.append({"step": len(approval_steps) + 1, "role": str(role), "required": True, "status": "pending"})
        for esc in snapshot.escalations:
            target = esc.get("escalate_to", "")
            if target and target not in [s.get("role") for s in approval_steps]:
                approval_steps.append({
                    "step": len(approval_steps) + 1,
                    "role": target,
                    "required": esc.get("blocking", False),
                    "status": "escalation_required",
                })

    # Process trace
    process_trace = None
    if result.process_trace:
        process_trace = result.process_trace.model_dump()

    response = {
        "request_id": request.get("request_id", "UNKNOWN"),
        "processed_at": datetime.utcnow().isoformat() + "Z",
        "request_interpretation": _build_request_interpretation(request),
        "validation": {
            "completeness": "fail" if has_critical else "pass",
            "issues_detected": snapshot.validation_issues if snapshot else [],
        },
        "policy_evaluation": _build_policy_evaluation_dict(snapshot.policy_evaluation) if snapshot else {},
        "supplier_shortlist": shortlist,
        "suppliers_excluded": excluded,
        "escalations": escalation_list,
        "recommendation": recommendation,
        "audit_trail": audit_trail,
        "agent_opinions": agent_opinions,
        "confidence": confidence,
        "dynamic_weights": {
            "base_weights": {"price": 0.30, "quality": 0.20, "risk": 0.15, "esg": 0.10, "lead_time": 0.10, "preferred": 0.10, "incumbent": 0.05},
            "adjusted_weights": {},
            "adjustments": [],
        },
        "approval_routing": {"steps": approval_steps},
        # New universal orchestration fields
        "governance": governance,
        "process_trace": process_trace,
        "activated_modules": result.activation_plan.activated_modules if result.activation_plan else [],
        "discovery_result": result.discovery_result.model_dump() if result.discovery_result else None,
        "bundle_result": result.bundle_result.model_dump() if result.bundle_result else None,
    }

    return response


# ---------------------------------------------------------------------------
# Deterministic fallback
# ---------------------------------------------------------------------------

async def _deterministic_fallback(
    request: dict[str, Any],
    data: Any,
) -> dict[str, Any]:
    """Minimal deterministic-only fallback when orchestration completely fails."""
    from backend.services.rule_engine import validate_request, evaluate_policies
    from backend.services.supplier_filter import filter_suppliers, get_pricing_for_supplier
    from backend.services.escalation import check_escalations

    category_l1 = request.get("category_l1", "")
    category_l2 = request.get("category_l2", "")
    quantity = request.get("quantity") or 0
    delivery_countries = request.get("delivery_countries", [])
    delivery_country = delivery_countries[0] if delivery_countries else request.get("country", "")

    eligible, excluded = filter_suppliers(request, data.suppliers, data.pricing, data.policies)
    pricing_info = []
    for sup in eligible:
        p = get_pricing_for_supplier(sup["supplier_id"], category_l1, category_l2, delivery_country, quantity if quantity > 0 else 1, data.pricing)
        pricing_info.append(p)

    validation_issues = validate_request(request, data.suppliers, data.pricing)
    contract_value = 0.0
    cheapest = None
    for p in pricing_info:
        if p and p.get("unit_price"):
            if cheapest is None or p["unit_price"] < cheapest:
                cheapest = p["unit_price"]
    if cheapest and quantity:
        contract_value = cheapest * quantity
    if contract_value == 0.0 and request.get("budget_amount"):
        contract_value = float(request["budget_amount"])

    policy_eval = evaluate_policies(request, contract_value, eligible, data.policies)
    escalations = check_escalations(request, validation_issues, policy_eval, eligible, pricing_info)

    has_blocking = any(e.get("blocking", False) for e in escalations)
    has_critical = any(v.get("severity") == "critical" for v in validation_issues)

    # Simple cheapest-first ranking
    scored = []
    for i, sup in enumerate(eligible):
        p = pricing_info[i] if i < len(pricing_info) else None
        total = p["total"] if p else float("inf")
        scored.append((total, sup, p))
    scored.sort(key=lambda x: x[0])

    currency = request.get("currency", "EUR")
    shortlist = []
    for rank, (total, sup, pricing) in enumerate(scored, 1):
        shortlist.append({
            "rank": rank,
            "supplier_id": sup["supplier_id"],
            "supplier_name": sup.get("supplier_name", ""),
            "preferred": bool(sup.get("preferred_supplier", False)),
            "incumbent": False,
            "unit_price_eur": pricing.get("unit_price", 0) if pricing else 0,
            "total_price_eur": total if total != float("inf") else 0,
            "quality_score": sup.get("quality_score"),
            "risk_score": sup.get("risk_score"),
            "esg_score": sup.get("esg_score"),
            "currency": currency,
            "policy_compliant": True,
            "covers_delivery_country": True,
            "recommendation_note": "Deterministic fallback — orchestration unavailable.",
        })

    return {
        "request_id": request.get("request_id", "UNKNOWN"),
        "processed_at": datetime.utcnow().isoformat() + "Z",
        "request_interpretation": _build_request_interpretation(request),
        "validation": {"completeness": "fail" if has_critical else "pass", "issues_detected": validation_issues},
        "policy_evaluation": _build_policy_evaluation_dict(policy_eval),
        "supplier_shortlist": shortlist,
        "suppliers_excluded": _build_excluded_list(excluded),
        "escalations": _build_escalation_list(escalations),
        "recommendation": {
            "status": "cannot_proceed" if (has_blocking or has_critical) else "proceed_with_conditions" if escalations else "can_proceed",
            "reason": "Deterministic fallback — full orchestration was unavailable.",
        },
        "audit_trail": {"policies_checked": [], "supplier_ids_evaluated": [s["supplier_id"] for s in eligible], "data_sources_used": ["suppliers.csv", "pricing.csv", "policies.json"], "historical_awards_consulted": False},
        "agent_opinions": [],
        "confidence": {"overall_score": 0.2, "per_supplier": [], "explanation": "Low confidence: orchestration failed, deterministic fallback used.", "factors": ["Orchestration failure"]},
        "dynamic_weights": None,
        "approval_routing": {"steps": []},
        "governance": None,
        "process_trace": None,
        "activated_modules": [],
        "discovery_result": None,
        "bundle_result": None,
    }
