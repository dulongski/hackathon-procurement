"""
Pipeline orchestration for procurement sourcing agent.
Main entry point that coordinates all analysis steps.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, date
from typing import Any

from backend.data_loader import get_data
from backend.services.extractor import extract_requirements
from backend.services.explainer import generate_explanation
from backend.services.rule_engine import validate_request, evaluate_policies
from backend.services.supplier_filter import filter_suppliers, get_pricing_for_supplier
from backend.services.escalation import check_escalations

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lazy imports for modules that may not exist yet
# ---------------------------------------------------------------------------

def _import_orchestrator():
    """Import orchestrator module, returning (run_agents, merge_results) or stubs."""
    try:
        from backend.services.orchestrator import run_agents, merge_results
        return run_agents, merge_results
    except Exception as e:
        logger.warning("orchestrator module not available (%s); using stubs", e)

        async def run_agents_stub(*args, **kwargs) -> list:
            return []

        def merge_results_stub(*args, **kwargs):
            return [], None

        return run_agents_stub, merge_results_stub


def _import_confidence():
    """Import confidence module, returning compute_confidence or a stub."""
    try:
        from backend.services.confidence import compute_confidence
        return compute_confidence
    except Exception as e:
        logger.warning("confidence module not available (%s); using stub", e)

        def compute_confidence_stub(*args, **kwargs) -> dict:
            return {
                "overall_score": 0.5,
                "per_supplier": [],
                "explanation": "Confidence module not available.",
                "factors": [],
            }

        return compute_confidence_stub


# ---------------------------------------------------------------------------
# Default ranking when orchestrator is unavailable
# ---------------------------------------------------------------------------

def _default_rank_suppliers(
    eligible_suppliers: list[dict[str, Any]],
    pricing_info: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Simple ranking by total price (cheapest first) when orchestrator/agents
    are not available.
    """
    # Build a price map: supplier_id -> pricing dict
    price_map: dict[str, dict] = {}
    for p in pricing_info:
        if p is not None:
            price_map[p["supplier_id"]] = p

    # Score each supplier
    scored: list[tuple[float, dict, dict | None]] = []
    for sup in eligible_suppliers:
        sid = sup["supplier_id"]
        pricing = price_map.get(sid)
        total = pricing["total"] if pricing else float("inf")
        scored.append((total, sup, pricing))

    scored.sort(key=lambda x: x[0])

    ranked = []
    for rank, (total, sup, pricing) in enumerate(scored, start=1):
        item: dict[str, Any] = {
            "rank": rank,
            "supplier_id": sup["supplier_id"],
            "supplier_name": sup.get("supplier_name", ""),
            "preferred": sup.get("preferred_supplier", False),
            "incumbent": False,
            "quality_score": sup.get("quality_score"),
            "risk_score": sup.get("risk_score"),
            "esg_score": sup.get("esg_score"),
            "policy_compliant": True,
            "covers_delivery_country": True,
        }
        if pricing:
            item.update({
                "pricing_tier_applied": (
                    f"{pricing.get('tier_min', '')}-{pricing.get('tier_max', '')}"
                ),
                "unit_price_eur": pricing.get("unit_price"),
                "total_price_eur": pricing.get("total"),
                "standard_lead_time_days": pricing.get("standard_lead_time_days"),
                "expedited_lead_time_days": pricing.get("expedited_lead_time_days"),
                "expedited_unit_price_eur": pricing.get("expedited_unit_price"),
                "expedited_total_eur": pricing.get("expedited_total"),
            })
        ranked.append(item)

    return ranked


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_contract_value(
    eligible_suppliers: list[dict],
    pricing_info: list[dict],
    quantity: float | None,
) -> float:
    """
    Compute the actual contract value as cheapest_price * quantity.
    Falls back to 0 if no pricing or quantity is available.
    """
    if not quantity or quantity <= 0:
        return 0.0

    cheapest_unit: float | None = None
    for p in pricing_info:
        if p is None:
            continue
        up = p.get("unit_price")
        if up is not None and (cheapest_unit is None or up < cheapest_unit):
            cheapest_unit = up

    if cheapest_unit is not None:
        return cheapest_unit * quantity
    return 0.0


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


def _build_agent_opinions(agent_results: list) -> list[dict]:
    """Convert agent results (AgentOpinion models or dicts) into dicts for JSON response."""
    opinions = []
    for ar in agent_results:
        if hasattr(ar, 'model_dump'):
            opinions.append(ar.model_dump())
        elif hasattr(ar, 'dict'):
            opinions.append(ar.dict())
        elif isinstance(ar, dict):
            rankings = []
            for sr in ar.get("supplier_rankings", []):
                rankings.append({
                    "supplier_id": sr.get("id", sr.get("supplier_id", "")),
                    "supplier_name": sr.get("supplier_name", sr.get("name", "")),
                    "score": sr.get("score", 50),
                    "rationale": sr.get("reasoning", sr.get("rationale", "")),
                })
            opinions.append({
                "agent_name": ar.get("agent_name", "unknown"),
                "opinion_summary": ar.get("insights", ar.get("opinion_summary", "")),
                "supplier_rankings": rankings,
                "confidence": ar.get("confidence"),
                "key_factors": ar.get("key_factors", []),
            })
    return opinions


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
    run_agents, merge_results = _import_orchestrator()
    compute_confidence = _import_confidence()

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


async def _run_pipeline(
    request: dict[str, Any],
    data: Any,
) -> dict[str, Any]:
    """
    Core pipeline logic shared by analyze_request and analyze_custom.

    Steps:
        3. Filter suppliers
        4. Get pricing for each eligible supplier
        5. Run validation
        6. Evaluate policies (using actual contract value)
        7. Check escalations
        8. Run agents in parallel
        9. Merge results (rank suppliers)
        10. Compute confidence
        11. Generate explanation
        12. Assemble AnalysisResponse
    """
    run_agents, merge_results = _import_orchestrator()
    compute_confidence = _import_confidence()

    request_id = request.get("request_id", "UNKNOWN")
    category_l1 = request.get("category_l1", "")
    category_l2 = request.get("category_l2", "")
    quantity = request.get("quantity") or 0
    delivery_countries = request.get("delivery_countries", [])
    delivery_country = delivery_countries[0] if delivery_countries else request.get("country", "")

    # --- Step 3: Filter suppliers ---
    eligible, excluded = filter_suppliers(
        request, data.suppliers, data.pricing, data.policies
    )

    # --- Step 4: Get pricing for each eligible supplier ---
    pricing_info: list[dict | None] = []
    for sup in eligible:
        pricing = get_pricing_for_supplier(
            sup["supplier_id"],
            category_l1,
            category_l2,
            delivery_country,
            quantity if quantity > 0 else 1,
            data.pricing,
        )
        pricing_info.append(pricing)

    # --- Step 5: Validate request ---
    validation_issues = validate_request(request, data.suppliers, data.pricing)

    # --- Step 6: Evaluate policies using actual contract value ---
    contract_value = _compute_contract_value(eligible, pricing_info, quantity)
    # Fall back to stated budget if no pricing available
    if contract_value == 0.0 and request.get("budget_amount"):
        contract_value = float(request["budget_amount"])

    policy_eval = evaluate_policies(
        request, contract_value, eligible, data.policies
    )

    # --- Step 7: Check escalations ---
    escalations = check_escalations(
        request, validation_issues, policy_eval, eligible, pricing_info
    )

    # --- Step 8: Run agents in parallel ---
    # Check if the request has an incumbent supplier; mark it on eligible suppliers
    incumbent_name = request.get("incumbent_supplier")
    for sup in eligible:
        sup["is_incumbent"] = (
            sup.get("supplier_name") == incumbent_name if incumbent_name else False
        )
        sup["is_preferred"] = sup.get("preferred_supplier", False)

    try:
        agent_results = await run_agents(
            request, eligible, pricing_info,
            data.historical_awards, data.policies
        )
    except Exception:
        logger.exception("Agent execution failed for %s", request_id)
        agent_results = []

    # --- Step 9: Merge results (rank suppliers) ---
    dynamic_weights_result = None
    try:
        merge_output = merge_results(
            eligible, pricing_info, agent_results, request
        )
        if isinstance(merge_output, tuple):
            ranked_suppliers, dynamic_weights_result = merge_output
        else:
            ranked_suppliers = merge_output
    except Exception:
        logger.exception("merge_results failed for %s; using default ranking", request_id)
        ranked_suppliers = _default_rank_suppliers(eligible, pricing_info)

    # --- Step 10: Compute confidence ---
    # agent_results may be AgentOpinion models or dicts
    agent_opinions_for_display = _build_agent_opinions(agent_results) if agent_results else []
    try:
        confidence_result = compute_confidence(
            agent_results, validation_issues, eligible, request
        )
        # Convert Pydantic model to dict if needed
        if hasattr(confidence_result, 'model_dump'):
            confidence_result = confidence_result.model_dump()
        elif hasattr(confidence_result, 'dict'):
            confidence_result = confidence_result.dict()
    except Exception:
        logger.exception("Confidence computation failed for %s", request_id)
        confidence_result = {
            "overall_score": 0.5,
            "per_supplier": [],
            "explanation": "Confidence computation failed.",
            "factors": [],
        }

    # --- Step 11: Generate explanation ---
    try:
        explanation = generate_explanation(
            request,
            validation_issues,
            policy_eval,
            ranked_suppliers,
            escalations,
            agent_opinions_for_display,
            confidence_result,
        )
    except Exception:
        logger.exception("Explanation generation failed for %s", request_id)
        explanation = {
            "recommendation": {
                "status": "cannot_proceed",
                "reason": "Explanation generation failed.",
            },
            "audit_trail": {
                "policies_checked": [],
                "supplier_ids_evaluated": [
                    s.get("supplier_id", "") for s in ranked_suppliers
                ],
                "data_sources_used": [],
                "historical_awards_consulted": False,
            },
            "per_supplier_explanations": [],
            "explanation_map": {},
        }

    # Enrich ranked suppliers with recommendation notes from explanation
    explanation_map = explanation.get("explanation_map", {})
    for sup in ranked_suppliers:
        sid = sup.get("supplier_id", "")
        if sid in explanation_map:
            sup["recommendation_note"] = explanation_map[sid].get(
                "recommendation_note", ""
            )

    # Build supplier shortlist in proper format
    shortlist = _build_supplier_shortlist(ranked_suppliers, request, pricing_info)

    # --- Step 12: Assemble AnalysisResponse ---
    validation_dict = {
        "completeness": (
            "fail" if any(v.get("severity") == "critical" for v in validation_issues)
            else "pass"
        ),
        "issues_detected": validation_issues,
    }

    # Convert agent opinions to dicts if they are Pydantic models
    agent_opinions_dicts = []
    for ao in agent_opinions_for_display:
        if hasattr(ao, 'model_dump'):
            agent_opinions_dicts.append(ao.model_dump())
        elif isinstance(ao, dict):
            agent_opinions_dicts.append(ao)
        else:
            agent_opinions_dicts.append(ao)

    # Convert dynamic weights to dict if Pydantic
    dw_dict = None
    if dynamic_weights_result is not None:
        if hasattr(dynamic_weights_result, 'model_dump'):
            dw_dict = dynamic_weights_result.model_dump()
        elif isinstance(dynamic_weights_result, dict):
            dw_dict = dynamic_weights_result
        else:
            dw_dict = dynamic_weights_result

    response: dict[str, Any] = {
        "request_id": request_id,
        "processed_at": datetime.utcnow().isoformat() + "Z",
        "request_interpretation": _build_request_interpretation(request),
        "validation": validation_dict,
        "policy_evaluation": _build_policy_evaluation_dict(policy_eval),
        "supplier_shortlist": shortlist,
        "suppliers_excluded": _build_excluded_list(excluded),
        "escalations": _build_escalation_list(escalations),
        "recommendation": explanation.get("recommendation", {}),
        "audit_trail": explanation.get("audit_trail", {}),
        "agent_opinions": agent_opinions_dicts,
        "confidence": confidence_result,
        "dynamic_weights": dw_dict,
        "approval_routing": _build_approval_routing(escalations, policy_eval),
    }

    return response


def _build_supplier_shortlist(
    ranked_suppliers: list[dict],
    request: dict,
    pricing_info: list[dict],
) -> list[dict]:
    """Convert ranked suppliers into the shortlist format matching example output."""
    quantity = request.get("quantity", 1) or 1
    currency = request.get("currency", "EUR")
    incumbent = request.get("incumbent_supplier")

    # Build pricing lookup
    price_map = {}
    for p in pricing_info:
        if p is not None:
            sid = p.get("supplier_id", "")
            if sid:
                price_map[sid] = p

    shortlist = []
    for rank_idx, sup in enumerate(ranked_suppliers, 1):
        sid = sup.get("supplier_id", "")
        pricing = price_map.get(sid, {})

        unit_price = pricing.get("unit_price", sup.get("unit_price_eur", 0))
        exp_price = pricing.get("expedited_unit_price", sup.get("expedited_unit_price_eur", 0))

        item = {
            "rank": rank_idx,
            "supplier_id": sid,
            "supplier_name": sup.get("supplier_name", ""),
            "preferred": bool(sup.get("preferred_supplier") or sup.get("is_preferred", False)),
            "incumbent": sup.get("supplier_name") == incumbent if incumbent else False,
            "pricing_tier_applied": f"{pricing.get('tier_min', pricing.get('min_quantity', ''))}-{pricing.get('tier_max', pricing.get('max_quantity', ''))} units",
            "unit_price_eur": unit_price,
            "total_price_eur": round(unit_price * quantity, 2),
            "standard_lead_time_days": pricing.get("standard_lead_time_days", sup.get("lead_time_days")),
            "expedited_lead_time_days": pricing.get("expedited_lead_time_days"),
            "expedited_unit_price_eur": exp_price,
            "expedited_total_eur": round(exp_price * quantity, 2) if exp_price else None,
            "quality_score": sup.get("quality_score"),
            "risk_score": sup.get("risk_score"),
            "esg_score": sup.get("esg_score"),
            "composite_score": sup.get("composite_score"),
            "currency": currency,
            "policy_compliant": True,
            "covers_delivery_country": True,
            "recommendation_note": sup.get("recommendation_note", ""),
        }
        shortlist.append(item)

    return shortlist


def _build_approval_routing(escalations: list[dict], policy_eval: dict) -> dict:
    """Build simulated approval routing based on escalations and policy."""
    steps = []
    approval = policy_eval.get("approval_threshold") or {}
    managed_by = approval.get("managed_by", [])

    for role in managed_by:
        steps.append({
            "step": len(steps) + 1,
            "role": role.replace("_", " ").title(),
            "required": True,
            "status": "pending",
        })

    for esc in escalations:
        target = esc.get("escalate_to", "")
        if target and target not in [s.get("role") for s in steps]:
            steps.append({
                "step": len(steps) + 1,
                "role": target,
                "required": esc.get("blocking", False),
                "status": "escalation_required",
            })

    deviation = approval.get("deviation_approval", [])
    if isinstance(deviation, str):
        deviation = [deviation] if deviation else []
    for role in deviation:
        if role and role not in [s.get("role") for s in steps]:
            steps.append({
                "step": len(steps) + 1,
                "role": role,
                "required": True,
                "status": "pending",
            })

    return {"steps": steps}
