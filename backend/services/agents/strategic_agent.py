"""Strategic Fit Agent – evaluates ESG alignment, preferred status, and strategic fit."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent
from backend.config import SPECIALIST_MAX_TOKENS

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a procurement strategic alignment specialist. "
    "Evaluate suppliers based on ESG performance, preferred supplier status, "
    "incumbent relationships, and overall strategic fit with organizational goals. "
    "Consider long-term partnership value and category strategy alignment.\n\n"
    "Be precise. Each rationale must cite 1-2 specific data points. No filler. Return compact JSON."
)


class StrategicAgent(BaseAgent):
    """Evaluates ESG alignment, preferred status, incumbent relationships, and strategic fit."""

    def __init__(self):
        super().__init__("strategic_fit", max_tokens=SPECIALIST_MAX_TOKENS)

    async def analyze(self, context: dict) -> dict:
        """
        context keys:
          - request: dict
          - eligible_suppliers: list[dict]
          - policies: dict
        """
        try:
            request = context["request"]
            eligible_suppliers = context["eligible_suppliers"]
            policies = context.get("policies", {})

            supplier_strategic_data = [
                {
                    "supplier_id": s.get("supplier_id"),
                    "supplier_name": s.get("supplier_name"),
                    "esg_score": s.get("esg_score"),
                    "quality_score": s.get("quality_score"),
                    "is_preferred": s.get("is_preferred", False),
                    "is_incumbent": s.get("is_incumbent", False),
                    "country": s.get("country"),
                    "region": s.get("region"),
                }
                for s in eligible_suppliers
            ]

            # Category strategy context from policies
            category_strategies = policies.get("category_strategies", {})
            cat_key = f"{request.get('category_l1', '')}/{request.get('category_l2', '')}"
            category_strategy = category_strategies.get(
                cat_key,
                category_strategies.get(request.get("category_l1", ""), {}),
            )

            user_prompt = json.dumps(
                {
                    "request": {
                        "category_l1": request.get("category_l1"),
                        "category_l2": request.get("category_l2"),
                        "delivery_country": request.get("delivery_country"),
                        "esg_requirement": request.get("esg_requirement", False),
                        "preferred_supplier_stated": request.get("preferred_supplier_stated"),
                        "incumbent_supplier": request.get("incumbent_supplier"),
                    },
                    "supplier_profiles": supplier_strategic_data,
                    "category_strategy": category_strategy if isinstance(category_strategy, dict) else {},
                },
                default=str,
            )

            prompt = (
                "Evaluate the strategic fit of each supplier for this procurement "
                "request, considering ESG performance, preferred status, incumbent "
                "relationships, and category strategy.\n\n"
                f"{user_prompt}\n\n"
                "Return ONLY a JSON object with these keys:\n"
                "- supplier_strategic_scores: list of {id, strategic_score (0-100 where "
                "100 = best strategic fit), alignment_factors (list of strings describing "
                "alignment strengths or weaknesses)}\n"
                "- recommendation: string with overall strategic recommendation\n"
                "- confidence: float 0-1 indicating your confidence"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            result = self._parse_json_response(raw)
            return result

        except Exception:
            logger.exception("StrategicAgent failed, returning defaults")
            return self._defaults(context.get("eligible_suppliers", []))

    @staticmethod
    def _defaults(eligible_suppliers: list[dict[str, Any]]) -> dict:
        return {
            "supplier_strategic_scores": [
                {
                    "id": s.get("supplier_id", ""),
                    "strategic_score": 50,
                    "alignment_factors": ["Strategic analysis unavailable"],
                }
                for s in eligible_suppliers
            ],
            "recommendation": "Strategic assessment unavailable – using neutral scores.",
            "confidence": 0.3,
        }
