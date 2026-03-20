"""
Rule engine for procurement sourcing agent.
Handles request validation and policy evaluation.
"""

import re
from datetime import datetime, date


# Country-to-region mapping
COUNTRY_TO_REGION = {
    "DE": "EU", "FR": "EU", "NL": "EU", "BE": "EU", "AT": "EU",
    "IT": "EU", "ES": "EU", "PL": "EU", "UK": "EU", "CH": "EU",
    "US": "Americas", "CA": "Americas", "BR": "Americas", "MX": "Americas",
    "SG": "APAC", "AU": "APAC", "IN": "APAC", "JP": "APAC",
    "UAE": "MEA", "ZA": "MEA",
}

# EU countries list (for preferred supplier region matching)
EU_COUNTRIES = {"DE", "FR", "NL", "BE", "AT", "IT", "ES", "PL", "UK", "CH"}


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


def _extract_numbers_from_text(text):
    """Extract all numbers from free text (handles formats like 400,000 or 400000 or 400 000)."""
    if not text:
        return []
    # Match numbers with optional commas/spaces/dots as thousand separators
    patterns = re.findall(r'[\d][\d\s,\.]*[\d]|[\d]+', text)
    results = []
    for p in patterns:
        # Remove spaces and commas used as thousand separators
        cleaned = p.replace(" ", "").replace(",", "")
        # Handle European decimal notation: if there's a single dot followed by
        # exactly 2 digits at end and no other dots, treat as decimal
        # Otherwise dots are thousand separators
        dot_parts = cleaned.split(".")
        if len(dot_parts) == 2 and len(dot_parts[1]) <= 2:
            # Likely a decimal number like 25199.55
            try:
                results.append(float(cleaned))
            except ValueError:
                pass
        else:
            # Remove dots as thousand separators
            cleaned = cleaned.replace(".", "")
            try:
                results.append(float(cleaned))
            except ValueError:
                pass
    return results


def validate_request(request, suppliers_data, pricing_data):
    """
    Validate a procurement request for completeness and feasibility.

    Args:
        request: dict with request fields (from requests.json)
        suppliers_data: list of dicts (from suppliers.csv)
        pricing_data: list of dicts (from pricing.csv)

    Returns:
        list of dicts, each representing a validation issue with keys:
            issue_id, severity, type, description, action_required
    """
    issues = []
    issue_counter = 0

    budget = request.get("budget_amount")
    quantity = request.get("quantity")
    currency = request.get("currency", "EUR")
    category_l1 = request.get("category_l1")
    category_l2 = request.get("category_l2")
    delivery_countries = request.get("delivery_countries", [])
    required_by = request.get("required_by_date")
    request_text = request.get("request_text", "")
    created_at = request.get("created_at")

    # --- Missing info checks ---
    if budget is None or budget == 0:
        issue_counter += 1
        issues.append({
            "issue_id": f"V-{issue_counter:03d}",
            "severity": "critical",
            "type": "missing_budget",
            "description": "Budget amount is missing or zero. Cannot evaluate procurement feasibility.",
            "action_required": "Requester must provide a valid budget amount.",
        })

    if quantity is None or quantity == 0:
        issue_counter += 1
        issues.append({
            "issue_id": f"V-{issue_counter:03d}",
            "severity": "critical",
            "type": "missing_quantity",
            "description": "Quantity is missing or zero. Cannot evaluate procurement feasibility.",
            "action_required": "Requester must provide a valid quantity.",
        })

    # --- Missing category check ---
    if not category_l1 or category_l1 == "":
        issue_counter += 1
        issues.append({
            "issue_id": f"V-{issue_counter:03d}",
            "severity": "critical",
            "type": "missing_category",
            "description": "Category is missing. Cannot route or evaluate procurement request.",
            "action_required": "Requester must specify a procurement category.",
        })

    # --- Missing delivery countries check ---
    if not delivery_countries:
        issue_counter += 1
        issues.append({
            "issue_id": f"V-{issue_counter:03d}",
            "severity": "high",
            "type": "missing_delivery_countries",
            "description": "Delivery countries not specified. Supplier filtering and compliance checks may be incomplete.",
            "action_required": "Requester should specify delivery countries.",
        })

    # --- Missing required-by date check ---
    if required_by is None:
        issue_counter += 1
        issues.append({
            "issue_id": f"V-{issue_counter:03d}",
            "severity": "medium",
            "type": "missing_required_by_date",
            "description": "Required-by date not specified. Lead time feasibility cannot be assessed.",
            "action_required": "Requester should provide a delivery deadline if applicable.",
        })

    # --- Text contradiction checks ---
    if request_text:
        text_numbers = _extract_numbers_from_text(request_text)

        # Check quantity contradiction — but EXCLUDE timeline-days and budget-annotated numbers
        if quantity is not None and quantity > 0:
            # Strip out budget annotations and timeline patterns before scanning
            cleaned_text = re.sub(r'\[BUDGET:\w+\]', '', request_text)
            cleaned_text = re.sub(r'(?:in|within|next|receive.*?in)\s+(?:the\s+)?(?:next\s+)?\d+[-–]\d+\s+days', '', cleaned_text, flags=re.IGNORECASE)
            cleaned_text = re.sub(r'(?:in|within|next)\s+(?:the\s+)?(?:next\s+)?\d+\s+days', '', cleaned_text, flags=re.IGNORECASE)
            # Also remove budget-context numbers (numbers near currency/budget words)
            cleaned_text = re.sub(r'(?:budget|EUR|USD|CHF)\s*(?:is\s+)?(?:of\s+)?\s*[\d,]+(?:\.\d+)?', '', cleaned_text, flags=re.IGNORECASE)

            qty_pattern = re.findall(
                r'(\d[\d\s,]*\d|\d+)\s*(?:units?|devices?|laptops?|monitors?|'
                r'chairs?|desks?|licen[cs]es?|seats?|consulting[_ ]?days?|'
                r'panels?|windows?|instance[_ ]?hours?|campaigns?|items?|pieces?)',
                cleaned_text, re.IGNORECASE
            )
            for match in qty_pattern:
                cleaned = match.replace(" ", "").replace(",", "")
                try:
                    text_qty = float(cleaned)
                    # Only flag if it's a genuinely different quantity (not a budget number)
                    if text_qty != quantity and text_qty > 0 and text_qty < 100000:
                        issue_counter += 1
                        issues.append({
                            "issue_id": f"V-{issue_counter:03d}",
                            "severity": "medium",
                            "type": "quantity_contradiction",
                            "description": (
                                f"Quantity in request text ({int(text_qty)}) differs from "
                                f"structured field ({quantity}). Clarification may be needed."
                            ),
                            "action_required": "Requester should confirm the correct quantity.",
                        })
                        break
                except ValueError:
                    pass

    # --- Budget sufficiency check ---
    budget_max = request.get("budget_max")
    budget_for_check = budget_max if budget_max and budget_max > 0 else budget
    if budget_for_check is not None and budget_for_check > 0 and quantity is not None and quantity > 0:
        cheapest_total = _find_cheapest_total(
            category_l1, category_l2, delivery_countries, quantity,
            currency, suppliers_data, pricing_data
        )
        if cheapest_total is not None and cheapest_total > budget_for_check:
            shortfall = cheapest_total - budget_for_check
            max_affordable_qty = _find_max_affordable_quantity(
                category_l1, category_l2, delivery_countries, budget_for_check,
                currency, suppliers_data, pricing_data
            )
            budget_min = request.get("budget_min")
            budget_note = ""
            if budget_min and cheapest_total > budget_min:
                budget_note = (
                    f" Note: cheapest total also exceeds budget minimum of "
                    f"{currency} {budget_min:,.2f}."
                )
            issue_counter += 1
            issues.append({
                "issue_id": f"V-{issue_counter:03d}",
                "severity": "critical",
                "type": "budget_insufficient",
                "description": (
                    f"Budget of {currency} {budget_for_check:,.2f} cannot cover {quantity} units at any "
                    f"compliant supplier's standard pricing. Minimum total is "
                    f"{currency} {cheapest_total:,.2f} - {currency} {shortfall:,.2f} over budget."
                    + budget_note
                ),
                "action_required": (
                    f"Requester must either increase budget to at least "
                    f"{currency} {cheapest_total:,.2f} or reduce quantity"
                    + (f" to a maximum of {max_affordable_qty} units within the stated budget."
                       if max_affordable_qty is not None else ".")
                ),
            })

    # --- Lead time feasibility ---
    if required_by and quantity is not None and quantity > 0:
        required_date = _parse_date(required_by)
        created_date = _parse_date(created_at) if created_at else date.today()
        if created_date is None:
            created_date = date.today()

        if required_date:
            days_available = (required_date - created_date).days

            min_expedited = _find_min_expedited_lead_time(
                category_l1, category_l2, delivery_countries, quantity,
                currency, suppliers_data, pricing_data
            )
            if min_expedited is not None and days_available < min_expedited:
                issue_counter += 1
                issues.append({
                    "issue_id": f"V-{issue_counter:03d}",
                    "severity": "high",
                    "type": "lead_time_infeasible",
                    "description": (
                        f"Required delivery date {required_by} is {days_available} days from "
                        f"request creation. All suppliers' expedited lead times "
                        f"({min_expedited}+ days) exceed this window."
                    ),
                    "action_required": (
                        "Requester must confirm whether the delivery date is a hard constraint. "
                        "If so, no compliant supplier can meet it and an escalation is required."
                    ),
                })

    return issues


def _find_cheapest_total(category_l1, category_l2, delivery_countries, quantity,
                         currency, suppliers_data, pricing_data):
    """Find the cheapest total cost across all eligible suppliers."""
    cheapest = None
    eligible_supplier_ids = _get_eligible_supplier_ids(
        category_l1, category_l2, delivery_countries, suppliers_data
    )

    for sup_id in eligible_supplier_ids:
        pricing = _lookup_pricing(sup_id, category_l1, category_l2,
                                  delivery_countries, quantity, pricing_data)
        if pricing and pricing.get("unit_price") is not None:
            total = pricing["unit_price"] * quantity
            if cheapest is None or total < cheapest:
                cheapest = total

    return cheapest


def _find_max_affordable_quantity(category_l1, category_l2, delivery_countries,
                                  budget, currency, suppliers_data, pricing_data):
    """Find the maximum quantity affordable within budget at the cheapest unit price."""
    cheapest_unit = None
    eligible_supplier_ids = _get_eligible_supplier_ids(
        category_l1, category_l2, delivery_countries, suppliers_data
    )

    for sup_id in eligible_supplier_ids:
        # Try various quantity tiers to find cheapest unit price for small quantities
        for test_qty in [1, 50, 100, 500]:
            pricing = _lookup_pricing(sup_id, category_l1, category_l2,
                                      delivery_countries, test_qty, pricing_data)
            if pricing and pricing.get("unit_price") is not None:
                if cheapest_unit is None or pricing["unit_price"] < cheapest_unit:
                    cheapest_unit = pricing["unit_price"]

    if cheapest_unit and cheapest_unit > 0:
        return int(budget / cheapest_unit)
    return None


def _find_min_expedited_lead_time(category_l1, category_l2, delivery_countries,
                                   quantity, currency, suppliers_data, pricing_data):
    """Find the minimum expedited lead time across all eligible suppliers."""
    min_lead = None
    eligible_supplier_ids = _get_eligible_supplier_ids(
        category_l1, category_l2, delivery_countries, suppliers_data
    )

    for sup_id in eligible_supplier_ids:
        pricing = _lookup_pricing(sup_id, category_l1, category_l2,
                                  delivery_countries, quantity, pricing_data)
        if pricing and pricing.get("expedited_lead_time_days") is not None:
            lt = pricing["expedited_lead_time_days"]
            if min_lead is None or lt < min_lead:
                min_lead = lt

    return min_lead


def _get_eligible_supplier_ids(category_l1, category_l2, delivery_countries, suppliers_data):
    """Get supplier IDs that match category and delivery countries with active contracts."""
    eligible = set()
    for sup in suppliers_data:
        if (sup.get("category_l1") == category_l1
                and sup.get("category_l2") == category_l2
                and str(sup.get("contract_status", "")).lower() == "active"):
            service_regions = str(sup.get("service_regions", "")).split(";")
            service_regions = [r.strip() for r in service_regions]
            if not delivery_countries or all(
                c in service_regions for c in delivery_countries
            ):
                eligible.add(sup.get("supplier_id"))
    return eligible


def _country_to_pricing_region(country):
    """Map a country code to a pricing region."""
    eu = {"DE", "FR", "NL", "BE", "AT", "IT", "ES", "PL", "UK", "CH"}
    americas = {"US", "CA", "BR", "MX"}
    apac = {"SG", "AU", "IN", "JP"}
    mea = {"UAE", "ZA"}

    if country in eu:
        return "EU"
    elif country in americas:
        return "Americas"
    elif country in apac:
        return "APAC"
    elif country in mea:
        return "MEA"
    return None


def _lookup_pricing(supplier_id, category_l1, category_l2, delivery_countries,
                    quantity, pricing_data):
    """Look up pricing for a supplier given category, region, and quantity."""
    # Determine region from first delivery country
    region = None
    if delivery_countries:
        country = delivery_countries[0] if isinstance(delivery_countries, list) else delivery_countries
        region = _country_to_pricing_region(country)

    # Find matching pricing rows for this supplier + category + region
    matching_rows = []
    for row in pricing_data:
        if (row.get("supplier_id") == supplier_id
                and row.get("category_l1") == category_l1
                and row.get("category_l2") == category_l2):
            if region is None or row.get("region") == region:
                matching_rows.append(row)

    if not matching_rows:
        return None

    # Find the right tier for the quantity
    best_row = None
    for row in matching_rows:
        try:
            min_q = float(row.get("min_quantity", 0))
            max_q = float(row.get("max_quantity", 999999999))
        except (ValueError, TypeError):
            continue
        if min_q <= quantity <= max_q:
            best_row = row
            break

    # If quantity exceeds all tiers, use the highest tier
    if best_row is None and matching_rows:
        highest = None
        for row in matching_rows:
            try:
                max_q = float(row.get("max_quantity", 0))
            except (ValueError, TypeError):
                continue
            if highest is None or max_q > float(highest.get("max_quantity", 0)):
                highest = row
        best_row = highest

    if best_row is None:
        return None

    try:
        unit_price = float(best_row.get("unit_price", 0))
        expedited_price = float(best_row.get("expedited_unit_price", 0))
        standard_lt = int(float(best_row.get("standard_lead_time_days", 0)))
        expedited_lt = int(float(best_row.get("expedited_lead_time_days", 0)))
    except (ValueError, TypeError):
        return None

    return {
        "unit_price": unit_price,
        "expedited_unit_price": expedited_price,
        "standard_lead_time_days": standard_lt,
        "expedited_lead_time_days": expedited_lt,
        "pricing_id": best_row.get("pricing_id"),
        "min_quantity": best_row.get("min_quantity"),
        "max_quantity": best_row.get("max_quantity"),
    }


def evaluate_policies(request, contract_value, suppliers, policies):
    """
    Evaluate all applicable policies for a procurement request.

    Args:
        request: dict with request fields
        contract_value: float, the estimated contract value
        suppliers: list of supplier dicts (eligible suppliers)
        policies: dict loaded from policies.json

    Returns:
        dict with keys:
            approval_threshold, preferred_supplier, restricted_suppliers,
            category_rules, geography_rules
    """
    currency = request.get("currency", "EUR")
    category_l1 = request.get("category_l1")
    category_l2 = request.get("category_l2")
    delivery_countries = request.get("delivery_countries", [])
    preferred_supplier_name = request.get("preferred_supplier_mentioned")

    result = {
        "approval_threshold": _evaluate_approval_threshold(
            contract_value, currency, policies
        ),
        "preferred_supplier": _evaluate_preferred_supplier(
            preferred_supplier_name, category_l1, category_l2,
            delivery_countries, policies
        ),
        "restricted_suppliers": _evaluate_restricted_suppliers(
            suppliers, delivery_countries, contract_value, currency, policies
        ),
        "category_rules": _evaluate_category_rules(
            category_l1, category_l2, policies
        ),
        "geography_rules": _evaluate_geography_rules(
            delivery_countries, category_l1, policies
        ),
    }

    return result


def _evaluate_approval_threshold(contract_value, currency, policies):
    """Find the matching approval threshold for the given contract value and currency."""
    thresholds = policies.get("approval_thresholds", [])

    for t in thresholds:
        if t.get("currency") != currency:
            continue

        # Normalize field names: EUR/CHF use min_amount/max_amount, USD uses min_value/max_value
        min_val = t.get("min_amount") if t.get("min_amount") is not None else t.get("min_value")
        max_val = t.get("max_amount") if t.get("max_amount") is not None else t.get("max_value")
        if max_val is None:
            max_val = float("inf")

        if min_val is not None and min_val <= contract_value <= max_val:
            # Normalize output fields
            quotes_required = t.get("min_supplier_quotes") or t.get("quotes_required", 1)
            managed_by = t.get("managed_by") or t.get("approvers", [])
            deviation_approval = t.get("deviation_approval_required_from", [])
            if not deviation_approval:
                # Derive from approvers for USD thresholds
                policy_note = t.get("policy_note", "")
                if "Procurement Manager" in policy_note:
                    deviation_approval = ["Procurement Manager"]
                elif "Head of Category" in policy_note:
                    deviation_approval = ["Head of Category"]
                elif "Head of Strategic Sourcing" in policy_note:
                    deviation_approval = ["Head of Strategic Sourcing"]
                elif "CPO" in policy_note:
                    deviation_approval = ["CPO"]

            return {
                "threshold_id": t.get("threshold_id"),
                "currency": currency,
                "min_value": min_val,
                "max_value": max_val if max_val != float("inf") else None,
                "quotes_required": quotes_required,
                "managed_by": managed_by,
                "deviation_approval": deviation_approval,
                "policy_note": t.get("policy_note", ""),
            }

    return None


def _evaluate_preferred_supplier(supplier_name, category_l1, category_l2,
                                  delivery_countries, policies):
    """Check if the mentioned preferred supplier is listed as preferred in policies."""
    if not supplier_name:
        return {"mentioned": False, "is_preferred": False}

    preferred_list = policies.get("preferred_suppliers", [])

    for ps in preferred_list:
        if ps.get("supplier_name") != supplier_name:
            continue
        if ps.get("category_l1") != category_l1:
            continue
        if ps.get("category_l2") != category_l2:
            continue

        # Check region scope
        region_scope = ps.get("region_scope", [])
        if not region_scope:
            # No region restriction (some entries lack region_scope)
            return {
                "mentioned": True,
                "is_preferred": True,
                "supplier_id": ps.get("supplier_id"),
                "supplier_name": supplier_name,
                "region_scope": region_scope,
                "policy_note": ps.get("policy_note", ""),
            }

        # Check if any delivery country maps to a scope region
        matched = False
        for country in delivery_countries:
            # Direct country match (e.g., "CH")
            if country in region_scope:
                matched = True
                break
            # Region match (e.g., country DE -> region EU)
            country_region = COUNTRY_TO_REGION.get(country)
            if country_region and country_region in region_scope:
                matched = True
                break
            # EU countries check
            if "EU" in region_scope and country in EU_COUNTRIES:
                matched = True
                break

        if matched:
            return {
                "mentioned": True,
                "is_preferred": True,
                "supplier_id": ps.get("supplier_id"),
                "supplier_name": supplier_name,
                "region_scope": region_scope,
                "policy_note": ps.get("policy_note", ""),
            }

    return {
        "mentioned": True,
        "is_preferred": False,
        "supplier_name": supplier_name,
    }


def _evaluate_restricted_suppliers(suppliers, delivery_countries, contract_value,
                                    currency, policies):
    """Check which suppliers are restricted based on policies."""
    restricted_list = policies.get("restricted_suppliers", [])
    results = {}

    # Build a set of supplier IDs from the eligible suppliers list
    supplier_ids = set()
    supplier_map = {}
    for s in suppliers:
        sid = s.get("supplier_id")
        supplier_ids.add(sid)
        supplier_map[sid] = s

    for r in restricted_list:
        r_sid = r.get("supplier_id")
        r_name = r.get("supplier_name", "")

        # Only check suppliers that are in the eligible set or could be relevant
        is_restricted = False
        restriction_reason = r.get("restriction_reason", "")
        scope = r.get("restriction_scope", [])

        if "all" in scope:
            # Value-conditional restriction (e.g., SUP-0045 EUR 75K limit)
            value_limit = _extract_value_limit(restriction_reason)
            if value_limit is not None:
                if contract_value is not None and contract_value >= value_limit:
                    is_restricted = True
                else:
                    is_restricted = False
            else:
                is_restricted = True
        else:
            # Check if any delivery country is in the restriction scope
            for country in delivery_countries:
                if country in scope:
                    is_restricted = True
                    break

        results[r_sid] = {
            "supplier_id": r_sid,
            "supplier_name": r_name,
            "restricted": is_restricted,
            "restriction_scope": scope,
            "restriction_reason": restriction_reason,
            "category_l1": r.get("category_l1"),
            "category_l2": r.get("category_l2"),
        }

    return results


def _extract_value_limit(restriction_reason):
    """Extract a numeric value limit from a restriction reason string.
    E.g. 'Can be used only below EUR 75000 without exception approval' -> 75000.0
    """
    if not restriction_reason:
        return None
    match = re.search(r'below\s+(?:EUR|CHF|USD)\s+([\d,.\s]+)', restriction_reason, re.IGNORECASE)
    if match:
        val_str = match.group(1).replace(",", "").replace(" ", "")
        try:
            return float(val_str)
        except ValueError:
            return None
    return None


def _evaluate_category_rules(category_l1, category_l2, policies):
    """Find matching category rules."""
    rules = policies.get("category_rules", [])
    matching = []
    for rule in rules:
        if rule.get("category_l1") == category_l1 and rule.get("category_l2") == category_l2:
            matching.append({
                "rule_id": rule.get("rule_id"),
                "rule_type": rule.get("rule_type"),
                "rule_text": rule.get("rule_text"),
            })
    return matching


def _evaluate_geography_rules(delivery_countries, category_l1, policies):
    """Find matching geography rules."""
    rules = policies.get("geography_rules", [])
    matching = []
    for rule in rules:
        # Single-country rules (GR-001 through GR-004)
        rule_country = rule.get("country")
        if rule_country:
            if rule_country in delivery_countries:
                matching.append({
                    "rule_id": rule.get("rule_id"),
                    "country": rule_country,
                    "rule_type": rule.get("rule_type"),
                    "rule_text": rule.get("rule_text"),
                })
            continue

        # Regional rules (GR-005 through GR-008)
        rule_countries = rule.get("countries", [])
        applies_to = rule.get("applies_to", [])
        if any(c in rule_countries for c in delivery_countries):
            if not applies_to or category_l1 in applies_to:
                matching.append({
                    "rule_id": rule.get("rule_id"),
                    "region": rule.get("region"),
                    "countries": rule_countries,
                    "rule": rule.get("rule"),
                    "applies_to": applies_to,
                })

    return matching
