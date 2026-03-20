// ---------------------------------------------------------------------------
// Types matching the backend Pydantic models
// ---------------------------------------------------------------------------

export interface ProcurementRequest {
  request_id: string;
  title?: string;
  request_text?: string;
  category_l1?: string;
  category_l2?: string;
  country?: string;
  budget_amount?: number;
  currency?: string;
  quantity?: number;
  unit_of_measure?: string;
  required_by_date?: string;
  scenario_tags?: string[];
  status?: string;
  business_unit?: string;
  preferred_supplier?: string;
  [key: string]: unknown;
}

export interface RequestInterpretation {
  category_l1: string;
  category_l2: string;
  quantity?: number;
  unit_of_measure?: string;
  budget_amount?: number;
  budget_min?: number;
  budget_max?: number;
  currency?: string;
  delivery_country?: string;
  delivery_countries?: string[];
  required_by_date?: string;
  days_until_required?: number;
  data_residency_required?: boolean;
  esg_requirement?: boolean;
  preferred_supplier_stated?: string;
  incumbent_supplier?: string;
  requester_instruction?: string;
  quantity_inferred?: boolean;
  quantity_confidence?: string;
  quantity_dimensions?: { dimension: string; quantity: number; unit: string }[];
  category_confidence?: number;
  is_whitespace?: boolean;
  urgency_level?: string;
  budget_confidence?: string;
  budget_source?: string;
}

export interface ValidationIssue {
  issue_id: string;
  severity: string;
  type: string;
  description: string;
  action_required?: string;
}

export interface Validation {
  completeness: string;
  issues_detected: ValidationIssue[];
}

export interface ApprovalThresholdEval {
  rule_applied?: string;
  basis?: string;
  quotes_required?: number;
  approvers: string[];
  deviation_approval?: string;
  note?: string;
}

export interface PreferredSupplierEval {
  supplier?: string;
  status?: string;
  is_preferred?: boolean;
  covers_delivery_country?: boolean;
  is_restricted?: boolean;
  policy_note?: string;
}

export interface RestrictedSupplierEval {
  restricted: boolean;
  note?: string;
}

export interface PolicyEvaluation {
  approval_threshold?: ApprovalThresholdEval;
  preferred_supplier?: PreferredSupplierEval;
  restricted_suppliers: Record<string, RestrictedSupplierEval>;
  category_rules_applied: unknown[];
  geography_rules_applied: unknown[];
}

export interface SupplierShortlistItem {
  rank: number;
  supplier_id: string;
  supplier_name: string;
  preferred?: boolean;
  incumbent?: boolean;
  pricing_tier_applied?: string;
  unit_price_eur?: number;
  total_price_eur?: number;
  standard_lead_time_days?: number;
  expedited_lead_time_days?: number;
  expedited_unit_price_eur?: number;
  expedited_total_eur?: number;
  quality_score?: number;
  risk_score?: number;
  esg_score?: number;
  composite_score?: number;
  currency?: string;
  policy_compliant?: boolean;
  covers_delivery_country?: boolean;
  recommendation_note?: string;
}

export interface SupplierExcluded {
  supplier_id: string;
  supplier_name: string;
  reason?: string;
}

export interface Escalation {
  escalation_id: string;
  rule?: string;
  trigger?: string;
  escalate_to?: string;
  blocking: boolean;
}

export interface Recommendation {
  status: string;
  reason?: string;
  preferred_supplier_if_resolved?: string;
  preferred_supplier_rationale?: string;
  minimum_budget_required?: number;
  minimum_budget_currency?: string;
}

export interface AuditTrail {
  policies_checked: string[];
  supplier_ids_evaluated: string[];
  pricing_tiers_applied?: string;
  data_sources_used: string[];
  historical_awards_consulted: boolean;
  historical_award_note?: string;
}

export interface SupplierRanking {
  supplier_id: string;
  supplier_name: string;
  score: number;
  rationale?: string;
}

export interface AgentOpinion {
  agent_name: string;
  opinion_summary: string;
  supplier_rankings: SupplierRanking[];
  confidence?: number;
  key_factors: string[];
}

export interface PerSupplierConfidence {
  supplier_id: string;
  supplier_name: string;
  score: number;
  explanation?: string;
}

export interface ConfidenceResult {
  overall_score: number;
  per_supplier: PerSupplierConfidence[];
  explanation?: string;
  factors: string[];
}

export interface WeightAdjustment {
  weight_name: string;
  old_value: number;
  new_value: number;
  reason: string;
}

export interface DynamicWeights {
  base_weights: Record<string, number>;
  adjusted_weights: Record<string, number>;
  adjustments: WeightAdjustment[];
}

export interface ApprovalStep {
  role: string;
  required: boolean;
  status: string;
}

export interface ApprovalRouting {
  steps: ApprovalStep[];
}

export interface AnalysisResponse {
  request_id: string;
  processed_at?: string;
  request_interpretation?: RequestInterpretation;
  validation?: Validation;
  policy_evaluation?: PolicyEvaluation;
  supplier_shortlist: SupplierShortlistItem[];
  suppliers_excluded: SupplierExcluded[];
  escalations: Escalation[];
  recommendation?: Recommendation;
  audit_trail?: AuditTrail;
  agent_opinions: AgentOpinion[];
  confidence?: ConfidenceResult;
  dynamic_weights?: DynamicWeights;
  approval_routing?: ApprovalRouting;
  // Universal orchestration fields
  governance?: GovernanceOutput;
  process_trace?: ProcessTrace;
  activated_modules?: string[];
  discovery_result?: DiscoveryResult;
  bundle_result?: BundleModuleResult;
  // New fields
  near_miss_suppliers?: NearMissSupplier[];
  supplier_heatmap?: SupplierHeatmapRow[];
  is_rejected?: boolean;
  rejection_message?: string;
  historical_awards_data?: HistoricalAward[];
}

export interface CategoryStat {
  category_l1: string;
  category_l2: string;
  supplier_count: number;
}

export interface StatsResponse {
  total_requests: number;
  by_scenario_tag: Record<string, number>;
  by_category: Record<string, number>;
  by_country: Record<string, number>;
  by_status: Record<string, number>;
}

export interface CustomRequestInput {
  request_text: string;
}

// --- Governance Types ---

export interface CriticFinding {
  finding_id: string;
  finding_type: string;
  affected_agents: string[];
  affected_suppliers: string[];
  description: string;
  severity: string;
  suggested_action?: string;
}

export interface JudgedSupplier {
  supplier_id: string;
  supplier_name: string;
  rank: number;
  composite_score: number;
  justification: string;
}

export interface DisagreementResolution {
  topic: string;
  agents_involved: string[];
  resolution: string;
  reasoning: string;
}

export interface JudgeDecision {
  final_ranking: JudgedSupplier[];
  disagreements_resolved: DisagreementResolution[];
  bias_checks: string[];
  confidence_assessment: number;
  confidence_explanation: string;
  weight_rationale: string;
}

export interface ReviewIssue {
  issue_type: string;
  description: string;
  severity: string;
}

export interface ReviewerVerdict {
  audit_ready: boolean;
  issues: ReviewIssue[];
  consistency_checks: string[];
  evidence_gaps: string[];
  sign_off_note: string;
}

export interface GovernanceOutput {
  critic_findings: CriticFinding[];
  judge_decision?: JudgeDecision;
  reviewer_verdict?: ReviewerVerdict;
  governance_memory_summary: string[];
}

// --- Process Trace Types ---

export interface ProcessStep {
  step_id: string;
  step_name: string;
  step_type: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  input_summary?: string;
  output_summary?: string;
  status: string;
  step_description?: string;
}

export interface ProcessTrace {
  steps: ProcessStep[];
  activated_modules: string[];
  total_duration_ms?: number;
}

// --- Near-Miss & Heatmap Types ---

export interface NearMissSupplier {
  supplier_id: string;
  supplier_name: string;
  restriction_reason: string;
  condition_for_eligibility: string;
  restriction_threshold?: number;
}

export interface HeatmapCell {
  dimension: string;
  score: number;
  label: string;
  detail?: string;
}

export interface SupplierHeatmapRow {
  supplier_id: string;
  supplier_name: string;
  cells: HeatmapCell[];
}

// --- Discovery & Bundling Types ---

export interface DiscoveryResult {
  discovery_strategy: string;
  suggested_qualification_criteria: string[];
  market_notes: string;
  estimated_timeline?: string;
  interim_recommendation: string;
}

export interface BundleModuleResult {
  bundled: boolean;
  original_quantity: number;
  bundled_quantity: number;
  related_requests: string[];
  original_pricing_tier?: string;
  new_pricing_tier?: string;
  savings_pct?: number;
  capacity_check: string;
  escalation_triggered?: string;
}

export interface HistoricalAward {
  award_id: string;
  request_id: string;
  supplier_id: string;
  supplier_name?: string;
  award_value?: number;
  ranking?: number;
  category_l1?: string;
  category_l2?: string;
  delivery_country?: string;
  [key: string]: unknown;
}

export interface WhitespaceSupplier {
  name: string;
  description: string;
  website?: string;
  coverage?: string;
  strengths?: string;
}

export interface WhitespaceEntry {
  entry_id: string;
  inferred_category_label: string;
  request_ids: string[];
  frequency_count: number;
  countries: string[];
  estimated_budget_range?: string;
  first_seen: string;
  last_seen: string;
  research_status: string;
  discovered_suppliers: WhitespaceSupplier[];
}

export interface PaginatedRequests {
  total: number;
  page: number;
  page_size: number;
  requests: ProcurementRequest[];
}

export interface HistoricalAwardRow {
  award_id: string;
  request_id: string;
  supplier_id: string;
  supplier_name?: string;
  award_value?: number;
  ranking?: number;
  category_l1?: string;
  category_l2?: string;
  delivery_country?: string;
  award_date?: string;
  request_title?: string;
  scenario_tags?: string[];
  [key: string]: unknown;
}

export interface PaginatedHistoricalAwards {
  total: number;
  page: number;
  page_size: number;
  awards: HistoricalAwardRow[];
}
