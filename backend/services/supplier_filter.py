"""
Supplier filtering and pricing service for procurement sourcing agent.
"""

import re

# Country-to-pricing-region mapping
COUNTRY_TO_PRICING_REGION = {
    "DE": "EU", "FR": "EU", "NL": "EU", "BE": "EU", "AT": "EU",
    "IT": "EU", "ES": "EU", "PL": "EU", "UK": "EU", "CH": "EU",
    "US": "Americas", "CA": "Americas", "BR": "Americas", "MX": "Americas",
    "SG": "APAC", "AU": "APAC", "IN": "APAC", "JP": "APAC",
    "UAE": "MEA", "ZA": "MEA",
}

# Pricing lookup cache
_pricing_cache: dict[tuple, dict | None] = {}


def _is_restricted(supplier_id, category_l1, category_l2, delivery_countries,
                   contract_value, policies):
    """
    Check if a supplier is restricted for the given category and delivery countries.

    Returns (is_restricted: bool, reason: str or None).
    """
    restricted_list = policies.get("restricted_suppliers", [])

    for r in restricted_list:
        if r.get("supplier_id") != supplier_id:
            continue
        if r.get("category_l1") != category_l1 or r.get("category_l2") != category_l2:
            continue

        scope = r.get("restriction_scope", [])
        reason = r.get("restriction_reason", "")

        if "all" in scope:
            # Value-conditional restriction (e.g., SUP-0045 EUR 75K limit)
            match = re.search(r'below\s+(?:EUR|CHF|USD)\s+([\d,.\s]+)', reason, re.IGNORECASE)
            if match:
                val_str = match.group(1).replace(",", "").replace(" ", "")
                try:
                    limit = float(val_str)
                    if contract_value is not None and contract_value >= limit:
                        return True, reason
                    else:
                        # Below the limit, not restricted
                        return False, None
                except ValueError:
                    pass
            # No value condition found with "all" scope -> fully restricted
            return True, reason

        # Check if any delivery country is in the restriction scope
        for country in delivery_countries:
            if country in scope:
                return True, reason

    return False, None


def filter_suppliers(request, suppliers_data, pricing_data, policies):
    """
    Filter suppliers based on category, delivery coverage, restrictions, data residency,
    and contract status.

    Args:
        request: dict with request fields
        suppliers_data: list of dicts (from suppliers.csv)
        pricing_data: list of dicts (from pricing.csv)
        policies: dict loaded from policies.json

    Returns:
        tuple of (eligible_list, excluded_list, near_miss_list).  eligible and excluded
        are lists of dicts with supplier info and inclusion/exclusion reason.
        near_miss contains suppliers that are excluded due to a value-conditional
        restriction but could become eligible with exception approval.
    """
    category_l1 = request.get("category_l1")
    category_l2 = request.get("category_l2")
    delivery_countries = request.get("delivery_countries", [])
    data_residency_required = request.get("data_residency_constraint", False)
    quantity = request.get("quantity")
    budget = request.get("budget_amount")
    currency = request.get("currency", "EUR")

    # Estimate contract value for restriction checks
    contract_value = budget  # fallback; caller can provide better estimate

    eligible = []
    excluded = []
    near_miss = []

    # Deduplicate supplier rows (a supplier may appear multiple times for
    # different categories, but we only care about the matching category row)
    seen_suppliers = set()

    for sup in suppliers_data:
        sup_id = sup.get("supplier_id")
        sup_name = sup.get("supplier_name", "")
        sup_cat_l1 = sup.get("category_l1")
        sup_cat_l2 = sup.get("category_l2")

        # Skip if not matching category
        if sup_cat_l1 != category_l1 or sup_cat_l2 != category_l2:
            continue

        # Skip duplicates for same supplier+category
        key = (sup_id, sup_cat_l1, sup_cat_l2)
        if key in seen_suppliers:
            continue
        seen_suppliers.add(key)

        supplier_info = {
            "supplier_id": sup_id,
            "supplier_name": sup_name,
            "category_l1": sup_cat_l1,
            "category_l2": sup_cat_l2,
            "quality_score": _safe_int(sup.get("quality_score")),
            "risk_score": _safe_int(sup.get("risk_score")),
            "esg_score": _safe_int(sup.get("esg_score")),
            "preferred_supplier": _safe_bool(sup.get("preferred_supplier")),
            "capacity_per_month": _safe_int(sup.get("capacity_per_month")),
            "data_residency_supported": _safe_bool(sup.get("data_residency_supported")),
            "contract_status": sup.get("contract_status", ""),
            "service_regions": str(sup.get("service_regions", "")).split(";"),
        }

        # 1. Contract status check
        if str(sup.get("contract_status", "")).lower() != "active":
            supplier_info["exclusion_reason"] = "Contract status is not active"
            excluded.append(supplier_info)
            continue

        # 2. Delivery country coverage check
        service_regions = [r.strip() for r in str(sup.get("service_regions", "")).split(";")]
        if delivery_countries:
            uncovered = [c for c in delivery_countries if c not in service_regions]
            if uncovered:
                supplier_info["exclusion_reason"] = (
                    f"Supplier does not cover delivery countries: {', '.join(uncovered)}. "
                    f"Service regions: {', '.join(service_regions)}"
                )
                excluded.append(supplier_info)
                continue

        # 3. Restriction check
        restricted, restriction_reason = _is_restricted(
            sup_id, category_l1, category_l2, delivery_countries,
            contract_value, policies
        )
        if restricted:
            supplier_info["exclusion_reason"] = (
                f"Supplier is restricted: {restriction_reason}"
            )
            supplier_info["is_restricted"] = True
            excluded.append(supplier_info)

            # Check if this is a value-conditional restriction (near miss)
            value_match = re.search(
                r'below\s+(EUR|CHF|USD)\s+([\d,.\s]+)',
                restriction_reason or "",
                re.IGNORECASE,
            )
            if value_match:
                restr_currency = value_match.group(1).upper()
                limit = float(value_match.group(2).replace(",", "").replace(" ", ""))
                near_miss.append({
                    "supplier_id": sup_id,
                    "supplier_name": sup_name,
                    "restriction_reason": restriction_reason,
                    "condition_for_eligibility": (
                        f"Requires exception approval for contracts above {restr_currency} {limit:,.0f}"
                    ),
                    "restriction_threshold": limit,
                })

            continue

        # 4. Data residency check
        if data_residency_required:
            dr_supported = _safe_bool(sup.get("data_residency_supported"))
            if not dr_supported:
                supplier_info["exclusion_reason"] = (
                    "Data residency constraint required but supplier does not support it"
                )
                excluded.append(supplier_info)
                continue

        # Passed all filters
        eligible.append(supplier_info)

    return eligible, excluded, near_miss


def get_pricing_for_supplier(supplier_id, category_l1, category_l2, country,
                              quantity, pricing_data):
    """
    Look up pricing for a specific supplier.

    Args:
        supplier_id: str
        category_l1: str
        category_l2: str
        country: str (delivery country code)
        quantity: int/float
        pricing_data: list of dicts (from pricing.csv)

    Returns:
        dict with pricing info or None if no pricing found.
        Keys: pricing_id, unit_price, total, expedited_unit_price, expedited_total,
              standard_lead_time_days, expedited_lead_time_days, tier_min, tier_max,
              region, currency
    """
    cache_key = (supplier_id, category_l1, category_l2, country, quantity)
    if cache_key in _pricing_cache:
        return _pricing_cache[cache_key]

    # Determine pricing region from country
    region = COUNTRY_TO_PRICING_REGION.get(country)

    # Find matching pricing rows
    matching_rows = []
    for row in pricing_data:
        if (row.get("supplier_id") == supplier_id
                and row.get("category_l1") == category_l1
                and row.get("category_l2") == category_l2):
            if region is None or row.get("region") == region:
                matching_rows.append(row)

    if not matching_rows:
        _pricing_cache[cache_key] = None
        return None

    # Find the tier matching the quantity
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
        highest_max = -1
        for row in matching_rows:
            try:
                max_q = float(row.get("max_quantity", 0))
            except (ValueError, TypeError):
                continue
            if max_q > highest_max:
                highest_max = max_q
                highest = row
        best_row = highest

    if best_row is None:
        _pricing_cache[cache_key] = None
        return None

    try:
        unit_price = float(best_row.get("unit_price", 0))
        expedited_price = float(best_row.get("expedited_unit_price", 0))
        standard_lt = int(float(best_row.get("standard_lead_time_days", 0)))
        expedited_lt = int(float(best_row.get("expedited_lead_time_days", 0)))
        min_q = int(float(best_row.get("min_quantity", 0)))
        max_q = int(float(best_row.get("max_quantity", 0)))
        moq = best_row.get("moq")
    except (ValueError, TypeError):
        _pricing_cache[cache_key] = None
        return None

    total = unit_price * quantity
    expedited_total = expedited_price * quantity

    result = {
        "pricing_id": best_row.get("pricing_id"),
        "supplier_id": supplier_id,
        "region": best_row.get("region"),
        "currency": best_row.get("currency"),
        "unit_price": unit_price,
        "total": round(total, 2),
        "expedited_unit_price": expedited_price,
        "expedited_total": round(expedited_total, 2),
        "standard_lead_time_days": standard_lt,
        "expedited_lead_time_days": expedited_lt,
        "tier_min": min_q,
        "tier_max": max_q,
        "moq": moq,
        "pricing_model": best_row.get("pricing_model"),
    }
    _pricing_cache[cache_key] = result
    return result


def _safe_int(val):
    """Safely convert a value to int."""
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _safe_bool(val):
    """Safely convert a value to bool."""
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes")
    return bool(val)


def detect_catalog_gap(
    eligible: list[dict],
    excluded: list[dict],
    category_l1: str,
    category_l2: str,
    delivery_country: str,
) -> dict:
    """Detect whether there is a catalog gap (no eligible approved suppliers).

    Returns a dict matching CatalogGapSignal model.
    """
    if len(eligible) > 0:
        return {
            "has_gap": False,
            "reason": "",
            "category_l1": category_l1,
            "category_l2": category_l2,
            "delivery_country": delivery_country,
        }

    # Determine reason from exclusion patterns
    reasons = []
    exclusion_reasons = [e.get("exclusion_reason", "") for e in excluded]

    if not excluded:
        reasons.append(f"No suppliers found for category {category_l1}/{category_l2}")
    else:
        contract_issues = sum(1 for r in exclusion_reasons if "contract" in r.lower())
        coverage_issues = sum(1 for r in exclusion_reasons if "cover" in r.lower() or "country" in r.lower())
        restriction_issues = sum(1 for r in exclusion_reasons if "restrict" in r.lower())
        residency_issues = sum(1 for r in exclusion_reasons if "residency" in r.lower())

        if contract_issues:
            reasons.append(f"{contract_issues} supplier(s) have inactive contracts")
        if coverage_issues:
            reasons.append(f"{coverage_issues} supplier(s) don't cover {delivery_country}")
        if restriction_issues:
            reasons.append(f"{restriction_issues} supplier(s) are policy-restricted")
        if residency_issues:
            reasons.append(f"{residency_issues} supplier(s) fail data residency requirements")

    return {
        "has_gap": True,
        "reason": "; ".join(reasons) if reasons else "All suppliers excluded by eligibility filters",
        "category_l1": category_l1,
        "category_l2": category_l2,
        "delivery_country": delivery_country,
    }


def detect_bundle_opportunity(
    request: dict,
    all_requests: list[dict],
    pricing_data: list[dict],
) -> dict:
    """Detect whether bundling with other pending requests could improve pricing.

    Returns a dict matching BundleOpportunitySignal model.
    """
    category_l1 = request.get("category_l1", "")
    category_l2 = request.get("category_l2", "")
    quantity = request.get("quantity") or 0
    request_id = request.get("request_id", "")
    required_by = request.get("required_by_date")

    # Find other requests in the same category that could be bundled
    related = []
    combined_qty = quantity
    for r in all_requests:
        if r.get("request_id") == request_id:
            continue
        if r.get("category_l1") != category_l1 or r.get("category_l2") != category_l2:
            continue
        if r.get("status", "").lower() in ("cancelled", "completed", "awarded"):
            continue
        r_qty = r.get("quantity") or 0
        if r_qty > 0:
            related.append(r["request_id"])
            combined_qty += r_qty

    if not related or combined_qty <= quantity:
        return {
            "has_opportunity": False,
            "related_request_ids": [],
            "combined_quantity": quantity,
            "current_tier": None,
            "potential_tier": None,
            "estimated_savings_pct": None,
            "hold_window_feasible": False,
        }

    # Check hold window feasibility (can we wait?)
    hold_window_feasible = True
    if required_by:
        from datetime import datetime, date
        try:
            if isinstance(required_by, str):
                req_date = datetime.fromisoformat(required_by.replace("Z", "+00:00")).date()
            else:
                req_date = required_by
            days_available = (req_date - date.today()).days
            if days_available < 7:  # Less than 7 days = can't hold for bundling
                hold_window_feasible = False
        except (ValueError, TypeError):
            pass

    # Estimate tier improvement by looking at pricing data
    current_tier = None
    potential_tier = None
    estimated_savings = None

    matching_pricing = [
        p for p in pricing_data
        if p.get("category_l1") == category_l1
        and p.get("category_l2") == category_l2
    ]

    if matching_pricing:
        # Find current tier
        for p in matching_pricing:
            try:
                min_q = float(p.get("min_quantity", 0))
                max_q = float(p.get("max_quantity", 999999999))
                if min_q <= quantity <= max_q:
                    current_tier = f"{int(min_q)}-{int(max_q)}"
                    current_price = float(p.get("unit_price", 0))
                    break
            except (ValueError, TypeError):
                continue

        # Find potential tier with combined quantity
        for p in matching_pricing:
            try:
                min_q = float(p.get("min_quantity", 0))
                max_q = float(p.get("max_quantity", 999999999))
                if min_q <= combined_qty <= max_q:
                    potential_tier = f"{int(min_q)}-{int(max_q)}"
                    potential_price = float(p.get("unit_price", 0))
                    if current_tier and current_price and potential_price:
                        estimated_savings = round(
                            ((current_price - potential_price) / current_price) * 100, 1
                        )
                    break
            except (ValueError, TypeError):
                continue

    has_opportunity = (
        len(related) > 0
        and hold_window_feasible
        and current_tier != potential_tier
        and estimated_savings is not None
        and estimated_savings > 0
    )

    return {
        "has_opportunity": has_opportunity,
        "related_request_ids": related[:10],
        "combined_quantity": combined_qty,
        "current_tier": current_tier,
        "potential_tier": potential_tier,
        "estimated_savings_pct": estimated_savings,
        "hold_window_feasible": hold_window_feasible,
    }
