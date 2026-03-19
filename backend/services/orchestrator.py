"""Orchestrator – runs agents in parallel and merges deterministic + agent results.

NOTE: The universal orchestration supervisor (backend.services.supervisor) now
handles end-to-end orchestration.  This module is kept for backward compatibility
and is used by catalog_module.py for the _result_to_opinion helper and by
the supervisor for run_agents / run_specialist_agents.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from backend.models import (
    AgentOpinion,
    SupplierRanking,
)
from backend.services.agents.historical_agent import HistoricalAgent
from backend.services.agents.risk_agent import RiskAgent
from backend.services.agents.value_agent import ValueAgent
from backend.services.agents.strategic_agent import StrategicAgent

logger = logging.getLogger(__name__)

_EXECUTOR = ThreadPoolExecutor(max_workers=4)


# ---------------------------------------------------------------------------
# Run agents
# ---------------------------------------------------------------------------

async def run_agents(
    request: dict[str, Any],
    eligible_suppliers: list[dict[str, Any]],
    pricing_info: list[dict[str, Any]],
    historical_awards: list[dict[str, Any]],
    policies: dict[str, Any],
) -> list[AgentOpinion]:
    """Run all 4 agents in parallel and return their opinions."""

    agents_and_contexts: list[tuple[Any, dict]] = [
        (
            HistoricalAgent(),
            {
                "request": request,
                "eligible_suppliers": eligible_suppliers,
                "historical_awards": historical_awards,
            },
        ),
        (
            RiskAgent(),
            {
                "request": request,
                "eligible_suppliers": eligible_suppliers,
                "policies": policies,
            },
        ),
        (
            ValueAgent(),
            {
                "request": request,
                "eligible_suppliers": eligible_suppliers,
                "pricing_info": pricing_info,
            },
        ),
        (
            StrategicAgent(),
            {
                "request": request,
                "eligible_suppliers": eligible_suppliers,
                "policies": policies,
            },
        ),
    ]

    loop = asyncio.get_event_loop()

    def _run_agent_sync(agent, ctx: dict):
        """Run agent.analyze synchronously (the Claude API call is sync)."""
        try:
            # The agents are async def but don't actually await anything,
            # so we can run them in a new event loop
            import asyncio as _asyncio
            _loop = _asyncio.new_event_loop()
            try:
                result = _loop.run_until_complete(agent.analyze(ctx))
            finally:
                _loop.close()
            return _result_to_opinion(agent.name, result, eligible_suppliers)
        except Exception:
            logger.exception("Agent %s failed", agent.name)
            return None

    tasks = [
        loop.run_in_executor(_EXECUTOR, _run_agent_sync, agent, ctx)
        for agent, ctx in agents_and_contexts
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    opinions: list[AgentOpinion] = []
    for r in results:
        if isinstance(r, AgentOpinion):
            opinions.append(r)
        elif isinstance(r, Exception):
            logger.error("Agent task raised: %s", r)

    return opinions


# Alias for the new naming convention
run_specialist_agents = run_agents


def _result_to_opinion(
    agent_name: str,
    result: dict,
    eligible_suppliers: list[dict[str, Any]],
) -> AgentOpinion:
    """Convert raw agent result dict into an AgentOpinion model."""

    # Build a name lookup
    name_map = {s.get("supplier_id", ""): s.get("supplier_name", "") for s in eligible_suppliers}

    rankings: list[SupplierRanking] = []
    key_factors: list[str] = []

    # Determine which list of scores to use depending on agent
    score_lists = (
        result.get("supplier_rankings")
        or result.get("supplier_risk_assessments")
        or result.get("supplier_value_scores")
        or result.get("supplier_strategic_scores")
        or []
    )

    for entry in score_lists:
        sid = entry.get("id", entry.get("supplier_id", ""))
        # Normalize score: risk agent returns adjusted_risk (invert it)
        if "adjusted_risk" in entry:
            score = 100.0 - float(entry["adjusted_risk"])
        else:
            score = float(
                entry.get("score", entry.get("value_score", entry.get("strategic_score", 50)))
            )
        reasoning = (
            entry.get("reasoning")
            or entry.get("price_analysis")
            or ", ".join(entry.get("alignment_factors", entry.get("factors", [])))
            or ""
        )
        rankings.append(
            SupplierRanking(
                supplier_id=sid,
                supplier_name=name_map.get(sid, sid),
                score=score,
                rationale=reasoning,
            )
        )

    # Sort rankings by score descending
    rankings.sort(key=lambda r: r.score, reverse=True)

    # Extract key factors / insights
    if result.get("insights"):
        key_factors.append(result["insights"])
    if result.get("concentration_risk"):
        key_factors.append(f"Concentration risk: {result['concentration_risk']}")
    if result.get("budget_optimization"):
        key_factors.append(f"Budget: {result['budget_optimization']}")
    if result.get("recommendation"):
        key_factors.append(f"Strategy: {result['recommendation']}")

    summary = result.get("insights") or result.get("recommendation") or result.get("budget_optimization") or ""

    return AgentOpinion(
        agent_name=agent_name,
        opinion_summary=summary[:500],
        supplier_rankings=rankings,
        confidence=float(result.get("confidence", 0.5)),
        key_factors=key_factors,
    )
