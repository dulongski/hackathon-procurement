"""Supplier Evaluation Agent — evaluates discovered or non-catalog suppliers."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a supplier evaluation specialist for newly discovered or non-catalog suppliers. "
    "Evaluate potential suppliers against procurement criteria including:\n"
    "- Category fit and capability\n"
    "- Delivery coverage and logistics\n"
    "- Compliance and regulatory requirements\n"
    "- Risk profile and financial stability\n"
    "- Pricing competitiveness estimates\n"
    "- Onboarding requirements and timeline\n\n"
    "Return ONLY a JSON object with these keys:\n"
    "- evaluation_summary: string overall assessment\n"
    "- compliance_assessment: string\n"
    "- estimated_risk_level: one of 'low', 'medium', 'high'\n"
    "- onboarding_requirements: list of strings\n"
    "- recommendation: string\n"
    "- confidence: float 0-1"
)


class EvaluationAgent(BaseAgent):
    """Evaluates discovered or non-catalog suppliers against procurement criteria."""

    def __init__(self):
        super().__init__("supplier_evaluation")

    async def analyze(self, context: dict) -> dict:
        try:
            request = context.get("request", {})
            discovery_result = context.get("discovery_result", {})
            policies = context.get("policies", {})

            user_prompt = json.dumps(
                {
                    "request": {
                        "category_l1": request.get("category_l1"),
                        "category_l2": request.get("category_l2"),
                        "delivery_country": request.get("country"),
                        "quantity": request.get("quantity"),
                    },
                    "discovery_strategy": discovery_result.get("discovery_strategy", ""),
                    "qualification_criteria": discovery_result.get(
                        "suggested_qualification_criteria", []
                    ),
                },
                default=str,
            )

            prompt = (
                "Evaluate the potential for onboarding new suppliers based on the "
                "following discovery results and procurement requirements.\n\n"
                f"{user_prompt}"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            return self._parse_json_response(raw)

        except Exception:
            logger.exception("EvaluationAgent failed, returning defaults")
            return {
                "evaluation_summary": "Evaluation unavailable.",
                "compliance_assessment": "Manual review required.",
                "estimated_risk_level": "high",
                "onboarding_requirements": ["Full supplier qualification process required"],
                "recommendation": "Proceed with manual evaluation.",
                "confidence": 0.2,
            }
