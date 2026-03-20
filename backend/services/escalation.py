"""
Escalation engine for procurement sourcing agent.
Deterministically checks 8 escalation rules and returns triggered escalations.
"""

from datetime import datetime, date


# High-value threshold IDs that trigger ER-003
HIGH_VALUE_THRESHOLD_IDS = {"AT-004", "AT-005", "AT-009", "AT-010", "AT-014", "AT-015"}


def _parse_date(d):
    """Parse a date string or return a date object as-is."""
    if d is None:
        return None
    if isinstance(d, date):
        return d
    if isinstance(d, datetime):
        return d.date()
    try:
        return datetime.fromisoformat(d.replace("Z", "+00:00")).date()
    except (ValueError, AttributeError):
        try:
            return datetime.strptime(d, "%Y-%m-%d").date()
        except (ValueError, AttributeError):
            return None


def check_escalations(request, validation_issues, policy_eval, eligible_suppliers,
                      pricing_info):
    """
    Check all 8 escalation rules and return triggered escalations.

    Args:
        request: dict with request fields
        validation_issues: list of validation issue dicts (from rule_engine.validate_request)
        policy_eval: dict (from rule_engine.evaluate_policies) with keys:
            approval_threshold, preferred_supplier, restricted_suppliers,
            category_rules, geography_rules
        eligible_suppliers: list of eligible supplier dicts (from supplier_filter.filter_suppliers)
        pricing_info: list of pricing dicts for eligible suppliers
            (from supplier_filter.get_pricing_for_supplier), one per supplier.
            Each dict has: supplier_id, unit_price, total, expedited_lead_time_days,
            standard_lead_time_days, etc.

    Returns:
        list of escalation dicts, each with:
            escalation_id, rule, trigger, escalate_to, blocking
    """
    escalations = []
    esc_counter = 0

    # --- ER-001: Missing required info OR budget insufficient ---
    budget = request.get("budget_amount")
    quantity = request.get("quantity")
    missing_fields = []
    if budget is None or budget == 0:
        missing_fields.append("budget")
    if quantity is None or quantity == 0:
        missing_fields.append("quantity")
    if not request.get("category_l1"):
        missing_fields.append("category")

    if missing_fields:
        esc_counter += 1
        escalations.append({
            "escalation_id": f"ESC-{esc_counter:03d}",
            "rule": "ER-001",
            "trigger": (
                f"Missing required information: {', '.join(missing_fields)}. "
                f"Cannot proceed with sourcing until this information is provided."
            ),
            "escalate_to": "Requester Clarification",
            "blocking": True,
            "source": "deterministic",
        })

    # Also trigger ER-001 for budget_insufficient (requester must clarify budget/quantity)
    budget_issues = [v for v in validation_issues if v.get("type") == "budget_insufficient"]
    if budget_issues and not missing_fields:
        esc_counter += 1
        escalations.append({
            "escalation_id": f"ESC-{esc_counter:03d}",
            "rule": "ER-001",
            "trigger": budget_issues[0].get("description", "Budget is insufficient to fulfil the stated quantity."),
            "escalate_to": "Requester Clarification",
            "blocking": True,
            "source": "deterministic",
        })

    # --- ER-001b: Policy conflict (requester instruction conflicts with threshold) ---
    approval_threshold_data = policy_eval.get("approval_threshold") or {}
    quotes_required = approval_threshold_data.get("quotes_required", 1)
    request_text = request.get("request_text", "").lower()
    preferred_name = request.get("preferred_supplier_mentioned", "")

    # Detect single-supplier instruction conflicting with multi-quote requirement
    single_supplier_instruction = any(phrase in request_text for phrase in [
        "no exception", "single supplier", "only use", "must use", "exclusively"
    ])
    if single_supplier_instruction and quotes_required and quotes_required > 1:
        threshold_id = approval_threshold_data.get("threshold_id", "")
        esc_counter += 1
        escalations.append({
            "escalation_id": f"ESC-{esc_counter:03d}",
            "rule": threshold_id,
            "trigger": (
                f"Policy conflict: requester instruction conflicts with {threshold_id}. "
                f"Contract value requires {quotes_required} quotes and deviation requires "
                f"{', '.join(approval_threshold_data.get('deviation_approval', ['approval']))}."
            ),
            "escalate_to": approval_threshold_data.get("deviation_approval", ["Procurement Manager"])[0] if approval_threshold_data.get("deviation_approval") else "Procurement Manager",
            "blocking": True,
            "source": "deterministic",
        })

    # --- ER-002: Preferred supplier is restricted ---
    preferred_eval = policy_eval.get("preferred_supplier", {})
    restricted_eval = policy_eval.get("restricted_suppliers", {})

    if preferred_eval.get("mentioned") and preferred_eval.get("supplier_id"):
        pref_sup_id = preferred_eval["supplier_id"]
        restricted_info = restricted_eval.get(pref_sup_id, {})
        if restricted_info.get("restricted"):
            esc_counter += 1
            escalations.append({
                "escalation_id": f"ESC-{esc_counter:03d}",
                "rule": "ER-002",
                "trigger": (
                    f"Preferred supplier {preferred_eval.get('supplier_name', pref_sup_id)} "
                    f"is restricted: {restricted_info.get('restriction_reason', 'Policy restriction')}. "
                    f"Procurement Manager review required."
                ),
                "escalate_to": "Procurement Manager",
                "blocking": True,
                "source": "deterministic",
            })

    # --- ER-003: Value exceeds high threshold (>=500K EUR/CHF or >=540K USD) ---
    approval_threshold = policy_eval.get("approval_threshold", {})
    if approval_threshold:
        threshold_id = approval_threshold.get("threshold_id", "")
        if threshold_id in HIGH_VALUE_THRESHOLD_IDS:
            currency = request.get("currency", "EUR")
            esc_counter += 1
            escalations.append({
                "escalation_id": f"ESC-{esc_counter:03d}",
                "rule": "ER-003",
                "trigger": (
                    f"Contract value triggers high-value threshold {threshold_id} "
                    f"({currency}). Head of Strategic Sourcing approval required."
                ),
                "escalate_to": "Head of Strategic Sourcing",
                "blocking": False,
                "source": "deterministic",
            })

    # --- ER-004: No compliant supplier found OR lead time infeasible for all ---
    no_supplier = len(eligible_suppliers) == 0

    # Check if lead time is infeasible for ALL eligible suppliers
    lead_time_infeasible_all = False
    required_by = request.get("required_by_date")
    created_at = request.get("created_at")

    if eligible_suppliers and required_by and pricing_info:
        required_date = _parse_date(required_by)
        created_date = _parse_date(created_at) if created_at else date.today()
        if created_date is None:
            created_date = date.today()

        if required_date:
            days_available = (required_date - created_date).days
            if days_available > 0:
                # Check if ANY supplier can meet the lead time
                any_can_meet = False
                for pi in pricing_info:
                    if pi is None:
                        continue
                    exp_lt = pi.get("expedited_lead_time_days")
                    if exp_lt is not None and exp_lt <= days_available:
                        any_can_meet = True
                        break
                if not any_can_meet:
                    lead_time_infeasible_all = True

    if no_supplier or lead_time_infeasible_all:
        trigger_parts = []
        if no_supplier:
            trigger_parts.append(
                "No compliant supplier found matching all requirements "
                "(category, delivery country, contract status, restrictions, data residency)."
            )
        if lead_time_infeasible_all:
            trigger_parts.append(
                f"Lead time infeasible: required delivery by {required_by} "
                f"cannot be met by any eligible supplier's expedited lead time."
            )
        esc_counter += 1
        escalations.append({
            "escalation_id": f"ESC-{esc_counter:03d}",
            "rule": "ER-004",
            "trigger": " ".join(trigger_parts),
            "escalate_to": "Head of Category",
            "blocking": True,
            "source": "deterministic",
        })

    # --- ER-005: Data residency required but no supplier supports it ---
    data_residency_required = request.get("data_residency_constraint", False)
    if data_residency_required:
        any_supports_dr = False
        for sup in eligible_suppliers:
            if sup.get("data_residency_supported"):
                any_supports_dr = True
                break
        if not any_supports_dr:
            esc_counter += 1
            escalations.append({
                "escalation_id": f"ESC-{esc_counter:03d}",
                "rule": "ER-005",
                "trigger": (
                    "Data residency is required but no eligible supplier supports it. "
                    "Security and Compliance review needed before proceeding."
                ),
                "escalate_to": "Security and Compliance Review",
                "blocking": True,
                "source": "deterministic",
            })

    # --- ER-006: Quantity exceeds all eligible suppliers' capacity_per_month ---
    if quantity is not None and quantity > 0 and eligible_suppliers:
        all_over_capacity = True
        for sup in eligible_suppliers:
            cap = sup.get("capacity_per_month")
            if cap is not None and quantity <= cap:
                all_over_capacity = False
                break
        if all_over_capacity:
            esc_counter += 1
            escalations.append({
                "escalation_id": f"ESC-{esc_counter:03d}",
                "rule": "ER-006",
                "trigger": (
                    f"Requested quantity ({quantity}) exceeds the monthly capacity of "
                    f"all eligible suppliers. Multi-supplier or phased delivery strategy "
                    f"may be required."
                ),
                "escalate_to": "Sourcing Excellence Lead",
                "blocking": False,
                "source": "deterministic",
            })

    # --- ER-007: Category is Marketing / Influencer Campaign Management ---
    category_l1 = request.get("category_l1")
    category_l2 = request.get("category_l2")
    if category_l1 == "Marketing" and category_l2 == "Influencer Campaign Management":
        esc_counter += 1
        escalations.append({
            "escalation_id": f"ESC-{esc_counter:03d}",
            "rule": "ER-007",
            "trigger": (
                "Influencer Campaign Management category requires brand safety review "
                "before final award."
            ),
            "escalate_to": "Marketing Governance Lead",
            "blocking": False,
            "source": "deterministic",
        })

    # --- ER-008: USD currency request where supplier doesn't cover delivery country ---
    currency = request.get("currency", "EUR")
    delivery_countries = request.get("delivery_countries", [])

    if currency == "USD" and eligible_suppliers and delivery_countries:
        for sup in eligible_suppliers:
            service_regions = sup.get("service_regions", [])
            if isinstance(service_regions, str):
                service_regions = service_regions.split(";")
            for country in delivery_countries:
                if country not in service_regions:
                    esc_counter += 1
                    escalations.append({
                        "escalation_id": f"ESC-{esc_counter:03d}",
                        "rule": "ER-008",
                        "trigger": (
                            f"Supplier {sup.get('supplier_name', sup.get('supplier_id'))} "
                            f"is not registered in delivery country {country}. "
                            f"Regional compliance verification required for USD transactions."
                        ),
                        "escalate_to": "Regional Compliance Lead",
                        "blocking": False,
                        "source": "deterministic",
                    })

    # --- ER-011: Whitespace — category not in taxonomy ---
    is_whitespace = request.get("is_whitespace", False)
    if is_whitespace or (request.get("category_l1") is None and request.get("category_l2") is None):
        esc_counter += 1
        escalations.append({
            "escalation_id": f"ESC-{esc_counter:03d}",
            "rule": "ER-011",
            "trigger": (
                "Category not in taxonomy — unmet demand (whitespace). "
                "No valid category match found for this procurement request."
            ),
            "escalate_to": "Category Manager / Discovery",
            "blocking": True,
            "source": "deterministic",
        })

    # --- ER-012: Only expedited delivery meets required-by date ---
    if eligible_suppliers and required_by and pricing_info and not lead_time_infeasible_all and not no_supplier:
        required_date = _parse_date(required_by)
        created_date = _parse_date(request.get("created_at")) if request.get("created_at") else date.today()
        if created_date is None:
            created_date = date.today()
        if required_date:
            days_available = (required_date - created_date).days
            if days_available > 0:
                any_standard_meets = False
                any_expedited_meets = False
                for pi in pricing_info:
                    if pi is None:
                        continue
                    std_lt = pi.get("standard_lead_time_days")
                    exp_lt = pi.get("expedited_lead_time_days")
                    if std_lt is not None and std_lt <= days_available:
                        any_standard_meets = True
                    if exp_lt is not None and exp_lt <= days_available:
                        any_expedited_meets = True
                if any_expedited_meets and not any_standard_meets:
                    esc_counter += 1
                    escalations.append({
                        "escalation_id": f"ESC-{esc_counter:03d}",
                        "rule": "ER-012",
                        "trigger": (
                            "Only expedited delivery can meet the required-by date. "
                            "No supplier's standard lead time is sufficient within the available window."
                        ),
                        "escalate_to": "Procurement Manager",
                        "blocking": False,
                        "source": "deterministic",
                    })

    # --- ER-009: Bundle capacity exceeded (triggered by bundling module) ---
    # This is a placeholder — the actual trigger comes from the bundling module
    # which injects this escalation when bundled demand exceeds all suppliers' capacity.
    # See bundling_module.py for the trigger logic.

    # --- ER-010: Critic high-severity finding ---
    # This is injected by the supervisor after the critic runs.
    # Not checked here because critic hasn't run yet at escalation time.

    return escalations
