"""Confidence scoring – combines agent agreement, data completeness, and validation quality."""

from __future__ import annotations

from typing import Any

from backend.models import (
    AgentOpinion,
    ConfidenceResult,
    PerSupplierConfidence,
    ValidationIssue,
)


def compute_confidence(
    agent_opinions: list[AgentOpinion],
    validation_issues: list[ValidationIssue],
    eligible_suppliers: list[dict[str, Any]],
    request: dict[str, Any],
) -> ConfidenceResult:
    """
    Compute an overall confidence score (0-1) based on:
    - Agent agreement on top supplier
    - Agent self-reported confidence
    - Data completeness (budget, quantity)
    - Validation issues severity
    - Edge cases / contradictions
    """

    factors: list[str] = []
    base_score = 0.75  # start with reasonable baseline

    # ---------------------------------------------------------------------------
    # 1. Agent agreement
    # ---------------------------------------------------------------------------
    top_picks: list[str] = []
    agent_confidences: list[float] = []

    for opinion in agent_opinions:
        if opinion.supplier_rankings:
            top_picks.append(opinion.supplier_rankings[0].supplier_id)
        if opinion.confidence is not None:
            agent_confidences.append(opinion.confidence)

    if len(top_picks) >= 2:
        unique_tops = set(top_picks)
        if len(unique_tops) == 1:
            base_score = 0.92
            factors.append(f"Strong agreement: all {len(top_picks)} agents rank the same supplier #1")
        elif len(unique_tops) == 2:
            base_score = 0.70
            factors.append(f"Partial agreement: agents split between {len(unique_tops)} top suppliers")
        else:
            base_score = 0.55
            factors.append(f"Low agreement: agents picked {len(unique_tops)} different top suppliers")
    elif len(top_picks) == 1:
        base_score = 0.60
        factors.append("Only one agent provided rankings")
    else:
        base_score = 0.40
        factors.append("No agent rankings available")

    # Factor in agent self-reported confidence
    if agent_confidences:
        avg_agent_conf = sum(agent_confidences) / len(agent_confidences)
        # Blend with base: shift base toward agent confidence
        base_score = 0.7 * base_score + 0.3 * avg_agent_conf
        factors.append(f"Average agent confidence: {avg_agent_conf:.2f}")

    # ---------------------------------------------------------------------------
    # 2. Data completeness
    # ---------------------------------------------------------------------------
    if not request.get("budget_amount"):
        base_score -= 0.15
        factors.append("Missing budget amount (-0.15)")

    if not request.get("quantity"):
        base_score -= 0.15
        factors.append("Missing quantity (-0.15)")

    if not request.get("delivery_country"):
        base_score -= 0.05
        factors.append("Missing delivery country (-0.05)")

    # ---------------------------------------------------------------------------
    # 3. Validation issues
    # ---------------------------------------------------------------------------
    for issue in validation_issues:
        severity = issue.severity if hasattr(issue, 'severity') else issue.get("severity", "")
        desc = issue.description if hasattr(issue, 'description') else issue.get("description", "")
        if severity == "critical":
            base_score -= 0.10
            factors.append(f"Critical issue: {desc[:80]} (-0.10)")
        elif severity == "high":
            base_score -= 0.05
            factors.append(f"High issue: {desc[:80]} (-0.05)")
        elif severity == "medium":
            base_score -= 0.02
            # Don't clutter factors with every medium issue

    # ---------------------------------------------------------------------------
    # 4. Edge cases / contradictions
    # ---------------------------------------------------------------------------
    # Check if agent opinions contradict each other significantly
    if len(agent_opinions) >= 2:
        # Look for cases where one agent scores a supplier very high and another very low
        supplier_score_ranges: dict[str, list[float]] = {}
        for opinion in agent_opinions:
            for ranking in opinion.supplier_rankings:
                supplier_score_ranges.setdefault(ranking.supplier_id, []).append(ranking.score)

        contradiction_count = 0
        for sid, scores in supplier_score_ranges.items():
            if len(scores) >= 2 and (max(scores) - min(scores)) > 50:
                contradiction_count += 1

        if contradiction_count > 0:
            penalty = min(contradiction_count * 0.10, 0.20)
            base_score -= penalty
            factors.append(
                f"Agent contradictions on {contradiction_count} supplier(s) (-{penalty:.2f})"
            )

    # ---------------------------------------------------------------------------
    # 5. Supplier pool size
    # ---------------------------------------------------------------------------
    if len(eligible_suppliers) == 0:
        base_score = 0.1
        factors.append("No eligible suppliers found")
    elif len(eligible_suppliers) == 1:
        base_score -= 0.05
        factors.append("Only one eligible supplier (-0.05)")

    # Clamp to [0, 1]
    overall = max(0.0, min(1.0, base_score))

    # ---------------------------------------------------------------------------
    # Per-supplier confidence
    # ---------------------------------------------------------------------------
    name_map = {s.get("supplier_id", ""): s.get("supplier_name", "") for s in eligible_suppliers}

    per_supplier: list[PerSupplierConfidence] = []
    supplier_score_ranges: dict[str, list[float]] = {}
    for opinion in agent_opinions:
        for ranking in opinion.supplier_rankings:
            supplier_score_ranges.setdefault(ranking.supplier_id, []).append(ranking.score)

    for sid, scores in supplier_score_ranges.items():
        if not scores:
            continue
        spread = max(scores) - min(scores)
        # Narrower spread → higher confidence
        supplier_conf = max(0.0, min(1.0, 1.0 - (spread / 100.0)))
        # Blend with overall
        supplier_conf = 0.5 * supplier_conf + 0.5 * overall

        explanation_parts = [f"Agent score range: {min(scores):.0f}-{max(scores):.0f}"]
        if spread > 40:
            explanation_parts.append("High disagreement between agents")
        elif spread < 15:
            explanation_parts.append("Strong agent consensus")

        per_supplier.append(
            PerSupplierConfidence(
                supplier_id=sid,
                supplier_name=name_map.get(sid, sid),
                score=round(supplier_conf, 3),
                explanation="; ".join(explanation_parts),
            )
        )

    # Sort by score descending
    per_supplier.sort(key=lambda x: x.score, reverse=True)

    # Build explanation
    explanation = (
        f"Overall confidence: {overall:.2f}. "
        f"Based on {len(agent_opinions)} agent opinions across "
        f"{len(eligible_suppliers)} eligible suppliers. "
        + " | ".join(factors[:5])
    )

    return ConfidenceResult(
        overall_score=round(overall, 3),
        per_supplier=per_supplier,
        explanation=explanation,
        factors=factors,
    )
