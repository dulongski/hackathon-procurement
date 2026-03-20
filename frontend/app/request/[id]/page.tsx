"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchRequest, analyzeRequest, analyzeRequestStream } from "@/lib/api";
import type {
  ProcurementRequest,
  AnalysisResponse,
  SupplierShortlistItem,
  AgentOpinion,
  ValidationIssue,
  Escalation,
  CriticFinding,
  JudgeDecision,
  ReviewerVerdict,
  ProcessStep,
  GovernanceOutput,
  NearMissSupplier,
  SupplierHeatmapRow,
  HeatmapCell,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  can_proceed:             { bg: "bg-green-50",  border: "border-green-200", text: "text-green-800", label: "Can Proceed" },
  proceed:                 { bg: "bg-green-50",  border: "border-green-200", text: "text-green-800", label: "Proceed" },
  proceed_with_conditions: { bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-800", label: "Proceed with Conditions" },
  cannot_proceed:          { bg: "bg-red-50",    border: "border-red-200",   text: "text-red-800",   label: "Cannot Proceed" },
};

function getStatusStyle(status: string) {
  if (STATUS_COLORS[status]) return STATUS_COLORS[status];
  if (status.includes("cannot")) return STATUS_COLORS.cannot_proceed;
  if (status.includes("condition")) return STATUS_COLORS.proceed_with_conditions;
  return STATUS_COLORS.can_proceed;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high:     "bg-orange-100 text-orange-800 border-orange-200",
  medium:   "bg-amber-100 text-amber-800 border-amber-200",
  low:      "bg-blue-100 text-blue-800 border-blue-200",
};

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  standard:      { bg: "bg-blue-50",    text: "text-blue-700" },
  missing_info:  { bg: "bg-amber-50",   text: "text-amber-700" },
  contradictory: { bg: "bg-red-50",     text: "text-red-700" },
  threshold:     { bg: "bg-purple-50",  text: "text-purple-700" },
  restricted:    { bg: "bg-orange-50",  text: "text-orange-700" },
  lead_time:     { bg: "bg-yellow-50",  text: "text-yellow-700" },
  multilingual:  { bg: "bg-teal-50",    text: "text-teal-700" },
  capacity:      { bg: "bg-indigo-50",  text: "text-indigo-700" },
  multi_country: { bg: "bg-pink-50",    text: "text-pink-700" },
};

const STEP_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  deterministic: { bg: "bg-slate-100", text: "text-slate-700" },
  agentic:       { bg: "bg-blue-100",  text: "text-blue-700" },
  governance:    { bg: "bg-purple-100", text: "text-purple-700" },
};

const MODULE_COLORS: Record<string, string> = {
  catalog_evaluation:       "bg-blue-100 text-blue-700",
  new_supplier_discovery:   "bg-amber-100 text-amber-700",
  bundling_optimization:    "bg-green-100 text-green-700",
  threshold_approval_review: "bg-purple-100 text-purple-700",
  escalation_review:        "bg-red-100 text-red-700",
  complex_case_handling:    "bg-orange-100 text-orange-700",
};

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------
const TABS = [
  { id: "recommendation", label: "Recommendation" },
  { id: "process", label: "Process Trace" },
  { id: "agents", label: "Agent Logic" },
  { id: "governance", label: "Governance" },
  { id: "comparison", label: "Comparison" },
  { id: "audit", label: "Audit Trail" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Next Steps generator
// ---------------------------------------------------------------------------
function generateNextSteps(analysis: AnalysisResponse, request: ProcurementRequest): { id: string; label: string; detail: string; enabled: boolean }[] {
  const steps: { id: string; label: string; detail: string; enabled: boolean }[] = [];
  const rec = analysis.recommendation;
  const shortlist = analysis.supplier_shortlist || [];
  const governance = analysis.governance;
  const escalations = analysis.escalations || [];
  const topSupplier = governance?.judge_decision?.final_ranking?.[0]?.supplier_name || shortlist[0]?.supplier_name;

  // Escalation-based steps
  for (const esc of escalations) {
    if (esc.escalate_to) {
      steps.push({ id: `esc-${esc.escalation_id}`, label: `Notify ${esc.escalate_to}`, detail: `Escalation: ${esc.trigger?.slice(0, 100) || esc.rule || "Review required"}`, enabled: true });
    }
  }

  // RFP if we have suppliers
  if (shortlist.length > 0 || (governance?.judge_decision?.final_ranking?.length || 0) > 0) {
    const names = governance?.judge_decision?.final_ranking?.slice(0, 3).map(s => s.supplier_name).join(", ") || shortlist.slice(0, 3).map(s => s.supplier_name).join(", ");
    steps.push({ id: "rfp", label: "Generate Request for Proposals", detail: `Send RFP to top suppliers: ${names}`, enabled: true });
  }

  // Budget approval
  if (rec?.status?.includes("condition") || analysis.validation?.issues_detected?.some(i => i.type === "budget_insufficient")) {
    steps.push({ id: "budget", label: "Request Budget Approval", detail: `Submit budget amendment to Finance for ${request.currency || "EUR"} ${request.budget_amount?.toLocaleString() || "N/A"}`, enabled: true });
  }

  // Email head of procurement
  steps.push({ id: "email-proc", label: "Email Head of Procurement", detail: `Summarize analysis for ${request.category_l1 || "this category"} in ${request.country || "target market"}`, enabled: true });

  // Preferred supplier follow-up
  if (topSupplier) {
    steps.push({ id: "supplier-contact", label: `Contact ${topSupplier}`, detail: `Request pricing confirmation and availability for ${request.quantity || "N/A"} ${request.unit_of_measure || "units"}`, enabled: true });
  }

  // Compliance review
  if (governance?.reviewer_verdict && !governance.reviewer_verdict.audit_ready) {
    steps.push({ id: "compliance", label: "Schedule Compliance Review", detail: "Governance review flagged audit gaps — schedule manual compliance check", enabled: true });
  }

  return steps;
}

export default function RequestAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [request, setRequest] = useState<ProcurementRequest | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [liveSteps, setLiveSteps] = useState<ProcessStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("recommendation");
  const [showNextSteps, setShowNextSteps] = useState(false);
  const [nextStepToggles, setNextStepToggles] = useState<Record<string, boolean>>({});
  const [nextStepsSent, setNextStepsSent] = useState(false);
  const [showClarification, setShowClarification] = useState(false);
  const [clarificationText, setClarificationText] = useState("");

  useEffect(() => {
    const cached = sessionStorage.getItem(`analysis_${requestId}`);
    if (cached) {
      try {
        const cachedAnalysis = JSON.parse(cached) as AnalysisResponse;
        setAnalysis(cachedAnalysis);
        const interp = cachedAnalysis.request_interpretation;
        setRequest({
          request_id: requestId,
          title: interp?.requester_instruction?.slice(0, 60) || "Custom Request",
          request_text: interp?.requester_instruction,
          category_l1: interp?.category_l1,
          category_l2: interp?.category_l2,
          country: interp?.delivery_country,
          budget_amount: interp?.budget_amount ?? undefined,
          currency: interp?.currency ?? undefined,
          quantity: interp?.quantity ?? undefined,
        });
        setLoading(false);
        // Don't remove cache here — React strict mode double-runs effects.
        // Remove after a short delay so the second run still finds it.
        setTimeout(() => sessionStorage.removeItem(`analysis_${requestId}`), 500);
        return;
      } catch { /* fall through */ }
    }
    // Only fetch from API for non-custom requests (custom ones won't exist in the DB)
    if (requestId.startsWith("CUSTOM-")) {
      setLoading(false);
      return;
    }
    fetchRequest(requestId)
      .then(setRequest)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [requestId]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    setLiveSteps([]);
    try {
      const result = await analyzeRequestStream(requestId, (step) => {
        setLiveSteps((prev) => [...prev, step]);
      });
      setAnalysis(result);
    } catch (err: unknown) {
      // Fallback to non-streaming if SSE fails
      try {
        const result = await analyzeRequest(requestId);
        setAnalysis(result);
      } catch (fallbackErr: unknown) {
        setError(fallbackErr instanceof Error ? fallbackErr.message : "Analysis failed");
      }
    } finally {
      setAnalyzing(false);
      setLiveSteps([]);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="flex gap-1.5"><span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" /><span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" /><span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" /></div></div>;
  if (!request) return <div className="flex flex-col items-center justify-center h-full gap-3"><p className="text-gray-500">Request not found</p><button onClick={() => router.push("/")} className="text-indigo-600 text-sm hover:underline">Back to Procure</button></div>;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <button onClick={() => router.push("/")} className="text-gray-400 hover:text-gray-600">Procure</button>
        <span className="text-gray-300">/</span>
        <span className="text-gray-700 font-medium">{requestId}</span>
      </div>

      {/* Request Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{request.title || "Untitled Request"}
              {analysis?.request_interpretation?.is_whitespace && (
                <span className="ml-3 px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200">
                  WHITESPACE — No matching category
                </span>
              )}
            </h1>
            <p className="text-gray-500 text-sm mt-1 font-mono">{requestId}</p>
          </div>
          {!analysis && (
            <button onClick={handleAnalyze} disabled={analyzing} className="inline-flex items-center gap-2 px-5 py-2.5 bg-ciq-red text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50">
              {analyzing ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analyzing...</>) : (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>Run Analysis</>)}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100">
          <DetailItem label="Category" value={`${request.category_l1 || "-"} / ${request.category_l2 || "-"}`} />
          <DetailItem label="Country" value={(() => {
            const countries = analysis?.request_interpretation?.delivery_countries;
            if (countries && countries.length > 1) return countries.join(", ");
            return request.country || "-";
          })()} />
          <DetailItem label="Budget" value={(() => {
            const interp = analysis?.request_interpretation;
            let display = "";
            if (interp?.budget_min && interp?.budget_max) {
              display = `${Number(interp.budget_min).toLocaleString()} – ${Number(interp.budget_max).toLocaleString()} ${interp?.currency || "EUR"}`;
            } else if (request.budget_amount != null) {
              display = `${Number(request.budget_amount).toLocaleString()} ${request.currency || "EUR"}`;
            } else {
              display = "-";
            }
            if (interp?.budget_confidence && interp.budget_confidence !== "high" && display !== "-") {
              display += ` (${interp.budget_confidence} confidence)`;
            }
            return display;
          })()} />
          <DetailItem label="Quantity" value={(() => {
            const dims = analysis?.request_interpretation?.quantity_dimensions;
            if (dims && dims.length > 1) {
              return dims.map(d => `${d.quantity} ${d.unit}`).join(" + ");
            }
            const inferredTag = analysis?.request_interpretation?.quantity_inferred ? " (inferred)" : "";
            return request.quantity != null
              ? `${Number(request.quantity).toLocaleString()} ${request.unit_of_measure || "units"}${inferredTag}`
              : "-";
          })()} />
        </div>
        {request.request_text && <div className="mt-4 p-4 bg-gray-50 rounded-lg"><p className="text-sm text-gray-700 whitespace-pre-wrap">{request.request_text}</p></div>}
      </div>

      {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
      {analyzing && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          {/* Header */}
          <h2 className="text-lg font-bold text-gray-900 mb-1">
            Processing: {(request.request_text || request.title || "Request").slice(0, 80)}{(request.request_text || request.title || "").length > 80 ? "..." : ""}
          </h2>
          <p className="text-sm text-gray-500 mb-6">Chain of Thoughts</p>

          {liveSteps.length > 0 ? (
            <div className="relative pl-8">
              {/* Vertical timeline line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-gray-200" />

              <div className="space-y-4">
                {liveSteps.map((step, idx) => {
                  const isCompleted = step.status === "completed";
                  const isFailed = step.status === "failed";
                  const typeColor = STEP_TYPE_COLORS[step.step_type] || { bg: "bg-gray-100", text: "text-gray-700" };
                  return (
                    <div key={step.step_id} className="relative animate-timeline-in" style={{ animationDelay: `${idx * 50}ms` }}>
                      {/* Circle indicator on timeline */}
                      <div className={`absolute -left-8 top-3 w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center ${
                        isCompleted ? "border-green-500 bg-green-50" : isFailed ? "border-red-500 bg-red-50" : "border-amber-400 bg-amber-50"
                      }`}>
                        {isCompleted ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : isFailed ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-amber-400" />
                        )}
                      </div>

                      {/* Thought Card */}
                      <div className="bg-gray-50 rounded-lg border border-gray-100 p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Thought</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor.bg} ${typeColor.text}`}>{step.step_type}</span>
                          {step.duration_ms != null && (
                            <span className="text-xs text-gray-400 ml-auto">{(step.duration_ms / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-gray-800">{step.step_name}</p>
                        {step.step_description && <p className="text-xs text-gray-500 mt-1">{step.step_description}</p>}
                        {step.output_summary && <p className="text-xs text-gray-600 mt-2 bg-white rounded px-2 py-1 border border-gray-100">{step.output_summary}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pulsing dot at bottom */}
              <div className="relative mt-4">
                <div className="absolute -left-8 top-1 w-[22px] h-[22px] rounded-full border-2 border-indigo-400 bg-indigo-50 flex items-center justify-center animate-pulse-glow">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                </div>
                <p className="text-sm text-gray-400 italic pl-1">Compiling response...</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">Initializing pipeline...</p>
            </div>
          )}
        </div>
      )}

      {analysis && !analyzing && (
        <div className="animate-fade-in">
          {analysis.is_rejected ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              </div>
              <h3 className="text-lg font-bold text-red-800 mb-2">Request Rejected</h3>
              <p className="text-red-700">{analysis.rejection_message}</p>
            </div>
          ) : (
            <>
              {request.scenario_tags && request.scenario_tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {request.scenario_tags.map((tag) => {
                    const tc = TAG_COLORS[tag] || { bg: "bg-gray-50", text: "text-gray-700" };
                    return <span key={tag} className={`px-2.5 py-1 rounded-full text-xs font-medium ${tc.bg} ${tc.text}`}>{tag.replace(/_/g, " ")}</span>;
                  })}
                </div>
              )}
              <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-1.5 overflow-x-auto">
                {TABS.map((tab) => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab.id ? "bg-ciq-red text-white shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"}`}>
                    {tab.label}
                    {tab.id === "governance" && analysis.governance?.critic_findings && analysis.governance.critic_findings.length > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-xs">{analysis.governance.critic_findings.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {activeTab === "recommendation" && <RecommendationTab analysis={analysis} />}
                {activeTab === "process" && <ProcessTraceTab analysis={analysis} />}
                {activeTab === "agents" && <AgentLogicTab analysis={analysis} />}
                {activeTab === "governance" && <GovernanceTab analysis={analysis} />}
                {activeTab === "comparison" && <ComparisonTab analysis={analysis} />}
                {activeTab === "audit" && <AuditTrailTab analysis={analysis} />}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    const steps = generateNextSteps(analysis, request);
                    const toggles: Record<string, boolean> = {};
                    steps.forEach(s => { toggles[s.id] = s.enabled; });
                    setNextStepToggles(toggles);
                    setShowNextSteps(true);
                  }}
                  className="px-6 py-3 bg-ciq-red text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors shadow-sm flex items-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  Next Steps
                </button>

                {/* Missing info / clarification */}
                {analysis.validation?.issues_detected && analysis.validation.issues_detected.length > 0 && (
                  <button
                    onClick={() => setShowClarification(true)}
                    className="px-6 py-3 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors shadow-sm flex items-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Clarify Information
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Next Steps Modal */}
      {showNextSteps && analysis && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNextSteps(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-ciq-black">Next Steps</h2>
              <p className="text-sm text-ciq-darkgrey mt-1">Toggle off actions you don&apos;t want to execute</p>
            </div>
            <div className="p-6 space-y-3">
              {generateNextSteps(analysis, request).map((step) => (
                <label key={step.id} className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${nextStepToggles[step.id] ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200 opacity-60"}`}>
                  <input
                    type="checkbox"
                    checked={nextStepToggles[step.id] ?? true}
                    onChange={() => setNextStepToggles(prev => ({ ...prev, [step.id]: !prev[step.id] }))}
                    className="mt-0.5 accent-ciq-red"
                  />
                  <div>
                    <p className="text-sm font-semibold text-ciq-black">{step.label}</p>
                    <p className="text-xs text-ciq-darkgrey mt-0.5">{step.detail}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowNextSteps(false)} className="px-4 py-2.5 text-sm font-medium text-ciq-darkgrey hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={() => {
                  const enabledSteps = generateNextSteps(analysis, request).filter(s => nextStepToggles[s.id]);
                  // Save to sessionStorage for backlog
                  const backlogEntry = {
                    request_id: requestId,
                    title: request.title || "Custom Request",
                    category_l1: request.category_l1,
                    country: request.country,
                    budget_amount: request.budget_amount,
                    currency: request.currency,
                    request_text: request.request_text?.slice(0, 200),
                    recommendation_status: analysis.recommendation?.status,
                    next_steps: enabledSteps.map(s => ({
                      id: s.id,
                      label: s.label,
                      detail: s.detail,
                      status: s.id.startsWith("esc") ? "Awaiting response" : s.id === "rfp" ? "RFP draft pending" : s.id === "supplier-contact" ? "Waiting for supplier reply" : "In progress",
                      created_at: new Date().toISOString(),
                    })),
                    created_at: new Date().toISOString(),
                  };
                  const existing = JSON.parse(sessionStorage.getItem("backlog_items") || "[]");
                  // Remove old entry for same request
                  const filtered = existing.filter((e: { request_id: string }) => e.request_id !== requestId);
                  filtered.push(backlogEntry);
                  sessionStorage.setItem("backlog_items", JSON.stringify(filtered));

                  setNextStepsSent(true);
                  setShowNextSteps(false);
                }}
                disabled={!Object.values(nextStepToggles).some(Boolean)}
                className="px-6 py-2.5 bg-ciq-red text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                Send {Object.values(nextStepToggles).filter(Boolean).length} Actions
              </button>
            </div>
          </div>
        </div>
      )}

      {nextStepsSent && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-6 py-3 rounded-xl shadow-lg animate-fade-in flex items-center gap-2 z-50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Actions sent — added to Backlog
        </div>
      )}

      {/* Clarification Panel */}
      {showClarification && analysis && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowClarification(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-ciq-black">Clarify Information</h2>
              <p className="text-sm text-ciq-darkgrey mt-1">Issues were found in your request. Provide corrections below.</p>
            </div>
            <div className="p-6 space-y-3">
              {analysis.validation?.issues_detected?.map((issue) => (
                <div key={issue.issue_id} className={`p-3 rounded-lg border ${issue.severity === "critical" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                  <p className="text-sm font-medium text-ciq-black">{issue.description}</p>
                  {issue.action_required && <p className="text-xs text-ciq-darkgrey mt-1">{issue.action_required}</p>}
                </div>
              ))}
              <div className="mt-4">
                <label className="text-sm font-medium text-ciq-black block mb-2">Your corrections / additional information:</label>
                <textarea
                  value={clarificationText}
                  onChange={(e) => setClarificationText(e.target.value)}
                  placeholder="e.g., The correct budget is 600,000 EUR. Quantity should be 300 units, not 500..."
                  className="w-full h-28 px-4 py-3 border border-gray-200 rounded-lg text-sm text-ciq-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-ciq-red focus:border-transparent resize-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowClarification(false)} className="px-4 py-2.5 text-sm font-medium text-ciq-darkgrey hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={() => {
                  // Re-analyze with appended clarification
                  const combined = `${request.request_text || ""}\n\nCLARIFICATION: ${clarificationText}`;
                  sessionStorage.setItem("reanalyze_text", combined);
                  setShowClarification(false);
                  router.push("/");
                }}
                disabled={!clarificationText.trim()}
                className="px-6 py-2.5 bg-ciq-red text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                Re-analyze with Corrections
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditStep({ num, title, status, children }: { num: number; title: string; status: "completed" | "warning" | "failed"; children: React.ReactNode }) {
  const colors = { completed: "border-green-500 bg-green-50 text-green-700", warning: "border-amber-500 bg-amber-50 text-amber-700", failed: "border-red-500 bg-red-50 text-red-700" };
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold ${colors[status]}`}>{num}</div>
        <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <p className="text-sm font-semibold text-ciq-black mb-1">{title}</p>
        <div className="text-ciq-darkgrey">{children}</div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</p><p className="text-sm text-gray-800 mt-0.5 font-medium">{value}</p></div>;
}

function ConfidenceGauge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  let color = "#22c55e";
  if (pct < 50) color = "#ef4444";
  else if (pct < 75) color = "#f59e0b";
  return (
    <div className="flex flex-col items-center">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} transform="rotate(-90 60 60)" style={{ transition: "stroke-dashoffset 0.8s ease-out" }} />
        <text x="60" y="56" textAnchor="middle" fill="#1f2937" fontSize="24" fontWeight="bold">{pct}%</text>
        <text x="60" y="74" textAnchor="middle" fill="#9ca3af" fontSize="11">confidence</text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Recommendation
// ---------------------------------------------------------------------------
// Helper: split long text into bullet points by sentence boundaries
function TextToBullets({ text, maxBullets }: { text: string; maxBullets?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  // Split by sentence-ending patterns or semicolons
  const sentences = text.split(/(?<=[.!;])\s+|(?:\(\d+\)\s*)/).filter(s => s.trim().length > 5);
  if (sentences.length <= 1) return <p className="text-sm text-ciq-darkgrey">{text}</p>;
  const limit = maxBullets || 3;
  const visible = expanded ? sentences : sentences.slice(0, limit);
  return (
    <div>
      <ul className="space-y-1">
        {visible.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-ciq-darkgrey">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ciq-red/50 flex-shrink-0" />
            <span>{s.trim()}</span>
          </li>
        ))}
      </ul>
      {sentences.length > limit && (
        <button onClick={() => setExpanded(!expanded)} className="mt-1 text-xs text-ciq-red hover:underline ml-3.5">
          {expanded ? "Show less" : `Show ${sentences.length - limit} more...`}
        </button>
      )}
    </div>
  );
}

function RecommendationTab({ analysis }: { analysis: AnalysisResponse }) {
  const rec = analysis.recommendation;
  const confidence = analysis.confidence;
  const governance = analysis.governance;
  const routing = analysis.approval_routing;
  const modules = analysis.activated_modules || [];

  const shortlistMap = Object.fromEntries(
    (analysis.supplier_shortlist || []).map(s => [s.supplier_id, s])
  );

  if (!rec) return <p className="text-gray-500 text-sm">No recommendation available.</p>;
  const statusStyle = getStatusStyle(rec.status);

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div className={`p-5 rounded-xl border ${statusStyle.bg} ${statusStyle.border}`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${rec.status.includes("cannot") ? "bg-red-500" : rec.status.includes("condition") ? "bg-amber-500" : "bg-green-500"}`} />
          <h3 className={`text-lg font-bold ${statusStyle.text}`}>{statusStyle.label}</h3>
          {governance?.reviewer_verdict && (
            <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium ${governance.reviewer_verdict.audit_ready ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {governance.reviewer_verdict.audit_ready ? "Audit Ready" : "Review Needed"}
            </span>
          )}
        </div>
        <TextToBullets text={rec.reason || (rec.status.includes("cannot") ? "The request cannot proceed in its current form. Review escalations and validation issues in the Audit Trail tab for specific blockers." : rec.status.includes("condition") ? "The request can proceed with conditions. Review the required approvals and escalations below." : "The request is approved to proceed.")} maxBullets={3} />
      </div>

      {/* Activated Modules */}
      {modules.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Activated Modules</p>
          <div className="flex flex-wrap gap-2">
            {modules.map((m) => (
              <span key={m} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${MODULE_COLORS[m] || "bg-gray-100 text-gray-700"}`}>
                {m.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {confidence && (
          <div className="flex flex-col items-center p-6 bg-gray-50 rounded-xl">
            <ConfidenceGauge score={confidence.overall_score} />
            {confidence.explanation && <TextToBullets text={confidence.explanation} maxBullets={2} />}
          </div>
        )}
        <div className="space-y-4">
          {rec.preferred_supplier_if_resolved && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Top Ranked Supplier</p>
              <p className="text-sm text-gray-800 font-medium">{rec.preferred_supplier_if_resolved}</p>
              {rec.preferred_supplier_rationale && <TextToBullets text={rec.preferred_supplier_rationale} />}
            </div>
          )}
          {/* Judge weight rationale */}
          {governance?.judge_decision?.weight_rationale && (
            <div className="p-4 bg-red-50 rounded-lg">
              <p className="text-xs text-ciq-red uppercase tracking-wider font-medium mb-1">Judge Weight Rationale</p>
              <TextToBullets text={governance.judge_decision.weight_rationale} />
            </div>
          )}
        </div>
      </div>

      {/* Supplier Ranking from Judge */}
      {governance?.judge_decision?.final_ranking && governance.judge_decision.final_ranking.length > 0 && (() => {
        // Build historical price ranges per supplier
        const histAwards = analysis.historical_awards_data || [];
        const supplierHistRanges: Record<string, { min: number; max: number; avg: number; count: number; minLead: number; maxLead: number }> = {};
        for (const award of histAwards) {
          const sid = award.supplier_id;
          const val = award.award_value ?? (award as Record<string, unknown>).total_value as number;
          const lead = (award as Record<string, unknown>).lead_time_days as number;
          if (val != null) {
            if (!supplierHistRanges[sid]) supplierHistRanges[sid] = { min: val, max: val, avg: val, count: 1, minLead: lead ?? 0, maxLead: lead ?? 0 };
            else {
              supplierHistRanges[sid].min = Math.min(supplierHistRanges[sid].min, val);
              supplierHistRanges[sid].max = Math.max(supplierHistRanges[sid].max, val);
              supplierHistRanges[sid].avg = (supplierHistRanges[sid].avg * supplierHistRanges[sid].count + val) / (supplierHistRanges[sid].count + 1);
              supplierHistRanges[sid].count++;
              if (lead != null) {
                supplierHistRanges[sid].minLead = Math.min(supplierHistRanges[sid].minLead, lead);
                supplierHistRanges[sid].maxLead = Math.max(supplierHistRanges[sid].maxLead, lead);
              }
            }
          }
        }
        const globalMax = Math.max(...Object.values(supplierHistRanges).map(r => r.max), 1);

        return (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Judge-Adjudicated Ranking</h4>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-100">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Rank</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Score</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Unit Price</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Total</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Lead Time</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Hist. Range</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Justification</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {governance.judge_decision.final_ranking.map((s) => {
                  const hist = supplierHistRanges[s.supplier_id];
                  return (
                  <tr key={s.supplier_id} className={s.rank === 1 ? "bg-green-50/30" : ""}>
                    <td className="px-3 py-3"><span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${s.rank === 1 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{s.rank}</span></td>
                    <td className="px-3 py-3"><p className="text-sm font-medium text-gray-900">{s.supplier_name}</p><p className="text-xs text-gray-400 font-mono">{s.supplier_id}</p></td>
                    <td className="px-3 py-3 text-center"><span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-red-50 text-red-700">{Math.round(s.composite_score)}</span></td>
                    <td className="px-3 py-3 text-right text-sm text-gray-600">
                      {(() => { const sl = shortlistMap[s.supplier_id]; return sl?.unit_price_eur != null ? `${sl.currency || 'EUR'} ${sl.unit_price_eur.toLocaleString()}` : "N/A"; })()}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-gray-600">
                      {(() => { const sl = shortlistMap[s.supplier_id]; return sl?.total_price_eur != null ? `${sl.currency || 'EUR'} ${sl.total_price_eur.toLocaleString()}` : "N/A"; })()}
                    </td>
                    <td className="px-3 py-3 text-center text-sm text-gray-600">
                      {(() => { const sl = shortlistMap[s.supplier_id]; return sl?.standard_lead_time_days != null ? `${sl.standard_lead_time_days}d` : "N/A"; })()}
                    </td>
                    <td className="px-3 py-3 w-40">
                      {hist ? (
                        <div className="group relative">
                          {/* Inline range bar */}
                          <div className="h-3 bg-gray-100 rounded-full relative overflow-hidden">
                            <div className="absolute h-full bg-ciq-red/20 rounded-full" style={{ left: `${(hist.min / globalMax) * 100}%`, width: `${((hist.max - hist.min) / globalMax) * 100}%` }} />
                            <div className="absolute h-full w-1 bg-ciq-red rounded-full" style={{ left: `${(hist.avg / globalMax) * 100}%` }} />
                          </div>
                          <div className="flex justify-between mt-0.5">
                            <span className="text-[9px] text-gray-400">{(hist.min / 1000).toFixed(0)}k</span>
                            <span className="text-[9px] text-ciq-darkgrey font-medium">{(hist.avg / 1000).toFixed(0)}k avg</span>
                            <span className="text-[9px] text-gray-400">{(hist.max / 1000).toFixed(0)}k</span>
                          </div>
                          {hist.minLead > 0 && (
                            <p className="text-[9px] text-gray-400 text-center">{hist.minLead}-{hist.maxLead}d lead</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">No history</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-xs">{s.justification}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {/* Approval Routing */}
      {routing && routing.steps.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Approval Routing</h4>
          <div className="flex flex-wrap gap-3">
            {routing.steps.map((step, i) => (
              <div key={i} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border ${step.status === "approved" ? "bg-green-50 border-green-200" : step.status === "rejected" ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
                <span className={`w-2 h-2 rounded-full ${step.status === "approved" ? "bg-green-500" : step.status === "rejected" ? "bg-red-500" : step.status === "skipped" ? "bg-gray-400" : "bg-amber-500"}`} />
                <span className="text-sm font-medium text-gray-700">{step.role}</span>
                <span className="text-xs text-gray-400">({step.status})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Near-Miss Suppliers */}
      {analysis.near_miss_suppliers && analysis.near_miss_suppliers.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Near-Miss Suppliers</h4>
          <div className="space-y-2">
            {analysis.near_miss_suppliers.map((nm) => (
              <div key={nm.supplier_id} className="p-4 rounded-lg border bg-amber-50 border-amber-200">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-sm font-medium text-amber-900">{nm.supplier_name}</span>
                  <span className="text-xs text-amber-600 font-mono">({nm.supplier_id})</span>
                </div>
                <p className="text-sm text-amber-800">{nm.restriction_reason}</p>
                <p className="text-sm text-amber-700 mt-1 font-medium">{nm.condition_for_eligibility}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Process Trace
// ---------------------------------------------------------------------------
function ProcessTraceTab({ analysis }: { analysis: AnalysisResponse }) {
  const trace = analysis.process_trace;
  if (!trace) return <p className="text-gray-500 text-sm">No process trace available.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-700">Orchestration Steps</h4>
        {trace.total_duration_ms != null && (
          <span className="text-xs text-gray-400">Total: {(trace.total_duration_ms / 1000).toFixed(1)}s</span>
        )}
      </div>

      {/* Activated Modules */}
      {trace.activated_modules.length > 0 && (
        <div className="p-4 bg-gray-50 rounded-lg mb-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Activated Modules</p>
          <div className="flex flex-wrap gap-2">
            {trace.activated_modules.map((m) => (
              <span key={m} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${MODULE_COLORS[m] || "bg-gray-100 text-gray-700"}`}>
                {m.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Steps Timeline */}
      <div className="space-y-2">
        {trace.steps.map((step, i) => {
          const typeColor = STEP_TYPE_COLORS[step.step_type] || { bg: "bg-gray-100", text: "text-gray-700" };
          return (
            <div key={step.step_id} className="p-4 bg-gray-50 rounded-lg border border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-400">{step.step_id}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor.bg} ${typeColor.text}`}>{step.step_type}</span>
                  <span className="text-sm font-medium text-gray-800">{step.step_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {step.duration_ms != null && <span className="text-xs text-gray-400">{step.duration_ms}ms</span>}
                  <span className={`w-2 h-2 rounded-full ${step.status === "completed" ? "bg-green-500" : step.status === "failed" ? "bg-red-500" : step.status === "skipped" ? "bg-gray-400" : "bg-amber-500"}`} />
                </div>
              </div>
              {step.output_summary && <p className="text-sm text-gray-600 mt-1">{step.output_summary}</p>}
              {step.step_description && <p className="text-xs text-gray-400 italic mt-1">{step.step_description}</p>}
            </div>
          );
        })}
      </div>

      {/* Bundle trace */}
      {analysis.bundle_result && analysis.bundle_result.bundled && (
        <div className="p-4 bg-green-50 rounded-lg border border-green-200 mt-4">
          <p className="text-xs text-green-600 uppercase tracking-wider font-medium mb-2">Bundling Details</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-gray-500">Original qty:</span> <span className="font-medium">{analysis.bundle_result.original_quantity}</span></div>
            <div><span className="text-gray-500">Bundled qty:</span> <span className="font-medium">{analysis.bundle_result.bundled_quantity}</span></div>
            {analysis.bundle_result.savings_pct != null && <div><span className="text-gray-500">Savings:</span> <span className="font-medium text-green-700">{analysis.bundle_result.savings_pct}%</span></div>}
            <div><span className="text-gray-500">Capacity:</span> <span className="font-medium">{analysis.bundle_result.capacity_check}</span></div>
          </div>
        </div>
      )}

      {/* Discovery trace */}
      {analysis.discovery_result && (
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 mt-4">
          <p className="text-xs text-amber-600 uppercase tracking-wider font-medium mb-2">Discovery Details</p>
          <p className="text-sm text-gray-700">{analysis.discovery_result.discovery_strategy}</p>
          {analysis.discovery_result.estimated_timeline && <p className="text-sm text-gray-500 mt-1">Timeline: {analysis.discovery_result.estimated_timeline}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: render text with clickable AWD-xxx links + tooltips
// ---------------------------------------------------------------------------
function AwardPopup({ award, onClose }: { award: NonNullable<AnalysisResponse["historical_awards_data"]>[0]; onClose: () => void }) {
  const a = award as Record<string, unknown>;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ciq-black">{award.award_id}</h3>
            <p className="text-xs text-ciq-darkgrey">{award.supplier_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="p-5 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><p className="text-[10px] text-gray-400 uppercase">Request</p><p className="font-mono text-xs">{award.request_id}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Supplier ID</p><p className="font-mono text-xs">{award.supplier_id}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Value</p><p className="font-medium">{a.total_value != null ? `${Number(a.total_value).toLocaleString()} ${a.currency || "EUR"}` : award.award_value != null ? `${Number(award.award_value).toLocaleString()} EUR` : "-"}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Awarded</p><p className={`font-medium ${a.awarded ? "text-green-700" : "text-gray-500"}`}>{a.awarded ? "Yes (Rank " + a.award_rank + ")" : "No (Rank " + a.award_rank + ")"}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Category</p><p className="text-xs">{String(a.category_l1 || award.category_l1 || "-")} / {String(a.category_l2 || award.category_l2 || "-")}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Country</p><p className="text-xs">{String(a.country || award.delivery_country || "-")}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Lead Time</p><p className="text-xs">{a.lead_time_days ? `${a.lead_time_days} days` : "-"}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Savings</p><p className="text-xs text-green-700">{a.savings_pct ? `${a.savings_pct}%` : "-"}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Risk Score</p><p className="text-xs">{String(a.risk_score_at_award || "-")}</p></div>
            <div><p className="text-[10px] text-gray-400 uppercase">Policy Compliant</p><p className={`text-xs font-medium ${a.policy_compliant ? "text-green-700" : "text-red-700"}`}>{a.policy_compliant ? "Yes" : "No"}</p></div>
          </div>
          {a.decision_rationale ? (
            <div className="pt-2 border-t border-gray-100"><p className="text-[10px] text-gray-400 uppercase mb-1">Decision Rationale</p><p className="text-xs text-ciq-darkgrey">{String(a.decision_rationale)}</p></div>
          ) : null}
          {a.escalated_to ? (
            <div><p className="text-[10px] text-gray-400 uppercase mb-1">Escalated To</p><p className="text-xs text-amber-700">{String(a.escalated_to)}</p></div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RenderWithAwardLinks({ text, awardsData }: { text: string; awardsData?: AnalysisResponse["historical_awards_data"] }) {
  const [selectedAward, setSelectedAward] = useState<NonNullable<AnalysisResponse["historical_awards_data"]>[0] | null>(null);
  if (!text || !awardsData || awardsData.length === 0) return <>{text}</>;
  const parts = text.split(/(AWD-\w+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^AWD-\w+$/.test(part)) {
          const award = awardsData.find(a => a.award_id === part);
          if (award) {
            return (
              <span key={i} className="text-ciq-red font-medium cursor-pointer border-b border-dashed border-red-300 hover:bg-red-50 transition-colors" onClick={() => setSelectedAward(award)}>
                {part}
              </span>
            );
          }
          return <span key={i} className="text-ciq-red font-medium">{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
      {selectedAward && <AwardPopup award={selectedAward} onClose={() => setSelectedAward(null)} />}
    </>
  );
}

// Legacy wrapper for backward compat
function renderWithAwardLinks(text: string, awardsData?: AnalysisResponse["historical_awards_data"]): React.ReactNode {
  return <RenderWithAwardLinks text={text} awardsData={awardsData} />;
}

// ---------------------------------------------------------------------------
// Tab 3: Agent Logic
// ---------------------------------------------------------------------------
function AgentLogicTab({ analysis }: { analysis: AnalysisResponse }) {
  const agents = analysis.agent_opinions;
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const agentMeta: Record<string, { purpose: string; border: string; bg: string; pill: string }> = {
    historical: { purpose: "Past award patterns & savings", border: "border-blue-200", bg: "bg-blue-50", pill: "bg-blue-100 text-blue-800" },
    risk:       { purpose: "Delivery, capacity & compliance risks", border: "border-red-200",  bg: "bg-red-50", pill: "bg-red-100 text-red-800" },
    value:      { purpose: "Pricing & budget alignment", border: "border-green-200", bg: "bg-green-50", pill: "bg-green-100 text-green-800" },
    strategic:  { purpose: "ESG, preferred status & strategic fit", border: "border-purple-200", bg: "bg-purple-50", pill: "bg-purple-100 text-purple-800" },
  };

  function getAgentMeta(name: string) {
    const lower = name.toLowerCase();
    for (const [key, val] of Object.entries(agentMeta)) {
      if (lower.includes(key)) return val;
    }
    return { purpose: "Specialist agent", border: "border-gray-200", bg: "bg-gray-50", pill: "bg-gray-100 text-gray-700" };
  }

  // Extract a short summary (first sentence or first 80 chars)
  function getShortSummary(text: string): string {
    const first = text.split(/[.!;]/)[0];
    if (first.length < 100) return first.trim();
    return first.slice(0, 77).trim() + "...";
  }

  if (agents.length === 0) return <p className="text-gray-500 text-sm">No agent opinions available.</p>;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        4 specialists evaluated independently — click each to expand full reasoning.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const meta = getAgentMeta(agent.agent_name);
          const isExpanded = expandedAgent === agent.agent_name;
          const shortSummary = getShortSummary(agent.opinion_summary);

          return (
            <div key={agent.agent_name} className={`rounded-xl border ${meta.border} overflow-hidden`}>
              {/* Header */}
              <div className={`px-4 py-3 ${meta.bg} flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-ciq-black">{agent.agent_name.replace(/_/g, " ")}</h4>
                  <span className="text-[9px] text-gray-400">{meta.purpose}</span>
                </div>
                {agent.confidence != null && <span className="text-xs font-bold text-ciq-darkgrey">{Math.round(agent.confidence * 100)}%</span>}
              </div>

              <div className="p-4 space-y-3">
                {/* Summary pill — short one-liner */}
                <div className={`inline-block px-3 py-1.5 rounded-full text-xs font-medium ${meta.pill}`}>
                  {shortSummary}
                </div>

                {/* Key factors as bullet tags */}
                {agent.key_factors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {agent.key_factors.map((f, i) => (
                      <span key={i} className="flex items-center gap-1 text-xs text-ciq-darkgrey">
                        <span className="w-1 h-1 rounded-full bg-ciq-darkgrey/40" />{f}
                      </span>
                    ))}
                  </div>
                )}

                {/* Supplier rankings — always visible */}
                {agent.supplier_rankings.length > 0 && (
                  <div className="space-y-1.5">
                    {agent.supplier_rankings.map((sr) => (
                      <div key={sr.supplier_id}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-ciq-black">{sr.supplier_name}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-ciq-red rounded-full" style={{ width: `${Math.min(Math.round(sr.score), 100)}%` }} />
                            </div>
                            <span className="text-[10px] text-ciq-darkgrey font-mono w-8 text-right">{Math.round(sr.score)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Expand/collapse for full analysis */}
                <button onClick={() => setExpandedAgent(isExpanded ? null : agent.agent_name)} className="text-xs text-ciq-red hover:underline flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
                  {isExpanded ? "Collapse" : "Full analysis"}
                </button>

                {/* Expanded: full opinion + ranking rationale */}
                {isExpanded && (
                  <div className="pt-3 border-t border-gray-100 space-y-3 animate-fade-in">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">Full Opinion</p>
                      <TextToBullets text={agent.opinion_summary} maxBullets={10} />
                    </div>
                    {agent.supplier_rankings.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">Ranking Rationale</p>
                        {agent.supplier_rankings.map((sr) => (
                          sr.rationale && (
                            <div key={sr.supplier_id} className="mb-2">
                              <p className="text-xs font-medium text-ciq-black">{sr.supplier_name}</p>
                              <p className="text-xs text-ciq-darkgrey ml-2">
                                {agent.agent_name.toLowerCase().includes("historical")
                                  ? renderWithAwardLinks(sr.rationale, analysis.historical_awards_data)
                                  : sr.rationale}
                              </p>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Governance
// ---------------------------------------------------------------------------
function CollapsibleSection({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-ciq-black">{title}</h4>
          {badge}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" className={`transition-transform ${open ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && <div className="p-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function GovernanceTab({ analysis }: { analysis: AnalysisResponse }) {
  const gov = analysis.governance;
  if (!gov) return <p className="text-gray-500 text-sm">No governance data available.</p>;

  const findingTypeColors: Record<string, string> = {
    contradiction: "bg-red-100 text-red-700", weak_evidence: "bg-amber-100 text-amber-700",
    hidden_risk: "bg-orange-100 text-orange-700", unsupported_claim: "bg-yellow-100 text-yellow-700",
    bias_alert: "bg-purple-100 text-purple-700",
  };

  // Build key insights summary
  const insights: { icon: string; text: string; color: string }[] = [];
  if (gov.critic_findings.length === 0) {
    insights.push({ icon: "check", text: "No critic findings — analyses passed review", color: "text-green-700" });
  } else {
    insights.push({ icon: "alert", text: `${gov.critic_findings.length} finding${gov.critic_findings.length > 1 ? "s" : ""} flagged by critic agent`, color: "text-red-700" });
  }
  if (gov.judge_decision) {
    insights.push({ icon: "scale", text: `Judge confidence: ${Math.round(gov.judge_decision.confidence_assessment * 100)}% — ${gov.judge_decision.confidence_explanation?.slice(0, 80) || "N/A"}`, color: "text-ciq-darkgrey" });
  }
  if (gov.reviewer_verdict) {
    insights.push({ icon: gov.reviewer_verdict.audit_ready ? "check" : "alert", text: gov.reviewer_verdict.audit_ready ? "Audit ready — reviewer approved" : `Review needed: ${gov.reviewer_verdict.sign_off_note?.slice(0, 80)}`, color: gov.reviewer_verdict.audit_ready ? "text-green-700" : "text-amber-700" });
  }

  return (
    <div className="space-y-4">
      {/* Key Insights Summary */}
      <div className="p-4 bg-gray-50 rounded-xl space-y-2">
        <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Key Insights</p>
        {insights.map((ins, i) => (
          <div key={i} className={`flex items-center gap-2 text-sm ${ins.color}`}>
            {ins.icon === "check" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            )}
            <span>{ins.text}</span>
          </div>
        ))}
      </div>

      {/* Collapsible sections */}
      <CollapsibleSection
        title="Critic Findings"
        badge={<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gov.critic_findings.length > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{gov.critic_findings.length}</span>}
      >
        {gov.critic_findings.length > 0 ? (
          <div className="space-y-2">
            {gov.critic_findings.map((f) => (
              <div key={f.finding_id} className={`p-3 rounded-lg border ${SEVERITY_COLORS[f.severity] || "bg-gray-50 border-gray-200"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${findingTypeColors[f.finding_type] || "bg-gray-100 text-gray-700"}`}>{f.finding_type.replace(/_/g, " ")}</span>
                  <span className="text-xs font-bold uppercase ml-auto">{f.severity}</span>
                </div>
                <p className="text-sm">{f.description}</p>
                {f.suggested_action && <p className="text-xs text-gray-500 mt-1">Action: {f.suggested_action}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">All clear — no issues found.</p>
        )}
      </CollapsibleSection>

      {gov.judge_decision && (
        <CollapsibleSection
          title="Judge Resolution"
          badge={<span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{Math.round(gov.judge_decision.confidence_assessment * 100)}%</span>}
        >
          <div className="space-y-3">
            {gov.judge_decision.disagreements_resolved.length > 0 && gov.judge_decision.disagreements_resolved.map((d, i) => (
              <div key={i} className="p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm font-medium text-red-800">{d.topic}</p>
                <p className="text-xs text-red-600 mt-0.5">Agents: {d.agents_involved.join(", ")}</p>
                <p className="text-sm text-gray-700 mt-1">{d.resolution}</p>
              </div>
            ))}
            <p className="text-sm text-ciq-darkgrey">{gov.judge_decision.weight_rationale}</p>
            {gov.judge_decision.bias_checks.map((check, i) => (
              <p key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" className="mt-0.5 flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                {check}
              </p>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {gov.reviewer_verdict && (
        <CollapsibleSection
          title="Reviewer Verdict"
          badge={<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gov.reviewer_verdict.audit_ready ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{gov.reviewer_verdict.audit_ready ? "Ready" : "Needs Review"}</span>}
        >
          <div className="space-y-2">
            <p className="text-sm text-gray-700">{gov.reviewer_verdict.sign_off_note}</p>
            {gov.reviewer_verdict.issues.map((issue, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[issue.severity]?.split(" ").slice(0, 2).join(" ") || "bg-gray-100 text-gray-700"}`}>{issue.severity}</span>
                <span className="text-gray-700">{issue.description}</span>
              </div>
            ))}
            {gov.reviewer_verdict.evidence_gaps.length > 0 && (
              <div className="mt-2"><p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Evidence Gaps</p>
              {gov.reviewer_verdict.evidence_gaps.map((gap, i) => <p key={i} className="text-sm text-gray-600">- {gap}</p>)}</div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {gov.governance_memory_summary && gov.governance_memory_summary.length > 0 && (
        <CollapsibleSection title="Governance Memory">
          <div className="space-y-1">
            {gov.governance_memory_summary.map((note, i) => (
              <p key={i} className="text-sm text-gray-600">{note}</p>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5: Audit Trail
// ---------------------------------------------------------------------------
function AuditTrailTab({ analysis }: { analysis: AnalysisResponse }) {
  const audit = analysis.audit_trail;
  const validation = analysis.validation;
  const policy = analysis.policy_evaluation;
  const escalations = analysis.escalations;
  const trace = analysis.process_trace;
  const gov = analysis.governance;
  const rec = analysis.recommendation;
  const interp = analysis.request_interpretation;

  // Build sequential chain of thoughts
  let stepNum = 0;
  const S = () => { stepNum++; return stepNum; };

  return (
    <div className="space-y-4">
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-ciq-darkgrey">
        Complete decision chain — every step that led to this recommendation, in order. An auditor can follow this trail to verify the decision logic.
      </div>

      {/* Step 1: Request Interpretation */}
      {interp && (
        <AuditStep num={S()} title="Request Interpreted" status="completed">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><span className="text-gray-400">Category:</span> <span className="font-medium">{interp.category_l1} / {interp.category_l2}</span></div>
            <div><span className="text-gray-400">Quantity:</span> <span className="font-medium">{interp.quantity} {interp.unit_of_measure}</span></div>
            <div><span className="text-gray-400">Budget:</span> <span className="font-medium">{interp.budget_amount?.toLocaleString()} {interp.currency}</span></div>
            <div><span className="text-gray-400">Delivery:</span> <span className="font-medium">{interp.delivery_country} — {interp.days_until_required}d</span></div>
          </div>
        </AuditStep>
      )}

      {/* Step 2: Validation */}
      {validation && (
        <AuditStep num={S()} title="Validation Check" status={validation.completeness === "pass" ? "completed" : "warning"}>
          <span className={`text-xs font-medium ${validation.completeness === "pass" ? "text-green-700" : "text-red-700"}`}>
            {validation.completeness === "pass" ? "All required fields present" : `${validation.issues_detected.length} issue${validation.issues_detected.length !== 1 ? "s" : ""} detected`}
          </span>
          {validation.issues_detected.map(issue => (
            <p key={issue.issue_id} className="text-xs text-ciq-darkgrey mt-1">- [{issue.severity}] {issue.description}</p>
          ))}
        </AuditStep>
      )}

      {/* Step 3: Policy Evaluation */}
      {policy && (
        <AuditStep num={S()} title="Policy Rules Applied" status="completed">
          <div className="text-xs space-y-1">
            {policy.approval_threshold && <p><span className="text-gray-400">Threshold:</span> {policy.approval_threshold.rule_applied} — {policy.approval_threshold.quotes_required} quotes required, approved by {policy.approval_threshold.approvers?.join(", ")}</p>}
            {policy.preferred_supplier?.supplier && <p><span className="text-gray-400">Preferred:</span> {policy.preferred_supplier.supplier} — {policy.preferred_supplier.is_preferred ? "confirmed preferred" : "not preferred"}{policy.preferred_supplier.is_restricted ? " (RESTRICTED)" : ""}</p>}
          </div>
        </AuditStep>
      )}

      {/* Step 4: Supplier Screening */}
      <AuditStep num={S()} title="Supplier Screening" status="completed">
        <div className="text-xs">
          <p><span className="text-gray-400">Evaluated:</span> {audit?.supplier_ids_evaluated?.length || 0} suppliers</p>
          <p><span className="text-gray-400">Excluded:</span> {analysis.suppliers_excluded.length} suppliers</p>
          {analysis.suppliers_excluded.map(s => (
            <p key={s.supplier_id} className="text-ciq-darkgrey mt-0.5">- {s.supplier_name}: {s.reason}</p>
          ))}
        </div>
      </AuditStep>

      {/* Step 5: Process Trace */}
      {trace && trace.steps.length > 0 && (
        <AuditStep num={S()} title={`Pipeline Execution (${trace.steps.length} steps, ${((trace.total_duration_ms || 0) / 1000).toFixed(1)}s)`} status="completed">
          <div className="space-y-1">
            {trace.steps.map(step => (
              <div key={step.step_id} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${step.status === "completed" ? "bg-green-500" : step.status === "failed" ? "bg-red-500" : "bg-amber-500"}`} />
                <span className="text-gray-400 font-mono w-16 flex-shrink-0">{step.step_id}</span>
                <span className="text-ciq-black font-medium">{step.step_name}</span>
                {step.duration_ms != null && <span className="text-gray-400 ml-auto">{step.duration_ms}ms</span>}
              </div>
            ))}
          </div>
        </AuditStep>
      )}

      {/* Step 6: Escalations */}
      {escalations.length > 0 && (
        <AuditStep num={S()} title={`Escalations Triggered (${escalations.length})`} status="warning">
          {escalations.map(esc => (
            <div key={esc.escalation_id} className="text-xs mt-1">
              <span className={`font-bold ${esc.blocking ? "text-red-700" : "text-amber-700"}`}>{esc.blocking ? "BLOCKING" : "WARNING"}</span>
              <span className="text-gray-400 ml-1">{esc.rule}:</span> {esc.trigger?.slice(0, 100)} → <span className="font-medium">{esc.escalate_to}</span>
            </div>
          ))}
        </AuditStep>
      )}

      {/* Step 7: Agent Opinions Summary */}
      {analysis.agent_opinions.length > 0 && (
        <AuditStep num={S()} title={`${analysis.agent_opinions.length} Specialist Agents Evaluated`} status="completed">
          {analysis.agent_opinions.map(agent => (
            <div key={agent.agent_name} className="text-xs mt-1">
              <span className="font-medium text-ciq-black">{agent.agent_name.replace(/_/g, " ")}:</span>
              <span className="text-ciq-darkgrey ml-1">{agent.opinion_summary.slice(0, 120)}{agent.opinion_summary.length > 120 ? "..." : ""}</span>
              {agent.confidence != null && <span className="text-gray-400 ml-1">({Math.round(agent.confidence * 100)}%)</span>}
            </div>
          ))}
        </AuditStep>
      )}

      {/* Step 8: Governance */}
      {gov && (
        <AuditStep num={S()} title="Governance Review" status={gov.reviewer_verdict?.audit_ready ? "completed" : "warning"}>
          <div className="text-xs space-y-1">
            <p><span className="text-gray-400">Critic:</span> {gov.critic_findings.length === 0 ? "No issues found" : `${gov.critic_findings.length} finding(s)`}</p>
            <p><span className="text-gray-400">Judge:</span> Confidence {Math.round((gov.judge_decision?.confidence_assessment || 0) * 100)}%{gov.judge_decision?.final_ranking?.length ? `, ranked ${gov.judge_decision.final_ranking.length} suppliers` : ""}</p>
            <p><span className="text-gray-400">Reviewer:</span> {gov.reviewer_verdict?.audit_ready ? "Audit ready" : "Needs review"} — {gov.reviewer_verdict?.sign_off_note?.slice(0, 100)}</p>
          </div>
        </AuditStep>
      )}

      {/* Step 9: Final Recommendation */}
      {rec && (
        <AuditStep num={S()} title="Final Recommendation" status={rec.status.includes("cannot") ? "failed" : rec.status.includes("condition") ? "warning" : "completed"}>
          <div className="text-xs">
            <p className="font-medium text-ciq-black mb-1">
              {rec.status.replace(/_/g, " ").toUpperCase()}
              {rec.preferred_supplier_if_resolved && ` — Top: ${rec.preferred_supplier_if_resolved}`}
            </p>
            <p className="text-ciq-darkgrey">{rec.reason?.slice(0, 200)}</p>
          </div>
        </AuditStep>
      )}

      {/* Data Sources */}
      {audit && audit.data_sources_used.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">Data Sources Used</p>
          <div className="flex flex-wrap gap-1">{audit.data_sources_used.map((d, i) => <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">{d}</span>)}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6: Comparison (Heatmap)
// ---------------------------------------------------------------------------
function ComparisonTab({ analysis }: { analysis: AnalysisResponse }) {
  const heatmap = analysis.supplier_heatmap;
  if (!heatmap || heatmap.length === 0) return <p className="text-gray-500 text-sm">No comparison data available.</p>;

  const dimensions = heatmap[0]?.cells.map(c => c.dimension) || [];

  function cellColor(score: number): string {
    if (score >= 90) return "bg-green-500 text-white";
    if (score >= 75) return "bg-green-300 text-green-900";
    if (score >= 60) return "bg-yellow-200 text-yellow-900";
    if (score >= 45) return "bg-amber-300 text-amber-900";
    if (score >= 30) return "bg-orange-400 text-white";
    return "bg-red-500 text-white";
  }

  function dimensionLabel(dim: string) {
    const labels: Record<string, string> = {
      policy_compliance: "Policy",
      price: "Price",
      lead_time: "Lead Time",
      geography: "Geography",
      esg: "ESG",
      quality_risk: "Quality/Risk",
    };
    return labels[dim] || dim.replace(/_/g, " ");
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
            {dimensions.map(dim => (
              <th key={dim} className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">{dimensionLabel(dim)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {heatmap.map((row) => (
            <tr key={row.supplier_id}>
              <td className="px-3 py-3">
                <p className="text-sm font-medium text-gray-900">{row.supplier_name}</p>
                <p className="text-xs text-gray-400 font-mono">{row.supplier_id}</p>
              </td>
              {row.cells.map((cell) => (
                <td key={cell.dimension} className="px-3 py-3 text-center">
                  <div className="group relative inline-block">
                    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-xs font-bold ${cellColor(cell.score)}`}>
                      {cell.score}
                    </span>
                    <span className={`block text-xs mt-0.5 ${cell.label === "Good" ? "text-green-600" : cell.label === "Fair" ? "text-amber-600" : "text-red-600"}`}>
                      {cell.label}
                    </span>
                    {cell.detail && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                        {cell.detail}
                      </div>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
