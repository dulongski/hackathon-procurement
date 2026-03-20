"""Pydantic models for the procurement sourcing agent."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Sub-models matching example_output.json
# ---------------------------------------------------------------------------

class RequestInterpretation(BaseModel):
    category_l1: str
    category_l2: str
    quantity: Optional[float] = None
    unit_of_measure: Optional[str] = None
    budget_amount: Optional[float] = None
    currency: Optional[str] = None
    delivery_country: Optional[str] = None
    required_by_date: Optional[str] = None
    days_until_required: Optional[int] = None
    data_residency_required: Optional[bool] = False
    esg_requirement: Optional[bool] = False
    preferred_supplier_stated: Optional[str] = None
    incumbent_supplier: Optional[str] = None
    requester_instruction: Optional[str] = None


class ValidationIssue(BaseModel):
    issue_id: str
    severity: str  # critical, high, medium, low
    type: str
    description: str
    action_required: Optional[str] = None


class Validation(BaseModel):
    completeness: str = "pass"  # pass / fail
    issues_detected: list[ValidationIssue] = Field(default_factory=list)


class ApprovalThresholdEval(BaseModel):
    rule_applied: Optional[str] = None
    basis: Optional[str] = None
    quotes_required: Optional[int] = None
    approvers: list[str] = Field(default_factory=list)
    deviation_approval: Optional[str] = None
    note: Optional[str] = None


class PreferredSupplierEval(BaseModel):
    supplier: Optional[str] = None
    status: Optional[str] = None
    is_preferred: Optional[bool] = None
    covers_delivery_country: Optional[bool] = None
    is_restricted: Optional[bool] = None
    policy_note: Optional[str] = None


class RestrictedSupplierEval(BaseModel):
    restricted: bool = False
    note: Optional[str] = None


class PolicyEvaluation(BaseModel):
    approval_threshold: Optional[ApprovalThresholdEval] = None
    preferred_supplier: Optional[PreferredSupplierEval] = None
    restricted_suppliers: dict[str, RestrictedSupplierEval] = Field(default_factory=dict)
    category_rules_applied: list[Any] = Field(default_factory=list)
    geography_rules_applied: list[Any] = Field(default_factory=list)


class SupplierShortlistItem(BaseModel):
    rank: int
    supplier_id: str
    supplier_name: str
    preferred: Optional[bool] = None
    incumbent: Optional[bool] = None
    pricing_tier_applied: Optional[str] = None
    unit_price_eur: Optional[float] = None
    total_price_eur: Optional[float] = None
    standard_lead_time_days: Optional[int] = None
    expedited_lead_time_days: Optional[int] = None
    expedited_unit_price_eur: Optional[float] = None
    expedited_total_eur: Optional[float] = None
    quality_score: Optional[float] = None
    risk_score: Optional[float] = None
    esg_score: Optional[float] = None
    policy_compliant: Optional[bool] = None
    covers_delivery_country: Optional[bool] = None
    recommendation_note: Optional[str] = None


class SupplierExcluded(BaseModel):
    supplier_id: str
    supplier_name: str
    reason: Optional[str] = None


class Escalation(BaseModel):
    escalation_id: str
    rule: Optional[str] = None
    trigger: Optional[str] = None
    escalate_to: Optional[str] = None
    blocking: bool = False


class Recommendation(BaseModel):
    status: str  # e.g. "cannot_proceed", "proceed", "proceed_with_conditions"
    reason: Optional[str] = None
    preferred_supplier_if_resolved: Optional[str] = None
    preferred_supplier_rationale: Optional[str] = None
    minimum_budget_required: Optional[float] = None
    minimum_budget_currency: Optional[str] = None


class AuditTrail(BaseModel):
    policies_checked: list[str] = Field(default_factory=list)
    supplier_ids_evaluated: list[str] = Field(default_factory=list)
    pricing_tiers_applied: Optional[str] = None
    data_sources_used: list[str] = Field(default_factory=list)
    historical_awards_consulted: bool = False
    historical_award_note: Optional[str] = None


# ---------------------------------------------------------------------------
# Extended models (agent opinions, confidence, dynamic weights, approvals)
# ---------------------------------------------------------------------------

class SupplierRanking(BaseModel):
    supplier_id: str
    supplier_name: str
    score: float
    rationale: Optional[str] = None


class AgentOpinion(BaseModel):
    agent_name: str
    opinion_summary: str
    supplier_rankings: list[SupplierRanking] = Field(default_factory=list)
    confidence: Optional[float] = None
    key_factors: list[str] = Field(default_factory=list)


class PerSupplierConfidence(BaseModel):
    supplier_id: str
    supplier_name: str
    score: float
    explanation: Optional[str] = None


class ConfidenceResult(BaseModel):
    overall_score: float = 0.0
    per_supplier: list[PerSupplierConfidence] = Field(default_factory=list)
    explanation: Optional[str] = None
    factors: list[str] = Field(default_factory=list)


class WeightAdjustment(BaseModel):
    weight_name: str
    old_value: float
    new_value: float
    reason: str


class DynamicWeights(BaseModel):
    base_weights: dict[str, float] = Field(default_factory=dict)
    adjusted_weights: dict[str, float] = Field(default_factory=dict)
    adjustments: list[WeightAdjustment] = Field(default_factory=list)


class ApprovalStep(BaseModel):
    role: str
    required: bool = True
    status: str = "pending"  # pending, approved, rejected, skipped


class ApprovalRouting(BaseModel):
    steps: list[ApprovalStep] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Top-level response models
# ---------------------------------------------------------------------------

class AnalysisResponse(BaseModel):
    request_id: str
    processed_at: Optional[str] = None

    request_interpretation: Optional[RequestInterpretation] = None
    validation: Optional[Validation] = None
    policy_evaluation: Optional[PolicyEvaluation] = None
    supplier_shortlist: list[SupplierShortlistItem] = Field(default_factory=list)
    suppliers_excluded: list[SupplierExcluded] = Field(default_factory=list)
    escalations: list[Escalation] = Field(default_factory=list)
    recommendation: Optional[Recommendation] = None
    audit_trail: Optional[AuditTrail] = None

    # Extended fields
    agent_opinions: list[AgentOpinion] = Field(default_factory=list)
    confidence: Optional[ConfidenceResult] = None
    dynamic_weights: Optional[DynamicWeights] = None
    approval_routing: Optional[ApprovalRouting] = None

    # Universal orchestration fields
    governance: Optional[GovernanceOutput] = None
    process_trace: Optional[ProcessTrace] = None
    activated_modules: list[str] = Field(default_factory=list)
    discovery_result: Optional[DiscoveryResult] = None
    bundle_result: Optional[BundleModuleResult] = None


# ---------------------------------------------------------------------------
# Request / input models
# ---------------------------------------------------------------------------

class CustomRequestInput(BaseModel):
    """Input model for POST /api/analyze/custom."""
    category_l1: str
    category_l2: str
    quantity: float
    unit_of_measure: Optional[str] = None
    budget_amount: Optional[float] = None
    currency: str = "EUR"
    delivery_country: str = "DE"
    required_by_date: Optional[str] = None
    data_residency_required: bool = False
    esg_requirement: bool = False
    preferred_supplier: Optional[str] = None
    requester_instruction: Optional[str] = None
    business_unit: Optional[str] = None
    title: Optional[str] = None
    request_text: Optional[str] = None


# ---------------------------------------------------------------------------
# Stats model
# ---------------------------------------------------------------------------

class CategoryStat(BaseModel):
    category_l1: str
    category_l2: str
    supplier_count: int = 0


class StatsResponse(BaseModel):
    """Response model for GET /api/stats."""
    total_requests: int = 0
    total_suppliers: int = 0
    total_categories: int = 0
    total_historical_awards: int = 0
    categories: list[CategoryStat] = Field(default_factory=list)
    regions: list[str] = Field(default_factory=list)
    policy_types: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Constraint Snapshot
# ---------------------------------------------------------------------------

class CatalogGapSignal(BaseModel):
    has_gap: bool = False
    reason: str = ""
    category_l1: str = ""
    category_l2: str = ""
    delivery_country: str = ""

class BundleOpportunitySignal(BaseModel):
    has_opportunity: bool = False
    related_request_ids: list[str] = Field(default_factory=list)
    combined_quantity: float = 0
    current_tier: Optional[str] = None
    potential_tier: Optional[str] = None
    estimated_savings_pct: Optional[float] = None
    hold_window_feasible: bool = False

class ConstraintSnapshot(BaseModel):
    eligible_suppliers: list[dict[str, Any]] = Field(default_factory=list)
    excluded_suppliers: list[dict[str, Any]] = Field(default_factory=list)
    near_miss_suppliers: list[dict[str, Any]] = Field(default_factory=list)
    pricing_info: list[Any] = Field(default_factory=list)
    validation_issues: list[dict[str, Any]] = Field(default_factory=list)
    policy_evaluation: dict[str, Any] = Field(default_factory=dict)
    escalations: list[dict[str, Any]] = Field(default_factory=list)
    contract_value: float = 0.0
    catalog_gap: Optional[CatalogGapSignal] = None
    bundle_opportunity: Optional[BundleOpportunitySignal] = None


# ---------------------------------------------------------------------------
# Activation Plan
# ---------------------------------------------------------------------------

class ActivationPlan(BaseModel):
    activated_modules: list[str] = Field(default_factory=list)
    activation_reasons: dict[str, str] = Field(default_factory=dict)
    specialist_agents: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Critic
# ---------------------------------------------------------------------------

class CriticFinding(BaseModel):
    finding_id: str
    finding_type: str  # contradiction, weak_evidence, hidden_risk, unsupported_claim, bias_alert
    affected_agents: list[str] = Field(default_factory=list)
    affected_suppliers: list[str] = Field(default_factory=list)
    description: str
    severity: str  # high, medium, low
    suggested_action: Optional[str] = None

class CriticOutput(BaseModel):
    findings: list[CriticFinding] = Field(default_factory=list)
    overall_assessment: str = ""
    confidence: float = 0.5


# ---------------------------------------------------------------------------
# Judge
# ---------------------------------------------------------------------------

class JudgedSupplier(BaseModel):
    supplier_id: str
    supplier_name: str
    rank: int
    composite_score: float
    justification: str

class DisagreementResolution(BaseModel):
    topic: str
    agents_involved: list[str] = Field(default_factory=list)
    resolution: str
    reasoning: str

class JudgeDecision(BaseModel):
    final_ranking: list[JudgedSupplier] = Field(default_factory=list)
    disagreements_resolved: list[DisagreementResolution] = Field(default_factory=list)
    bias_checks: list[str] = Field(default_factory=list)
    confidence_assessment: float = 0.5
    confidence_explanation: str = ""
    weight_rationale: str = ""


# ---------------------------------------------------------------------------
# Reviewer
# ---------------------------------------------------------------------------

class ReviewIssue(BaseModel):
    issue_type: str
    description: str
    severity: str

class ReviewerVerdict(BaseModel):
    audit_ready: bool = False
    issues: list[ReviewIssue] = Field(default_factory=list)
    consistency_checks: list[str] = Field(default_factory=list)
    evidence_gaps: list[str] = Field(default_factory=list)
    sign_off_note: str = ""


# ---------------------------------------------------------------------------
# Governance Output
# ---------------------------------------------------------------------------

class GovernanceOutput(BaseModel):
    critic_findings: list[CriticFinding] = Field(default_factory=list)
    judge_decision: Optional[JudgeDecision] = None
    reviewer_verdict: Optional[ReviewerVerdict] = None
    governance_memory_summary: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

class DiscoveryResult(BaseModel):
    discovery_strategy: str = ""
    suggested_qualification_criteria: list[str] = Field(default_factory=list)
    market_notes: str = ""
    estimated_timeline: Optional[str] = None
    interim_recommendation: str = ""


# ---------------------------------------------------------------------------
# Bundling
# ---------------------------------------------------------------------------

class BundleModuleResult(BaseModel):
    bundled: bool = False
    original_quantity: float = 0
    bundled_quantity: float = 0
    related_requests: list[str] = Field(default_factory=list)
    original_pricing_tier: Optional[str] = None
    new_pricing_tier: Optional[str] = None
    savings_pct: Optional[float] = None
    capacity_check: str = "not_checked"  # within_capacity, exceeded, partial, not_checked
    escalation_triggered: Optional[str] = None


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

class MemoryEntry(BaseModel):
    entry_id: str
    scope: str  # supervisor, critic, judge, reviewer, specialist:*
    entry_type: str
    content: str
    created_at: str
    source_request_id: str
    relevance_score: float = 1.0


class WhitespaceEntry(BaseModel):
    """Tracks unmatched procurement categories (whitespace demand)."""
    entry_id: str
    inferred_category_label: str
    request_ids: list[str] = Field(default_factory=list)
    frequency_count: int = 1
    countries: list[str] = Field(default_factory=list)
    estimated_budget_range: Optional[str] = None
    first_seen: str
    last_seen: str
    research_status: str = "pending"  # pending, in_progress, completed
    discovered_suppliers: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Process Trace
# ---------------------------------------------------------------------------

class ProcessStep(BaseModel):
    step_id: str
    step_name: str
    step_type: str  # deterministic, agentic, governance
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None
    input_summary: Optional[str] = None
    output_summary: Optional[str] = None
    status: str = "pending"  # pending, completed, skipped, failed
    step_description: Optional[str] = None

class ProcessTrace(BaseModel):
    steps: list[ProcessStep] = Field(default_factory=list)
    activated_modules: list[str] = Field(default_factory=list)
    total_duration_ms: Optional[int] = None


# ---------------------------------------------------------------------------
# Orchestration Result
# ---------------------------------------------------------------------------

class OrchestrationResult(BaseModel):
    constraint_snapshot: Optional[ConstraintSnapshot] = None
    activation_plan: Optional[ActivationPlan] = None
    specialist_opinions: list[AgentOpinion] = Field(default_factory=list)
    critic_output: Optional[CriticOutput] = None
    judge_decision: Optional[JudgeDecision] = None
    reviewer_verdict: Optional[ReviewerVerdict] = None
    discovery_result: Optional[DiscoveryResult] = None
    bundle_result: Optional[BundleModuleResult] = None
    process_trace: Optional[ProcessTrace] = None
    governance_memory_entries: list[MemoryEntry] = Field(default_factory=list)
