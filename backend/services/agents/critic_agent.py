"""Critic Agent — reviews specialist outputs for contradictions, weak evidence, and bias."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent
from backend.config import GOVERNANCE_MAX_TOKENS

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a procurement decision critic. Your role is to find flaws, contradictions, "
    "weak evidence, and hidden risks in specialist agent analyses. You do NOT make "
    "recommendations or rank suppliers — you challenge the analyses.\n\n"
    "Look specifically for:\n"
    "- Score contradictions: agents scoring the same supplier very differently (>30 point spread)\n"
    "- Unsupported claims: rankings or assessments without cited evidence\n"
    "- Anchoring bias: over-weighting preferred/incumbent suppliers without justification\n"
    "- Hidden SLA degradation: lead time or capacity risks being understated\n"
    "- Over-optimistic savings assumptions\n"
    "- Missing risk factors that should have been considered\n\n"
    "Be concise. Return compact JSON. Keep descriptions brief.\n\n"
    "Return ONLY a JSON object with these keys:\n"
    "- findings: list of objects, each with:\n"
    "    - finding_id: string (CF-001, CF-002, etc.)\n"
    "    - finding_type: one of 'contradiction', 'weak_evidence', 'hidden_risk', "
    "'unsupported_claim', 'bias_alert'\n"
    "    - affected_agents: list of agent names involved\n"
    "    - affected_suppliers: list of supplier_ids affected\n"
    "    - description: clear description of the issue\n"
    "    - severity: one of 'high', 'medium', 'low'\n"
    "    - suggested_action: what should be done about it\n"
    "- overall_assessment: string summarizing the quality of specialist analyses\n"
    "- confidence: float 0-1 in your assessment"
)


class CriticAgent(BaseAgent):
    """Reviews specialist outputs for contradictions, weak evidence, and bias."""

    def __init__(self):
        super().__init__("critic", max_tokens=GOVERNANCE_MAX_TOKENS)

    async def analyze(self, context: dict) -> dict:
        try:
            specialist_opinions = context.get("specialist_opinions", [])
            constraint_summary = context.get("constraint_summary", {})
            governance_memory = context.get("governance_memory", [])

            user_prompt = json.dumps(
                {
                    "specialist_opinions": specialist_opinions,
                    "constraint_summary": constraint_summary,
                    "governance_memory_hints": governance_memory[:3],
                },
                default=str,
            )

            prompt = (
                "Review the following specialist agent analyses for a procurement request. "
                "Identify any contradictions, weak evidence, bias, or hidden risks.\n\n"
                f"{user_prompt}"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            return self._parse_json_response(raw)

        except Exception:
            logger.exception("CriticAgent failed, returning empty findings")
            return {
                "findings": [],
                "overall_assessment": "Critic analysis unavailable.",
                "confidence": 0.0,
            }
