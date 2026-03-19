"""Supplier Discovery Agent — handles catalog gaps when no approved supplier exists."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a supplier discovery specialist. When no approved supplier exists for a "
    "procurement need, your role is to:\n"
    "1. Identify potential sourcing strategies\n"
    "2. Suggest market research approaches\n"
    "3. Outline qualification criteria for new suppliers\n"
    "4. Provide interim recommendations while discovery is in progress\n\n"
    "Return ONLY a JSON object with these keys:\n"
    "- discovery_strategy: string describing recommended approach\n"
    "- suggested_qualification_criteria: list of strings\n"
    "- market_notes: string with market intelligence observations\n"
    "- estimated_timeline: string (e.g., '2-4 weeks')\n"
    "- interim_recommendation: string with what to do while searching"
)


class DiscoveryAgent(BaseAgent):
    """Handles catalog gaps — suggests sourcing strategies when no approved supplier exists."""

    def __init__(self):
        super().__init__("supplier_discovery")

    async def analyze(self, context: dict) -> dict:
        try:
            request = context.get("request", {})
            catalog_gap = context.get("catalog_gap", {})
            excluded = context.get("excluded_suppliers", [])
            policies = context.get("policies", {})

            user_prompt = json.dumps(
                {
                    "request": {
                        "category_l1": request.get("category_l1"),
                        "category_l2": request.get("category_l2"),
                        "delivery_country": request.get("country"),
                        "quantity": request.get("quantity"),
                        "budget_amount": request.get("budget_amount"),
                        "currency": request.get("currency"),
                    },
                    "catalog_gap_reason": catalog_gap.get("reason", "No approved suppliers found"),
                    "excluded_suppliers_count": len(excluded),
                    "exclusion_reasons": [e.get("exclusion_reason", "") for e in excluded[:5]],
                },
                default=str,
            )

            prompt = (
                "No approved supplier exists for the following procurement request. "
                "Suggest a discovery and sourcing strategy.\n\n"
                f"{user_prompt}"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            return self._parse_json_response(raw)

        except Exception:
            logger.exception("DiscoveryAgent failed, returning defaults")
            return {
                "discovery_strategy": "Manual supplier identification required.",
                "suggested_qualification_criteria": [
                    "Active contract capability",
                    "Delivery country coverage",
                    "Category expertise",
                ],
                "market_notes": "Discovery agent unavailable.",
                "estimated_timeline": "Unknown",
                "interim_recommendation": "Escalate to procurement team for manual sourcing.",
            }
