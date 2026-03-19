"""Discovery module — runs discovery + evaluation agents for catalog gaps."""

from __future__ import annotations

import logging
from typing import Any

from backend.models import DiscoveryResult
from backend.services.agents.discovery_agent import DiscoveryAgent
from backend.services.agents.evaluation_agent import EvaluationAgent

logger = logging.getLogger(__name__)


async def run_discovery_module(
    request: dict[str, Any],
    catalog_gap: dict[str, Any],
    excluded_suppliers: list[dict[str, Any]],
    policies: dict[str, Any],
) -> DiscoveryResult:
    """Run supplier discovery when no approved suppliers are available."""
    discovery_agent = DiscoveryAgent()
    discovery_result = await discovery_agent.analyze({
        "request": request,
        "catalog_gap": catalog_gap,
        "excluded_suppliers": excluded_suppliers,
        "policies": policies,
    })

    # Optionally run evaluation agent on discovery results
    eval_agent = EvaluationAgent()
    eval_result = await eval_agent.analyze({
        "request": request,
        "discovery_result": discovery_result,
        "policies": policies,
    })

    # Merge evaluation insights into discovery result
    strategy = discovery_result.get("discovery_strategy", "")
    if eval_result.get("recommendation"):
        strategy += f" Evaluation note: {eval_result['recommendation']}"

    return DiscoveryResult(
        discovery_strategy=strategy,
        suggested_qualification_criteria=discovery_result.get("suggested_qualification_criteria", []),
        market_notes=discovery_result.get("market_notes", ""),
        estimated_timeline=discovery_result.get("estimated_timeline"),
        interim_recommendation=discovery_result.get("interim_recommendation", ""),
    )
