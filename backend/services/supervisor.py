"""Orchestration Supervisor — universal control plane for every procurement request.

Every request flows through:
1. Deterministic constraint snapshot
2. Module activation planning
3. Specialist module execution
4. Governance pass (Critic → Judge → Reviewer)
5. Feedback loop → governance memory
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.data_loader import ProcurementData
from backend.models import (
    ActivationPlan,
    AgentOpinion,
    BundleModuleResult,
    ConstraintSnapshot,
    CriticOutput,
    CriticFinding,
    DiscoveryResult,
    GovernanceOutput,
    JudgeDecision,
    JudgedSupplier,
    DisagreementResolution,
    MemoryEntry,
    OrchestrationResult,
    ProcessStep,
    ProcessTrace,
    ReviewerVerdict,
    ReviewIssue,
)
from backend.services.rule_engine import validate_request, evaluate_policies
from backend.services.supplier_filter import (
    filter_suppliers,
    get_pricing_for_supplier,
    detect_catalog_gap,
    detect_bundle_opportunity,
)
from backend.services.escalation import check_escalations
from backend.services.context_pack_builder import (
    build_critic_context,
    build_judge_context,
    build_reviewer_context,
)
from backend.services.feedback_loop import run_feedback_loop

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Step helpers
# ---------------------------------------------------------------------------

def _step(step_id: str, name: str, step_type: str, step_description: str | None = None) -> ProcessStep:
    return ProcessStep(
        step_id=step_id,
        step_name=name,
        step_type=step_type,
        started_at=datetime.now(timezone.utc).isoformat(),
        status="pending",
        step_description=step_description,
    )


def _complete(step: ProcessStep, summary: str | None = None) -> ProcessStep:
    step.completed_at = datetime.now(timezone.utc).isoformat()
    step.status = "completed"
    if summary:
        step.output_summary = summary
    if step.started_at and step.completed_at:
        try:
            s = datetime.fromisoformat(step.started_at)
            e = datetime.fromisoformat(step.completed_at)
            step.duration_ms = int((e - s).total_seconds() * 1000)
        except (ValueError, TypeError):
            pass
    return step


def _fail(step: ProcessStep, reason: str) -> ProcessStep:
    step.completed_at = datetime.now(timezone.utc).isoformat()
    step.status = "failed"
    step.output_summary = reason
    return step


def _compute_contract_value(
    pricing_info: list[Any], quantity: float | None
) -> float:
    if not quantity or quantity <= 0:
        return 0.0
    cheapest: float | None = None
    for p in pricing_info:
        if p is None:
            continue
        up = p.get("unit_price")
        if up is not None and (cheapest is None or up < cheapest):
            cheapest = up
    return cheapest * quantity if cheapest else 0.0


# ---------------------------------------------------------------------------
# Phase A: Build Constraint Snapshot
# ---------------------------------------------------------------------------

def build_constraint_snapshot(
    request: dict[str, Any],
    data: ProcurementData,
) -> tuple[ConstraintSnapshot, ProcessStep]:
    """Run all deterministic checks and package into a typed snapshot."""
    step = _step("CS-001", "Applying Rules & Constraints", "deterministic",
                 "Checking policies, budgets, lead times, and supplier eligibility.")

    category_l1 = request.get("category_l1", "")
    category_l2 = request.get("category_l2", "")
    quantity = request.get("quantity") or 0
    delivery_countries = request.get("delivery_countries", [])
    delivery_country = delivery_countries[0] if delivery_countries else request.get("country", "")

    # Filter suppliers
    eligible, excluded, near_miss = filter_suppliers(request, data.suppliers, data.pricing, data.policies)

    # Get pricing
    pricing_info: list[Any] = []
    for sup in eligible:
        pricing = get_pricing_for_supplier(
            sup["supplier_id"], category_l1, category_l2,
            delivery_country, quantity if quantity > 0 else 1, data.pricing,
        )
        pricing_info.append(pricing)

    # Validate
    validation_issues = validate_request(request, data.suppliers, data.pricing)

    # Contract value
    contract_value = _compute_contract_value(pricing_info, quantity)
    if contract_value == 0.0 and request.get("budget_amount"):
        contract_value = float(request["budget_amount"])

    # Policy evaluation
    policy_eval = evaluate_policies(request, contract_value, eligible, data.policies)

    # Supplier-category mismatch warning
    pref_eval = policy_eval.get("preferred_supplier", {})
    if pref_eval.get("mentioned") and not pref_eval.get("is_preferred", False):
        validation_issues.append({
            "issue_id": f"V-{len(validation_issues)+1:03d}",
            "severity": "high",
            "type": "supplier_category_mismatch",
            "description": (
                f"Preferred supplier {pref_eval.get('supplier_name', 'unknown')} is not a registered "
                f"provider for {category_l1}/{category_l2}; alternative suppliers were considered."
            ),
            "action_required": "Review supplier qualification or select an approved supplier for this category.",
        })

    # Escalations
    escalations = check_escalations(request, validation_issues, policy_eval, eligible, pricing_info)

    # Catalog gap detection
    catalog_gap = detect_catalog_gap(eligible, excluded, category_l1, category_l2, delivery_country)

    # Bundle opportunity detection
    bundle_opportunity = detect_bundle_opportunity(request, data.requests, data.pricing)

    snapshot = ConstraintSnapshot(
        eligible_suppliers=eligible,
        excluded_suppliers=excluded,
        near_miss_suppliers=near_miss,
        pricing_info=pricing_info,
        validation_issues=validation_issues,
        policy_evaluation=policy_eval,
        escalations=escalations,
        contract_value=contract_value,
        catalog_gap=type("Obj", (), catalog_gap)() if False else None,  # Store as dict for now
        bundle_opportunity=type("Obj", (), bundle_opportunity)() if False else None,
    )
    # Store raw dicts for easy access
    snapshot._catalog_gap_raw = catalog_gap
    snapshot._bundle_opportunity_raw = bundle_opportunity

    esc_note = f" · {len(escalations)} escalation{'s' if len(escalations) != 1 else ''}" if escalations else ""
    _complete(step, f"{len(eligible)} qualified, {len(excluded)} excluded{esc_note}")
    return snapshot, step


# ---------------------------------------------------------------------------
# Phase A: Build Activation Plan
# ---------------------------------------------------------------------------

def build_activation_plan(
    request: dict[str, Any],
    snapshot: ConstraintSnapshot,
) -> tuple[ActivationPlan, ProcessStep]:
    """Decide which modules to activate based on constraint snapshot signals."""
    step = _step("AP-001", "Planning Analysis Strategy", "deterministic",
                 "Deciding which analysis modules to activate based on constraint signals.")

    modules: list[str] = []
    reasons: dict[str, str] = {}
    specialists: list[str] = []

    catalog_gap = getattr(snapshot, "_catalog_gap_raw", {})
    bundle_opp = getattr(snapshot, "_bundle_opportunity_raw", {})
    is_whitespace = request.get("is_whitespace", False)

    # whitespace_discovery: when category is not in taxonomy
    if is_whitespace:
        modules.append("whitespace_discovery")
        reasons["whitespace_discovery"] = "Category not in taxonomy — unmet demand discovery required"

    # catalog_evaluation: activate if eligible suppliers exist and NOT whitespace
    if len(snapshot.eligible_suppliers) > 0 and not is_whitespace:
        modules.append("catalog_evaluation")
        reasons["catalog_evaluation"] = f"{len(snapshot.eligible_suppliers)} eligible suppliers found"
        specialists.extend(["historical_precedent", "risk_assessment", "value_for_money", "strategic_fit"])

    # new_supplier_discovery: when no eligible suppliers
    if catalog_gap.get("has_gap"):
        modules.append("new_supplier_discovery")
        reasons["new_supplier_discovery"] = catalog_gap.get("reason", "No approved suppliers")

    # bundling_optimization: when bundle opportunity detected
    if bundle_opp.get("has_opportunity"):
        modules.append("bundling_optimization")
        reasons["bundling_optimization"] = (
            f"Bundle opportunity with {len(bundle_opp.get('related_request_ids', []))} related requests, "
            f"estimated {bundle_opp.get('estimated_savings_pct', 0)}% savings"
        )

    # threshold_approval_review: when multi-quote or deviation needed
    approval = snapshot.policy_evaluation.get("approval_threshold") or {}
    quotes_req = approval.get("quotes_required", 1)
    has_deviation = bool(approval.get("deviation_approval"))
    if quotes_req > 1 or has_deviation:
        modules.append("threshold_approval_review")
        reasons["threshold_approval_review"] = f"Requires {quotes_req} quotes, deviation={has_deviation}"

    # escalation_review: when any escalation triggered
    if snapshot.escalations:
        modules.append("escalation_review")
        reasons["escalation_review"] = f"{len(snapshot.escalations)} escalation(s) triggered"

    plan = ActivationPlan(
        activated_modules=modules,
        activation_reasons=reasons,
        specialist_agents=list(set(specialists)),
    )

    module_labels = {"catalog_evaluation": "Supplier Analysis", "new_supplier_discovery": "Discovery", "bundling_optimization": "Bundling", "threshold_approval_review": "Approval Check", "escalation_review": "Escalation Review"}
    nice_names = [module_labels.get(m, m.replace("_", " ").title()) for m in modules]
    _complete(step, " + ".join(nice_names))
    return plan, step


# ---------------------------------------------------------------------------
# Governance agent runners
# ---------------------------------------------------------------------------

async def _run_governance_agent(agent, context: dict) -> dict:
    """Run a governance agent (critic/judge/reviewer) and return raw dict."""
    try:
        loop = asyncio.get_event_loop()
        from concurrent.futures import ThreadPoolExecutor
        executor = ThreadPoolExecutor(max_workers=1)

        def _sync():
            import asyncio as _aio
            _loop = _aio.new_event_loop()
            try:
                return _loop.run_until_complete(agent.analyze(context))
            finally:
                _loop.close()

        return await loop.run_in_executor(executor, _sync)
    except Exception:
        logger.exception("Governance agent %s failed", agent.name)
        raise


async def run_critic(
    specialist_opinions: list[AgentOpinion],
    snapshot: ConstraintSnapshot,
) -> tuple[CriticOutput, ProcessStep]:
    """Run the Critic Agent."""
    step = _step("GOV-001", "Challenging the Analysis", "governance",
                 "Independent critic checking for bias, weak evidence, and gaps.")

    try:
        from backend.services.agents.critic_agent import CriticAgent
        context = build_critic_context(
            specialist_opinions,
            {
                "eligible_suppliers": snapshot.eligible_suppliers,
                "validation_issues": snapshot.validation_issues,
                "escalations": snapshot.escalations,
                "policy_evaluation": snapshot.policy_evaluation,
            },
        )
        agent = CriticAgent()
        raw = await _run_governance_agent(agent, context)

        findings = [
            CriticFinding(**f) for f in raw.get("findings", [])
        ]
        output = CriticOutput(
            findings=findings,
            overall_assessment=raw.get("overall_assessment", ""),
            confidence=float(raw.get("confidence", 0.5)),
        )
        count = len(findings)
        _complete(step, "No issues" if count == 0 else f"{count} issue{'s' if count != 1 else ''} flagged")
        return output, step

    except Exception as e:
        logger.exception("Critic failed")
        output = CriticOutput(findings=[], overall_assessment="Critic unavailable.", confidence=0.0)
        _fail(step, str(e))
        return output, step


async def run_judge(
    specialist_opinions: list[AgentOpinion],
    critic_output: CriticOutput,
    snapshot: ConstraintSnapshot,
) -> tuple[JudgeDecision, ProcessStep]:
    """Run the Judge Agent."""
    step = _step("GOV-002", "Ranking Suppliers", "governance",
                 "Final adjudicator producing the definitive ranking.")

    try:
        from backend.services.agents.judge_agent import JudgeAgent
        context = build_judge_context(
            specialist_opinions,
            [f.model_dump() for f in critic_output.findings],
            {
                "eligible_suppliers": snapshot.eligible_suppliers,
                "pricing_info": snapshot.pricing_info,
                "validation_issues": snapshot.validation_issues,
                "policy_evaluation": snapshot.policy_evaluation,
                "escalations": snapshot.escalations,
                "contract_value": snapshot.contract_value,
                "_agent_guardrail": getattr(snapshot, "_agent_guardrail", ""),
            },
        )
        agent = JudgeAgent()
        raw = await _run_governance_agent(agent, context)

        ranking = [JudgedSupplier(**s) for s in raw.get("final_ranking", [])]
        resolutions = [DisagreementResolution(**d) for d in raw.get("disagreements_resolved", [])]

        decision = JudgeDecision(
            final_ranking=ranking,
            disagreements_resolved=resolutions,
            bias_checks=raw.get("bias_checks", []),
            confidence_assessment=float(raw.get("confidence_assessment", 0.5)),
            confidence_explanation=raw.get("confidence_explanation", ""),
            weight_rationale=raw.get("weight_rationale", ""),
        )
        top = ranking[0].supplier_name if ranking else "None"
        _complete(step, f"Top pick: {top} · {round(decision.confidence_assessment * 100)}% confidence" if ranking else "No ranking produced")
        return decision, step

    except Exception as e:
        logger.exception("Judge failed, using fallback")
        from backend.services.agents.judge_agent import JudgeAgent
        fallback = JudgeAgent._fallback({
            "specialist_opinions": [
                o.model_dump() if hasattr(o, "model_dump") else o
                for o in specialist_opinions
            ]
        })
        ranking = [JudgedSupplier(**s) for s in fallback.get("final_ranking", [])]
        resolutions = [DisagreementResolution(**d) for d in fallback.get("disagreements_resolved", [])]
        decision = JudgeDecision(
            final_ranking=ranking,
            disagreements_resolved=resolutions,
            bias_checks=fallback.get("bias_checks", []),
            confidence_assessment=float(fallback.get("confidence_assessment", 0.3)),
            confidence_explanation=fallback.get("confidence_explanation", ""),
            weight_rationale=fallback.get("weight_rationale", ""),
        )
        _fail(step, f"Fallback used: {e}")
        return decision, step


async def run_reviewer(
    recommendation: dict[str, Any],
    judge_decision: JudgeDecision,
    escalations: list[dict[str, Any]],
    audit_trail: dict[str, Any],
) -> tuple[ReviewerVerdict, ProcessStep]:
    """Run the Reviewer Agent."""
    step = _step("GOV-003", "Verifying Audit Readiness", "governance",
                 "Reviewer verifying audit-readiness and internal consistency.")

    try:
        from backend.services.agents.reviewer_agent import ReviewerAgent
        context = build_reviewer_context(
            recommendation,
            judge_decision.model_dump(),
            escalations,
            audit_trail,
        )
        agent = ReviewerAgent()
        raw = await _run_governance_agent(agent, context)

        issues = [ReviewIssue(**i) for i in raw.get("issues", [])]
        verdict = ReviewerVerdict(
            audit_ready=raw.get("audit_ready", False),
            issues=issues,
            consistency_checks=raw.get("consistency_checks", []),
            evidence_gaps=raw.get("evidence_gaps", []),
            sign_off_note=raw.get("sign_off_note", ""),
        )
        _complete(step, "Audit ready" if verdict.audit_ready else f"Review needed · {len(issues)} issue{'s' if len(issues) != 1 else ''}")
        return verdict, step

    except Exception as e:
        logger.exception("Reviewer failed")
        verdict = ReviewerVerdict(
            audit_ready=False,
            issues=[ReviewIssue(issue_type="completeness", description="Reviewer unavailable", severity="high")],
            sign_off_note="Review incomplete due to agent failure.",
        )
        _fail(step, str(e))
        return verdict, step


# ---------------------------------------------------------------------------
# Main orchestration entry point
# ---------------------------------------------------------------------------

async def execute_orchestration(
    request: dict[str, Any],
    data: ProcurementData,
    on_step: Any | None = None,
) -> OrchestrationResult:
    """Universal orchestration — every request flows through this.

    Args:
        on_step: Optional async callback called with each completed ProcessStep.
    """
    start_time = time.time()
    steps: list[ProcessStep] = []

    # --- GUARDRAIL: Inject verified extraction summary for agents ---
    # This prevents agents from re-parsing raw text and confusing budget with quantity.
    qty = request.get("quantity") or 0
    budget = request.get("budget_amount") or 0
    currency = request.get("currency") or "EUR"
    request["_agent_guardrail"] = (
        f"VERIFIED EXTRACTION — DO NOT RE-PARSE FROM TEXT: "
        f"quantity={qty} units, budget={float(budget):,.0f} {currency}. "
        f"These are CONFIRMED values from the extraction pipeline. "
        f"Do NOT report contradictions between quantity and budget — they measure different things. "
        f"Do NOT extract alternative quantities or budgets from request_text."
    )

    async def _emit(step: ProcessStep) -> None:
        steps.append(step)
        if on_step is not None:
            await on_step(step)

    # --- Phase A: Constraint Snapshot ---
    snapshot, cs_step = build_constraint_snapshot(request, data)
    snapshot._agent_guardrail = request.get("_agent_guardrail", "")
    await _emit(cs_step)

    # --- EARLY EXIT: Missing critical data → escalate ER-001, skip agents ---
    missing_types = {"missing_budget", "missing_quantity", "missing_category"}
    critical_missing = [v for v in snapshot.validation_issues if v.get("type") in missing_types]
    if critical_missing:
        missing_fields = [v["type"].replace("missing_", "") for v in critical_missing]
        esc_step = _step("ESC-ER001", "Escalating to Requester", "deterministic",
                         f"Missing critical data: {', '.join(missing_fields)}. Cannot proceed without requester input.")
        # Add ER-001 escalation
        snapshot.escalations.append({
            "escalation_id": "ESC-ER001",
            "rule": "ER-001",
            "trigger": f"Missing required information: {', '.join(missing_fields)}",
            "escalate_to": "Requester",
            "blocking": True,
        })
        _complete(esc_step, f"Blocked — awaiting {', '.join(missing_fields)} from requester")
        await _emit(esc_step)

        # Build minimal result and return immediately
        total_ms = int((time.time() - start_time) * 1000)
        return OrchestrationResult(
            process_trace=ProcessTrace(steps=steps, activated_modules=[], total_duration_ms=total_ms),
            specialist_opinions=[],
            critic_output=CriticOutput(findings=[], overall_assessment="Skipped — missing data.", confidence=0.0),
            judge_decision=JudgeDecision(
                final_ranking=[], disagreements_resolved=[], bias_checks=[],
                confidence_assessment=0.0,
                confidence_explanation=f"Cannot assess — missing {', '.join(missing_fields)}.",
                weight_rationale="No ranking produced due to missing data.",
            ),
            reviewer_verdict=ReviewerVerdict(
                audit_ready=False,
                issues=[ReviewIssue(issue_type="completeness", description=f"Missing: {', '.join(missing_fields)}", severity="critical")],
                consistency_checks=[], evidence_gaps=missing_fields,
                sign_off_note=f"Request incomplete. Escalated to requester for: {', '.join(missing_fields)}.",
            ),
            recommendation={"status": "cannot_proceed", "reason": f"Missing critical data ({', '.join(missing_fields)}). Escalated to requester per rule ER-001."},
            snapshot=snapshot,
            discovery_result=None,
            bundle_result=None,
        )

    # --- Phase A: Activation Plan ---
    plan, ap_step = build_activation_plan(request, snapshot)
    await _emit(ap_step)

    # --- Phase B: Run Activated Modules ---
    specialist_opinions: list[AgentOpinion] = []
    discovery_result: DiscoveryResult | None = None
    bundle_result: BundleModuleResult | None = None

    # Catalog evaluation module
    if "catalog_evaluation" in plan.activated_modules:
        mod_step = _step("MOD-CAT", "Analyzing Suppliers", "agentic",
                         "4 AI specialists scoring history, risk, value, and strategic fit.")
        try:
            from backend.services.modules.catalog_module import run_catalog_module
            historical_awards_for_category = data.historical_awards_by_category.get(
                (request.get("category_l1", ""), request.get("category_l2", "")), []
            )
            specialist_opinions = await run_catalog_module(
                request,
                snapshot.eligible_suppliers,
                snapshot.pricing_info,
                historical_awards_for_category,
                data.policies,
                specialist_agents=plan.specialist_agents or None,
            )
            _complete(mod_step, f"{len(specialist_opinions)} specialist scores collected")
        except Exception as e:
            logger.exception("Catalog module failed")
            _fail(mod_step, str(e))
        await _emit(mod_step)

    # Discovery module
    if "new_supplier_discovery" in plan.activated_modules:
        mod_step = _step("MOD-DISC", "Discovering New Suppliers", "agentic",
                         "Searching for alternatives outside current catalog.")
        try:
            from backend.services.modules.discovery_module import run_discovery_module
            catalog_gap = getattr(snapshot, "_catalog_gap_raw", {})
            discovery_result = await run_discovery_module(
                request, catalog_gap, snapshot.excluded_suppliers, data.policies,
            )
            _complete(mod_step, f"Strategy: {discovery_result.discovery_strategy[:100]}")
        except Exception as e:
            logger.exception("Discovery module failed")
            _fail(mod_step, str(e))
        await _emit(mod_step)

    # Bundling module
    if "bundling_optimization" in plan.activated_modules:
        mod_step = _step("MOD-BUND", "Optimizing Volume", "agentic",
                         "Checking bundling opportunities for better pricing.")
        try:
            from backend.services.modules.bundling_module import run_bundling_check
            bundle_opp = getattr(snapshot, "_bundle_opportunity_raw", {})
            bundle_result = run_bundling_check(
                request, bundle_opp, snapshot.eligible_suppliers, data.pricing,
            )
            summary = f"{'Bundled' if bundle_result.bundled else 'No bundling'} · {bundle_result.savings_pct}% savings"
            if bundle_result.escalation_triggered:
                summary += f" · escalation required"
            _complete(mod_step, summary)
        except Exception as e:
            logger.exception("Bundling module failed")
            _fail(mod_step, str(e))
        await _emit(mod_step)

    # Threshold module
    if "threshold_approval_review" in plan.activated_modules:
        mod_step = _step("MOD-THRESH", "Checking Approvals", "deterministic",
                         "Verifying budget thresholds and approval levels.")
        try:
            from backend.services.modules.threshold_module import review_threshold_decision
            threshold_review = review_threshold_decision(
                request, snapshot.policy_evaluation, snapshot.escalations,
            )
            _complete(mod_step, "Approved" if not threshold_review.get('policy_conflict') else "Policy conflict detected")
        except Exception as e:
            _fail(mod_step, str(e))
        await _emit(mod_step)

    # --- Phase C: Governance Pass ---

    # Critic
    critic_output, critic_step = await run_critic(specialist_opinions, snapshot)
    await _emit(critic_step)

    # Judge (always runs)
    judge_decision, judge_step = await run_judge(specialist_opinions, critic_output, snapshot)
    await _emit(judge_step)

    # Build recommendation from judge decision
    has_blocking = any(e.get("blocking", False) for e in snapshot.escalations)
    has_critical = any(v.get("severity") == "critical" for v in snapshot.validation_issues)

    if has_blocking or has_critical:
        rec_status = "cannot_proceed"
    elif snapshot.escalations:
        rec_status = "proceed_with_conditions"
    else:
        rec_status = "can_proceed"

    top_supplier = judge_decision.final_ranking[0] if judge_decision.final_ranking else None
    recommendation = {
        "status": rec_status,
        "reason": judge_decision.confidence_explanation or "Judge-adjudicated recommendation.",
        "preferred_supplier_if_resolved": top_supplier.supplier_id if top_supplier else None,
        "preferred_supplier_rationale": top_supplier.justification if top_supplier else None,
    }

    audit_trail = {
        "policies_checked": [],
        "supplier_ids_evaluated": [s.get("supplier_id", "") for s in snapshot.eligible_suppliers],
        "data_sources_used": ["requests.json", "suppliers.csv", "pricing.csv", "policies.json", "historical_awards.csv"],
        "historical_awards_consulted": "historical_precedent" in plan.specialist_agents,
    }

    # Reviewer (always runs)
    reviewer_verdict, reviewer_step = await run_reviewer(
        recommendation, judge_decision, snapshot.escalations, audit_trail,
    )
    await _emit(reviewer_step)

    # --- Feedback Loop ---
    fl_step = _step("FL-001", "Saving Learnings", "governance",
                    "Writing governance learnings to memory for future decisions.")
    memory_entries = run_feedback_loop(
        critic_output, judge_decision, reviewer_verdict,
        request.get("request_id", "UNKNOWN"),
    )
    _complete(fl_step, f"{len(memory_entries)} memory entries written")
    await _emit(fl_step)

    # --- Build Process Trace ---
    total_ms = int((time.time() - start_time) * 1000)
    process_trace = ProcessTrace(
        steps=steps,
        activated_modules=plan.activated_modules,
        total_duration_ms=total_ms,
    )

    return OrchestrationResult(
        constraint_snapshot=snapshot,
        activation_plan=plan,
        specialist_opinions=specialist_opinions,
        critic_output=critic_output,
        judge_decision=judge_decision,
        reviewer_verdict=reviewer_verdict,
        discovery_result=discovery_result,
        bundle_result=bundle_result,
        process_trace=process_trace,
        governance_memory_entries=memory_entries,
    )
