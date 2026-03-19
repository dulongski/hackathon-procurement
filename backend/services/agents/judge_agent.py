"""Judge Agent — final adjudicator that resolves disagreements and produces the definitive ranking."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are the final procurement adjudicator. Your role is to:\n"
    "1. Review all specialist agent opinions and the critic's findings\n"
    "2. Resolve any disagreements between agents\n"
    "3. Check for and correct biases (incumbent preference, lowest-price anchoring, "
    "preferred-supplier favoritism)\n"
    "4. Produce the FINAL supplier ranking with explicit justification for each rank\n"
    "5. Explain your weighting rationale\n\n"
    "You replace the hard-coded scoring algorithm. Your ranking IS the system's ranking.\n\n"
    "Consider deterministic constraints as non-negotiable boundaries:\n"
    "- If a supplier is policy-restricted, they cannot be ranked #1\n"
    "- If budget is insufficient at all suppliers, status must be 'cannot_proceed'\n"
    "- If all lead times are infeasible, flag this prominently\n\n"
    "Return ONLY a JSON object with these keys:\n"
    "- final_ranking: list of objects, each with:\n"
    "    - supplier_id: string\n"
    "    - supplier_name: string\n"
    "    - rank: integer (1 = best)\n"
    "    - composite_score: float 0-100\n"
    "    - justification: string explaining why this rank\n"
    "- disagreements_resolved: list of objects, each with:\n"
    "    - topic: what agents disagreed about\n"
    "    - agents_involved: list of agent names\n"
    "    - resolution: what you decided\n"
    "    - reasoning: why\n"
    "- bias_checks: list of strings describing bias checks performed\n"
    "- confidence_assessment: float 0-1\n"
    "- confidence_explanation: string explaining confidence level\n"
    "- weight_rationale: string explaining how you weighted different factors"
)


class JudgeAgent(BaseAgent):
    """Final adjudicator — resolves disagreements and produces definitive ranking."""

    def __init__(self):
        super().__init__("judge")

    async def analyze(self, context: dict) -> dict:
        try:
            specialist_opinions = context.get("specialist_opinions", [])
            critic_findings = context.get("critic_findings", [])
            deterministic_constraints = context.get("deterministic_constraints", {})
            governance_memory = context.get("governance_memory", [])

            user_prompt = json.dumps(
                {
                    "specialist_opinions": specialist_opinions,
                    "critic_findings": critic_findings,
                    "deterministic_constraints": deterministic_constraints,
                    "governance_memory_hints": governance_memory[:3],
                },
                default=str,
            )

            prompt = (
                "As the final adjudicator, review all specialist opinions, critic findings, "
                "and deterministic constraints below. Produce the definitive supplier ranking.\n\n"
                f"{user_prompt}"
            )

            raw = self._call_claude(SYSTEM_PROMPT, prompt)
            return self._parse_json_response(raw)

        except Exception:
            logger.exception("JudgeAgent failed, returning fallback")
            return self._fallback(context)

    @staticmethod
    def _fallback(context: dict) -> dict:
        """Deterministic fallback if Claude call fails."""
        opinions = context.get("specialist_opinions", [])
        # Average specialist scores as a simple fallback
        supplier_scores: dict[str, list[float]] = {}
        supplier_names: dict[str, str] = {}
        for op in opinions:
            rankings = op.get("supplier_rankings", [])
            if hasattr(op, "supplier_rankings"):
                rankings = [r.model_dump() if hasattr(r, "model_dump") else r for r in op.supplier_rankings]
            for r in rankings:
                sid = r.get("supplier_id", r.get("id", ""))
                supplier_scores.setdefault(sid, []).append(float(r.get("score", 50)))
                supplier_names[sid] = r.get("supplier_name", sid)

        ranked = []
        for sid, scores in supplier_scores.items():
            avg = sum(scores) / len(scores) if scores else 50
            ranked.append({"supplier_id": sid, "supplier_name": supplier_names.get(sid, sid), "composite_score": round(avg, 2)})

        ranked.sort(key=lambda x: x["composite_score"], reverse=True)
        for i, s in enumerate(ranked):
            s["rank"] = i + 1
            s["justification"] = "Fallback: average of specialist scores (judge unavailable)."

        return {
            "final_ranking": ranked,
            "disagreements_resolved": [],
            "bias_checks": ["Judge unavailable — no bias checks performed"],
            "confidence_assessment": 0.3,
            "confidence_explanation": "Low confidence: judge agent was unavailable, using specialist score average as fallback.",
            "weight_rationale": "Equal weight to all specialist opinions (fallback mode).",
        }
