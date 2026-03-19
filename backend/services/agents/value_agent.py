"""Value-for-Money Agent – evaluates pricing, budget fit, and cost efficiency."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent
from backend.config import SPECIALIST_MAX_TOKENS

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a procurement value-for-money specialist. "
    "Evaluate suppliers based on pricing competitiveness, total cost of ownership, "
    "budget alignment, and pricing tier optimization. "
    "Consider volume discounts, expedited pricing, and overall cost efficiency.\n\n"
    "Be precise. Each rationale must cite 1-2 specific data points. No filler. Return compact JSON."
)


class ValueAgent(BaseAgent):
    """Evaluates pricing and budget fit across eligible suppliers."""

    def __init__(self):
        super().__init__("value_for_money", max_tokens=SPECIALIST_MAX_TOKENS)

    async def analyze(self, context: dict) -> dict:
        """
        context keys:
          - request: dict
          - eligible_suppliers: list[dict]
          - pricing_info: list[dict]  (all pricing rows for eligible suppliers)
        """
        try:
            request = context["request"]
            eligible_suppliers = context["eligible_suppliers"]
            pricing_info = context.get("pricing_info", [])

            supplier_ids = {s.get("supplier_id") for s in eligible_suppliers}

            # Filter pricing to eligible suppliers only
            relevant_pricing = [
                {
                    "supplier_id": p.get("supplier_id"),
                    "tier": p.get("tier"),
                    "min_qty": p.get("min_qty"),
                    "max_qty": p.get("max_qty"),
                    "unit_price_eur": p.get("unit_price_eur"),
                    "lead_time_days": p.get("lead_time_days"),
                    "expedited_lead_time_days": p.get("expedited_lead_time_days"),
                    "expedited_unit_price_eur": p.get("expedited_unit_price_eur"),
                }
                for p in pricing_info
                if p.get("supplier_id") in supplier_ids
            ]

            user_prompt = json.dumps(
                {
                    "request": {
                        "category_l1": request.get("category_l1"),
                        "category_l2": request.get("category_l2"),
                        "quantity": request.get("quantity"),
                        "budget_amount": request.get("budget_amount"),
                        "currency": request.get("currency", "EUR"),
                        "required_by_date": request.get("required_by_date"),
                        "days_until_required": request.get("days_until_required"),
                    },
                    "pricing_tiers": relevant_pricing[:100],  # limit payload
                    "supplier_count": len(eligible_suppliers),
                },
                default=str,
            )

            prompt = (
                "Analyze the pricing and value-for-money for each supplier given the "
                "procurement request and available pricing tiers.\n\n"
                f"{user_prompt}\n\n"
                "Return ONLY a JSON object with these keys:\n"
                "- supplier_value_scores: list of {id, value_score (0-100 where 100 = "
                "best value), price_analysis (string explaining the value assessment)}\n"
                "- budget_optimization: string with recommendations on how to optimize "
                "spend within budget constraints\n"
                "- confidence: float 0-1 indicating your confidence"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            result = self._parse_json_response(raw)
            return result

        except Exception:
            logger.exception("ValueAgent failed, returning defaults")
            return self._defaults(context.get("eligible_suppliers", []))

    @staticmethod
    def _defaults(eligible_suppliers: list[dict[str, Any]]) -> dict:
        return {
            "supplier_value_scores": [
                {
                    "id": s.get("supplier_id", ""),
                    "value_score": 50,
                    "price_analysis": "Value analysis unavailable – agent error.",
                }
                for s in eligible_suppliers
            ],
            "budget_optimization": "Unable to provide budget optimization.",
            "confidence": 0.3,
        }
