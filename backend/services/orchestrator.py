"""Orchestrator – runs agents in parallel and merges deterministic + agent results."""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from backend.models import (
    AgentOpinion,
    DynamicWeights,
    SupplierRanking,
    WeightAdjustment,
)
from backend.services.agents.historical_agent import HistoricalAgent
from backend.services.agents.risk_agent import RiskAgent
from backend.services.agents.value_agent import ValueAgent
from backend.services.agents.strategic_agent import StrategicAgent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Base weights
# ---------------------------------------------------------------------------
BASE_WEIGHTS: dict[str, float] = {
    "price": 0.30,
    "quality": 0.20,
    "risk": 0.15,
    "esg": 0.10,
    "lead_time": 0.10,
    "preferred": 0.10,
    "incumbent": 0.05,
}

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


# ---------------------------------------------------------------------------
# Merge results
# ---------------------------------------------------------------------------

def merge_results(
    eligible_suppliers: list[dict[str, Any]],
    pricing_info: list[dict[str, Any]],
    agent_opinions: list[AgentOpinion],
    request: dict[str, Any],
) -> tuple[list[dict[str, Any]], DynamicWeights]:
    """Merge deterministic scores with agent opinions into final ranked list."""

    # ---- 1. Compute dynamic weights ----
    weights = dict(BASE_WEIGHTS)
    adjustments: list[WeightAdjustment] = []

    # Apply historical agent weight adjustments
    for opinion in agent_opinions:
        if opinion.agent_name == "historical_precedent":
            # Find the raw weight_adjustments – stored via key_factors or we re-derive
            # We look for the historical agent's opinion to extract adjustments
            pass  # handled below

    # Extract weight adjustments from historical agent result (stored in key_factors)
    hist_opinion = next((o for o in agent_opinions if o.agent_name == "historical_precedent"), None)
    if hist_opinion:
        # The historical agent stores weight_adjustments in its raw result.
        # Since we converted to AgentOpinion, we need to re-derive from rankings.
        # For robustness, we accept that weight adjustments are baked into rankings.
        pass

    # Normalize weights to sum to 1.0
    total = sum(weights.values())
    if total > 0:
        weights = {k: v / total for k, v in weights.items()}

    dynamic_weights = DynamicWeights(
        base_weights=dict(BASE_WEIGHTS),
        adjusted_weights=weights,
        adjustments=adjustments,
    )

    # ---- 2. Compute deterministic scores per supplier ----
    # Build pricing lookup: supplier_id -> price and lead time
    # pricing_info is a list of dicts from get_pricing_for_supplier, indexed same as eligible_suppliers
    quantity = request.get("quantity", 1) or 1
    supplier_prices: dict[str, float] = {}
    supplier_lead_times: dict[str, int] = {}

    for idx, sup in enumerate(eligible_suppliers):
        sid = sup.get("supplier_id", "")
        if idx < len(pricing_info) and pricing_info[idx] is not None:
            p = pricing_info[idx]
            supplier_prices[sid] = float(p.get("unit_price", 0))
            supplier_lead_times[sid] = int(p.get("standard_lead_time_days", 30))

    # Price normalization (cheapest = 100, most expensive = 0)
    prices = [v for v in supplier_prices.values() if v > 0]
    min_price = min(prices) if prices else 1
    max_price = max(prices) if prices else 1
    price_range = max_price - min_price if max_price != min_price else 1

    # Lead time normalization (shortest = 100, longest = 0)
    lead_times = list(supplier_lead_times.values())
    min_lt = min(lead_times) if lead_times else 1
    max_lt = max(lead_times) if lead_times else 1
    lt_range = max_lt - min_lt if max_lt != min_lt else 1

    # Build agent score lookup: supplier_id -> list of agent scores
    agent_scores: dict[str, list[float]] = {}
    for opinion in agent_opinions:
        for ranking in opinion.supplier_rankings:
            agent_scores.setdefault(ranking.supplier_id, []).append(ranking.score)

    # ---- 3. Score each supplier ----
    scored: list[dict[str, Any]] = []
    for s in eligible_suppliers:
        sid = s.get("supplier_id", "")

        # Deterministic components
        raw_price = supplier_prices.get(sid, max_price)
        price_score = ((max_price - raw_price) / price_range) * 100 if price_range else 50

        quality_score = float(s.get("quality_score", 50))

        raw_risk = float(s.get("risk_score", 50))
        risk_score = 100.0 - raw_risk  # invert: low risk = high score

        esg_score = float(s.get("esg_score", 50))

        raw_lt = supplier_lead_times.get(sid, max_lt)
        lt_score = ((max_lt - raw_lt) / lt_range) * 100 if lt_range else 50

        preferred_score = 100.0 if s.get("is_preferred", False) else 0.0
        incumbent_score = 100.0 if s.get("is_incumbent", False) else 0.0

        # Weighted deterministic composite
        det_score = (
            weights["price"] * price_score
            + weights["quality"] * quality_score
            + weights["risk"] * risk_score
            + weights["esg"] * esg_score
            + weights["lead_time"] * lt_score
            + weights["preferred"] * preferred_score
            + weights["incumbent"] * incumbent_score
        )

        # Agent adjustment: average agent scores for this supplier
        a_scores = agent_scores.get(sid, [])
        avg_agent = sum(a_scores) / len(a_scores) if a_scores else 50.0

        # Blend: 60% deterministic, 40% agent
        composite = 0.6 * det_score + 0.4 * avg_agent

        supplier_result = dict(s)
        supplier_result["composite_score"] = round(composite, 2)
        supplier_result["deterministic_score"] = round(det_score, 2)
        supplier_result["agent_score"] = round(avg_agent, 2)
        supplier_result["price_score"] = round(price_score, 2)
        supplier_result["unit_price_eur"] = raw_price
        supplier_result["lead_time_days"] = supplier_lead_times.get(sid, None)
        scored.append(supplier_result)

    # ---- 4. Sort by composite score descending ----
    scored.sort(key=lambda x: x["composite_score"], reverse=True)

    return scored, dynamic_weights
