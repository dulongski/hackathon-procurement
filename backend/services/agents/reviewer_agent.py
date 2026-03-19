"""Reviewer Agent — verifies consistency, evidence quality, and audit-readiness."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a procurement audit reviewer. Your role is to verify that the final "
    "recommendation package is:\n"
    "1. Internally consistent (recommendation matches escalations and validation)\n"
    "2. Fully evidenced (every ranked supplier has justification)\n"
    "3. Audit-ready (all required fields present, traceability complete)\n"
    "4. Uncertainty is visible (confidence scores make sense, risks are flagged)\n\n"
    "You review the FINAL package only. If you find issues, flag them — do not fix them.\n"
    "If issues are severe enough, recommend a targeted re-run of specific agents.\n\n"
    "Return ONLY a JSON object with these keys:\n"
    "- audit_ready: boolean\n"
    "- issues: list of objects, each with:\n"
    "    - issue_type: string (consistency, evidence, traceability, completeness)\n"
    "    - description: string\n"
    "    - severity: one of 'high', 'medium', 'low'\n"
    "- consistency_checks: list of strings describing checks performed\n"
    "- evidence_gaps: list of strings describing any missing evidence\n"
    "- sign_off_note: string with your overall assessment"
)


class ReviewerAgent(BaseAgent):
    """Verifies consistency, evidence quality, and audit-readiness of final output."""

    def __init__(self):
        super().__init__("reviewer")

    async def analyze(self, context: dict) -> dict:
        try:
            recommendation = context.get("recommendation", {})
            judge_decision = context.get("judge_decision", {})
            escalations = context.get("escalations", [])
            audit_trail = context.get("audit_trail", {})
            governance_memory = context.get("governance_memory", [])

            user_prompt = json.dumps(
                {
                    "recommendation": recommendation,
                    "judge_decision": judge_decision,
                    "escalations": escalations,
                    "audit_trail": audit_trail,
                    "governance_memory_hints": governance_memory[:3],
                },
                default=str,
            )

            prompt = (
                "Review the following final procurement recommendation package for "
                "consistency, evidence quality, and audit-readiness.\n\n"
                f"{user_prompt}"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            return self._parse_json_response(raw)

        except Exception:
            logger.exception("ReviewerAgent failed, returning default verdict")
            return {
                "audit_ready": False,
                "issues": [
                    {
                        "issue_type": "completeness",
                        "description": "Reviewer agent was unavailable — audit readiness unverified.",
                        "severity": "high",
                    }
                ],
                "consistency_checks": ["Reviewer unavailable"],
                "evidence_gaps": ["Full review not performed"],
                "sign_off_note": "Review incomplete due to agent failure. Manual review recommended.",
            }
