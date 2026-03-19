"""Historical Precedent Agent – analyzes past award patterns for the same category/country."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a procurement historical analysis specialist. "
    "Analyze past award patterns to identify which suppliers have performed well "
    "in similar categories and geographies. Use historical data to inform supplier "
    "rankings and suggest weight adjustments when history strongly favors or "
    "disfavors certain factors."
)


class HistoricalAgent(BaseAgent):
    """Analyzes historical_awards.csv for same category/country patterns."""

    def __init__(self):
        super().__init__("historical_precedent")

    async def analyze(self, context: dict) -> dict:
        """
        context keys:
          - request: dict with category_l1, category_l2, delivery_country, etc.
          - eligible_suppliers: list[dict]
          - historical_awards: list[dict]  (all awards)
        """
        try:
            request = context["request"]
            eligible_suppliers = context["eligible_suppliers"]
            all_awards = context.get("historical_awards", [])

            # Filter historical awards to same category
            cat_l1 = request.get("category_l1", "")
            cat_l2 = request.get("category_l2", "")
            country = request.get("delivery_country", "")

            relevant_awards = [
                a for a in all_awards
                if a.get("category_l1") == cat_l1
                and a.get("category_l2") == cat_l2
            ]

            # Further filter by country if available
            country_awards = [
                a for a in relevant_awards
                if a.get("delivery_country") == country
            ] if country else []

            supplier_summary = [
                {
                    "supplier_id": s.get("supplier_id"),
                    "supplier_name": s.get("supplier_name"),
                    "quality_score": s.get("quality_score"),
                    "risk_score": s.get("risk_score"),
                    "is_preferred": s.get("is_preferred", False),
                    "is_incumbent": s.get("is_incumbent", False),
                }
                for s in eligible_suppliers
            ]

            user_prompt = json.dumps(
                {
                    "request": {
                        "category_l1": cat_l1,
                        "category_l2": cat_l2,
                        "delivery_country": country,
                        "quantity": request.get("quantity"),
                        "budget_amount": request.get("budget_amount"),
                    },
                    "eligible_suppliers": supplier_summary,
                    "historical_awards_same_category": relevant_awards[:50],
                    "historical_awards_same_country": country_awards[:30],
                },
                default=str,
            )

            prompt = (
                "Based on the historical award data and current request details below, "
                "analyze which suppliers have the strongest historical track record.\n\n"
                f"{user_prompt}\n\n"
                "Return ONLY a JSON object with these keys:\n"
                "- supplier_rankings: list of {id, score (0-100), reasoning}\n"
                "- weight_adjustments: dict mapping weight names (price, quality, risk, "
                "esg, lead_time, preferred, incumbent) to adjustment values (-0.10 to +0.10). "
                "Only include weights that should change based on historical evidence.\n"
                "- insights: string with key historical findings\n"
                "- confidence: float 0-1 indicating how confident you are"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            result = self._parse_json_response(raw)
            return result

        except Exception:
            logger.exception("HistoricalAgent failed, returning defaults")
            return self._defaults(context.get("eligible_suppliers", []))

    @staticmethod
    def _defaults(eligible_suppliers: list[dict[str, Any]]) -> dict:
        return {
            "supplier_rankings": [
                {"id": s.get("supplier_id", ""), "score": 50, "reasoning": "No historical data available"}
                for s in eligible_suppliers
            ],
            "weight_adjustments": {},
            "insights": "Historical analysis unavailable – using neutral scores.",
            "confidence": 0.3,
        }
