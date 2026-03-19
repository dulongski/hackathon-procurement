"""Risk Assessment Agent – evaluates supplier risks including delivery, capacity, and concentration."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a procurement risk assessment specialist. "
    "Evaluate supplier risks including financial stability, delivery reliability, "
    "capacity constraints, concentration risk, and compliance factors. "
    "Provide actionable risk assessments for each supplier."
)


class RiskAgent(BaseAgent):
    """Evaluates supplier risks based on risk scores, delivery, capacity, and restrictions."""

    def __init__(self):
        super().__init__("risk_assessment")

    async def analyze(self, context: dict) -> dict:
        """
        context keys:
          - request: dict
          - eligible_suppliers: list[dict]
          - policies: dict (restriction info)
        """
        try:
            request = context["request"]
            eligible_suppliers = context["eligible_suppliers"]
            policies = context.get("policies", {})

            supplier_risk_data = [
                {
                    "supplier_id": s.get("supplier_id"),
                    "supplier_name": s.get("supplier_name"),
                    "risk_score": s.get("risk_score"),
                    "quality_score": s.get("quality_score"),
                    "lead_time_days": s.get("lead_time_days"),
                    "expedited_lead_time_days": s.get("expedited_lead_time_days"),
                    "capacity": s.get("capacity"),
                    "is_restricted": s.get("is_restricted", False),
                    "country": s.get("country"),
                    "region": s.get("region"),
                }
                for s in eligible_suppliers
            ]

            # Build restriction context
            restricted_suppliers = policies.get("restricted_suppliers", [])
            restriction_context = [
                {"supplier_id": r.get("supplier_id"), "reason": r.get("reason", "")}
                for r in restricted_suppliers
            ] if isinstance(restricted_suppliers, list) else []

            user_prompt = json.dumps(
                {
                    "request": {
                        "category_l1": request.get("category_l1"),
                        "category_l2": request.get("category_l2"),
                        "delivery_country": request.get("delivery_country"),
                        "quantity": request.get("quantity"),
                        "required_by_date": request.get("required_by_date"),
                        "days_until_required": request.get("days_until_required"),
                    },
                    "supplier_risk_profiles": supplier_risk_data,
                    "restricted_suppliers": restriction_context,
                },
                default=str,
            )

            prompt = (
                "Evaluate the risk profile for each supplier in the context of this "
                "procurement request.\n\n"
                f"{user_prompt}\n\n"
                "Return ONLY a JSON object with these keys:\n"
                "- supplier_risk_assessments: list of {id, adjusted_risk (0-100 where "
                "100 = highest risk), factors (list of risk factor strings)}\n"
                "- concentration_risk: string describing any concentration risk if "
                "multiple suppliers share geography/ownership\n"
                "- confidence: float 0-1 indicating your confidence in the assessment"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            result = self._parse_json_response(raw)
            return result

        except Exception:
            logger.exception("RiskAgent failed, returning defaults")
            return self._defaults(context.get("eligible_suppliers", []))

    @staticmethod
    def _defaults(eligible_suppliers: list[dict[str, Any]]) -> dict:
        return {
            "supplier_risk_assessments": [
                {
                    "id": s.get("supplier_id", ""),
                    "adjusted_risk": s.get("risk_score", 50),
                    "factors": ["Default assessment – agent unavailable"],
                }
                for s in eligible_suppliers
            ],
            "concentration_risk": "Unable to assess concentration risk.",
            "confidence": 0.3,
        }
