"""Feedback loop — converts governance findings into memory entries and audit artifacts."""

from __future__ import annotations

import logging
from typing import Any

from backend.models import (
    CriticOutput,
    JudgeDecision,
    MemoryEntry,
    ReviewerVerdict,
)
from backend.services.governance_memory import get_governance_memory

logger = logging.getLogger(__name__)


def process_critic_feedback(
    critic_output: CriticOutput,
    request_id: str,
) -> list[MemoryEntry]:
    """Convert critic findings into governance memory entries."""
    memory = get_governance_memory()
    entries: list[MemoryEntry] = []

    for finding in critic_output.findings:
        if finding.severity == "high":
            entry = memory.store_memory(
                scope="critic",
                entry_type=finding.finding_type,
                content=(
                    f"[{finding.finding_id}] {finding.description} "
                    f"Affected agents: {', '.join(finding.affected_agents)}. "
                    f"Affected suppliers: {', '.join(finding.affected_suppliers)}."
                ),
                source_request_id=request_id,
                relevance_score=0.9 if finding.severity == "high" else 0.6,
            )
            entries.append(entry)

    return entries


def process_judge_feedback(
    judge_decision: JudgeDecision,
    request_id: str,
) -> list[MemoryEntry]:
    """Convert judge decision patterns into governance memory."""
    memory = get_governance_memory()
    entries: list[MemoryEntry] = []

    # Store bias checks as memory
    for bias_check in judge_decision.bias_checks:
        if "detected" in bias_check.lower() or "alert" in bias_check.lower():
            entry = memory.store_memory(
                scope="judge",
                entry_type="bias_alert",
                content=bias_check,
                source_request_id=request_id,
                relevance_score=0.8,
            )
            entries.append(entry)

    # Store confidence calibration
    if judge_decision.confidence_assessment < 0.5:
        entry = memory.store_memory(
            scope="judge",
            entry_type="confidence_calibration",
            content=(
                f"Low confidence ({judge_decision.confidence_assessment:.2f}): "
                f"{judge_decision.confidence_explanation}"
            ),
            source_request_id=request_id,
            relevance_score=0.7,
        )
        entries.append(entry)

    # Store disagreement patterns
    for resolution in judge_decision.disagreements_resolved:
        entry = memory.store_memory(
            scope="judge",
            entry_type="disagreement_pattern",
            content=(
                f"Disagreement on '{resolution.topic}' between "
                f"{', '.join(resolution.agents_involved)}: {resolution.reasoning}"
            ),
            source_request_id=request_id,
            relevance_score=0.6,
        )
        entries.append(entry)

    return entries


def process_reviewer_feedback(
    reviewer_verdict: ReviewerVerdict,
    request_id: str,
) -> list[MemoryEntry]:
    """Convert reviewer findings into governance memory."""
    memory = get_governance_memory()
    entries: list[MemoryEntry] = []

    for issue in reviewer_verdict.issues:
        if issue.severity in ("high", "critical"):
            entry = memory.store_memory(
                scope="reviewer",
                entry_type="audit_defect",
                content=f"[{issue.issue_type}] {issue.description}",
                source_request_id=request_id,
                relevance_score=0.85,
            )
            entries.append(entry)

    for gap in reviewer_verdict.evidence_gaps:
        entry = memory.store_memory(
            scope="reviewer",
            entry_type="evidence_gap",
            content=gap,
            source_request_id=request_id,
            relevance_score=0.7,
        )
        entries.append(entry)

    return entries


def run_feedback_loop(
    critic_output: CriticOutput | None,
    judge_decision: JudgeDecision | None,
    reviewer_verdict: ReviewerVerdict | None,
    request_id: str,
) -> list[MemoryEntry]:
    """Run the full feedback loop, writing to governance memory."""
    all_entries: list[MemoryEntry] = []

    if critic_output:
        all_entries.extend(process_critic_feedback(critic_output, request_id))

    if judge_decision:
        all_entries.extend(process_judge_feedback(judge_decision, request_id))

    if reviewer_verdict:
        all_entries.extend(process_reviewer_feedback(reviewer_verdict, request_id))

    logger.info(
        "Feedback loop wrote %d governance memory entries for %s",
        len(all_entries),
        request_id,
    )
    return all_entries
