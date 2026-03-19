"""Bundling module — volume optimization with operational safeguards."""

from __future__ import annotations

import logging
from typing import Any

from backend.models import BundleModuleResult
from backend.services.supplier_filter import get_pricing_for_supplier

logger = logging.getLogger(__name__)


def run_bundling_check(
    request: dict[str, Any],
    bundle_signal: dict[str, Any],
    eligible_suppliers: list[dict[str, Any]],
    pricing_data: list[dict[str, Any]],
) -> BundleModuleResult:
    """Run the bundling subflow with operational safeguards.

    Subflow:
    1. Check hold-window feasibility (already in signal)
    2. Volume aggregation (already computed in signal)
    3. Capacity check against supplier monthly capacity
    4. Pricing tier rematch with bundled volume
    5. Return enriched result
    """
    if not bundle_signal.get("has_opportunity"):
        return BundleModuleResult(
            bundled=False,
            original_quantity=request.get("quantity", 0) or 0,
            bundled_quantity=request.get("quantity", 0) or 0,
        )

    original_qty = request.get("quantity", 0) or 0
    bundled_qty = bundle_signal.get("combined_quantity", original_qty)
    related_requests = bundle_signal.get("related_request_ids", [])

    category_l1 = request.get("category_l1", "")
    category_l2 = request.get("category_l2", "")
    delivery_countries = request.get("delivery_countries", [])
    delivery_country = delivery_countries[0] if delivery_countries else request.get("country", "")

    # --- Capacity check ---
    capacity_check = "within_capacity"
    escalation_triggered = None

    all_over_capacity = True
    for sup in eligible_suppliers:
        cap = sup.get("capacity_per_month")
        if cap is not None and bundled_qty <= cap:
            all_over_capacity = False
            break

    if eligible_suppliers and all_over_capacity:
        capacity_check = "exceeded"
        escalation_triggered = "ER-009"
        logger.warning(
            "Bundled quantity %s exceeds all suppliers' capacity for %s/%s",
            bundled_qty, category_l1, category_l2,
        )

    # --- Pricing tier rematch ---
    original_tier = bundle_signal.get("current_tier")
    new_tier = bundle_signal.get("potential_tier")
    savings_pct = bundle_signal.get("estimated_savings_pct")

    # Try to get more accurate pricing with bundled quantity
    if eligible_suppliers and delivery_country:
        for sup in eligible_suppliers[:1]:  # Check first eligible supplier
            original_pricing = get_pricing_for_supplier(
                sup["supplier_id"], category_l1, category_l2,
                delivery_country, original_qty, pricing_data,
            )
            bundled_pricing = get_pricing_for_supplier(
                sup["supplier_id"], category_l1, category_l2,
                delivery_country, bundled_qty, pricing_data,
            )
            if original_pricing and bundled_pricing:
                orig_price = original_pricing.get("unit_price", 0)
                new_price = bundled_pricing.get("unit_price", 0)
                if orig_price > 0:
                    savings_pct = round(((orig_price - new_price) / orig_price) * 100, 1)
                original_tier = f"{original_pricing.get('tier_min', '')}-{original_pricing.get('tier_max', '')}"
                new_tier = f"{bundled_pricing.get('tier_min', '')}-{bundled_pricing.get('tier_max', '')}"
                break

    return BundleModuleResult(
        bundled=True,
        original_quantity=original_qty,
        bundled_quantity=bundled_qty,
        related_requests=related_requests,
        original_pricing_tier=original_tier,
        new_pricing_tier=new_tier,
        savings_pct=savings_pct,
        capacity_check=capacity_check,
        escalation_triggered=escalation_triggered,
    )
