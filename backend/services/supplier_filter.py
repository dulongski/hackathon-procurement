"""
Supplier filtering and pricing service for procurement sourcing agent.
"""


# Country-to-pricing-region mapping
COUNTRY_TO_PRICING_REGION = {
    "DE": "EU", "FR": "EU", "NL": "EU", "BE": "EU", "AT": "EU",
    "IT": "EU", "ES": "EU", "PL": "EU", "UK": "EU", "CH": "EU",
    "US": "Americas", "CA": "Americas", "BR": "Americas", "MX": "Americas",
    "SG": "APAC", "AU": "APAC", "IN": "APAC", "JP": "APAC",
    "UAE": "MEA", "ZA": "MEA",
}


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
            import re
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
        tuple of (eligible_list, excluded_list), each a list of dicts with supplier info
        and inclusion/exclusion reason.
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

    return eligible, excluded


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
        return None

    total = unit_price * quantity
    expedited_total = expedited_price * quantity

    return {
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
