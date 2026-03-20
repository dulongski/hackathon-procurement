"""Catalog evaluation module — runs specialist agents for approved-supplier evaluation."""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from backend.models import AgentOpinion, SupplierRanking
from backend.services.agents.historical_agent import HistoricalAgent
from backend.services.agents.risk_agent import RiskAgent
from backend.services.agents.value_agent import ValueAgent
from backend.services.agents.strategic_agent import StrategicAgent

logger = logging.getLogger(__name__)
_EXECUTOR = ThreadPoolExecutor(max_workers=4)


def _run_agent_in_thread(agent, ctx: dict) -> AgentOpinion:
    """Run a single agent synchronously in a thread. Always returns an opinion."""
    try:
        import asyncio as _aio
        loop = _aio.new_event_loop()
        try:
            result = loop.run_until_complete(agent.analyze(ctx))
        finally:
            loop.close()
        return _convert_to_opinion(agent.name, result, ctx.get("eligible_suppliers", []))
    except Exception:
        logger.exception("Agent %s failed in catalog module — using fallback", agent.name)
        # Return a fallback opinion so this agent is never silently missing
        suppliers = ctx.get("eligible_suppliers", [])
        return AgentOpinion(
            agent_name=agent.name,
            opinion_summary=f"{agent.name.replace('_', ' ').title()} agent encountered an error. Scores are default estimates.",
            supplier_rankings=[
                SupplierRanking(
                    supplier_id=s.get("supplier_id", ""),
                    supplier_name=s.get("supplier_name", ""),
                    score=50,
                    rationale="Default score — agent was unavailable.",
                )
                for s in suppliers[:5]
            ],
            confidence=0.2,
            key_factors=["Agent fallback — low confidence"],
        )


def _convert_to_opinion(
    agent_name: str, result: dict, eligible_suppliers: list[dict]
) -> AgentOpinion:
    """Convert raw agent result to AgentOpinion model."""
    from backend.models import SupplierRanking

    name_map = {s.get("supplier_id", ""): s.get("supplier_name", "") for s in eligible_suppliers}

    score_lists = (
        result.get("supplier_rankings")
        or result.get("supplier_risk_assessments")
        or result.get("supplier_value_scores")
        or result.get("supplier_strategic_scores")
        or []
    )

    rankings = []
    for entry in score_lists:
        sid = entry.get("id", entry.get("supplier_id", ""))
        if "adjusted_risk" in entry:
            score = 100.0 - float(entry["adjusted_risk"])
        else:
            score = float(entry.get("score", entry.get("value_score", entry.get("strategic_score", 50))))
        reasoning = (
            entry.get("reasoning")
            or entry.get("price_analysis")
            or ", ".join(entry.get("alignment_factors", entry.get("factors", [])))
            or ""
        )
        rankings.append(SupplierRanking(
            supplier_id=sid,
            supplier_name=name_map.get(sid, sid),
            score=score,
            rationale=reasoning,
        ))

    rankings.sort(key=lambda r: r.score, reverse=True)

    key_factors = []
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


async def run_catalog_module(
    request: dict[str, Any],
    eligible_suppliers: list[dict[str, Any]],
    pricing_info: list[Any],
    historical_awards: list[dict[str, Any]],
    policies: dict[str, Any],
    specialist_agents: list[str] | None = None,
) -> list[AgentOpinion]:
    """Run relevant specialist agents for catalog evaluation.

    Args:
        specialist_agents: Optional list of agent names to run. If None, runs all 4.
    """
    # Build agent-context pairs based on which specialists are requested
    all_agents = {
        "historical_precedent": (
            HistoricalAgent(),
            {"request": request, "eligible_suppliers": eligible_suppliers, "historical_awards": historical_awards},
        ),
        "risk_assessment": (
            RiskAgent(),
            {"request": request, "eligible_suppliers": eligible_suppliers, "policies": policies},
        ),
        "value_for_money": (
            ValueAgent(),
            {"request": request, "eligible_suppliers": eligible_suppliers, "pricing_info": pricing_info},
        ),
        "strategic_fit": (
            StrategicAgent(),
            {"request": request, "eligible_suppliers": eligible_suppliers, "policies": policies},
        ),
    }

    # Filter to only requested specialists
    if specialist_agents:
        agents_to_run = {k: v for k, v in all_agents.items() if k in specialist_agents}
    else:
        agents_to_run = all_agents

    if not agents_to_run:
        return []

    # Mark incumbent status
    incumbent_name = request.get("incumbent_supplier")
    for sup in eligible_suppliers:
        sup["is_incumbent"] = sup.get("supplier_name") == incumbent_name if incumbent_name else False
        sup["is_preferred"] = sup.get("preferred_supplier", False)

    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(_EXECUTOR, _run_agent_in_thread, agent, ctx)
        for agent, ctx in agents_to_run.values()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    opinions = []
    for r in results:
        if isinstance(r, AgentOpinion):
            opinions.append(r)
        elif isinstance(r, Exception):
            logger.error("Catalog module agent failed: %s", r)
        # None values are now impossible — _run_agent_in_thread always returns AgentOpinion

    return opinions
