"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchRequest, analyzeRequest } from "@/lib/api";
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
  { id: "audit", label: "Audit Trail" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------
export default function RequestAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [request, setRequest] = useState<ProcurementRequest | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("recommendation");

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
        sessionStorage.removeItem(`analysis_${requestId}`);
        return;
      } catch { /* fall through */ }
    }
    fetchRequest(requestId)
      .then(setRequest)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [requestId]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeRequest(requestId);
      setAnalysis(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="flex gap-1.5"><span className="w-3 h-3 rounded-full bg-indigo-500 loading-dot" /><span className="w-3 h-3 rounded-full bg-indigo-500 loading-dot" /><span className="w-3 h-3 rounded-full bg-indigo-500 loading-dot" /></div></div>;
  if (!request) return <div className="flex flex-col items-center justify-center h-full gap-3"><p className="text-gray-500">Request not found</p><button onClick={() => router.push("/")} className="text-indigo-600 text-sm hover:underline">Back to Dashboard</button></div>;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <button onClick={() => router.push("/")} className="text-gray-400 hover:text-gray-600">Dashboard</button>
        <span className="text-gray-300">/</span>
        <span className="text-gray-700 font-medium">{requestId}</span>
      </div>

      {/* Request Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{request.title || "Untitled Request"}</h1>
            <p className="text-gray-500 text-sm mt-1 font-mono">{requestId}</p>
          </div>
          {!analysis && (
            <button onClick={handleAnalyze} disabled={analyzing} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50">
              {analyzing ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analyzing...</>) : (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>Run Analysis</>)}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100">
          <DetailItem label="Category" value={`${request.category_l1 || "-"} / ${request.category_l2 || "-"}`} />
          <DetailItem label="Country" value={request.country || "-"} />
          <DetailItem label="Budget" value={request.budget_amount != null ? `${Number(request.budget_amount).toLocaleString()} ${request.currency || "EUR"}` : "-"} />
          <DetailItem label="Quantity" value={request.quantity != null ? `${Number(request.quantity).toLocaleString()} ${request.unit_of_measure || "units"}` : "-"} />
        </div>
        {request.scenario_tags && request.scenario_tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {request.scenario_tags.map((tag) => {
              const tc = TAG_COLORS[tag] || { bg: "bg-gray-50", text: "text-gray-700" };
              return <span key={tag} className={`px-2.5 py-1 rounded-full text-xs font-medium ${tc.bg} ${tc.text}`}>{tag.replace(/_/g, " ")}</span>;
            })}
          </div>
        )}
        {request.request_text && <div className="mt-4 p-4 bg-gray-50 rounded-lg"><p className="text-sm text-gray-700 whitespace-pre-wrap">{request.request_text}</p></div>}
      </div>

      {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
      {analyzing && <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 flex flex-col items-center justify-center gap-4"><div className="w-12 h-12 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" style={{ borderWidth: 3 }} /><p className="text-gray-600 font-medium">Running universal orchestration pipeline...</p><p className="text-gray-400 text-sm">Supervisor → Specialists → Critic → Judge → Reviewer</p></div>}

      {analysis && !analyzing && (
        <div className="animate-fade-in">
          <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-1.5 overflow-x-auto">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab.id ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"}`}>
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
            {activeTab === "audit" && <AuditTrailTab analysis={analysis} />}
          </div>
        </div>
      )}
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
function RecommendationTab({ analysis }: { analysis: AnalysisResponse }) {
  const rec = analysis.recommendation;
  const confidence = analysis.confidence;
  const governance = analysis.governance;
  const routing = analysis.approval_routing;
  const modules = analysis.activated_modules || [];

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
        {rec.reason && <p className={`mt-2 text-sm ${statusStyle.text} opacity-80`}>{rec.reason}</p>}
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
            {confidence.explanation && <p className="text-sm text-gray-600 mt-3 text-center">{confidence.explanation}</p>}
          </div>
        )}
        <div className="space-y-4">
          {rec.preferred_supplier_if_resolved && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Top Ranked Supplier</p>
              <p className="text-sm text-gray-800 font-medium">{rec.preferred_supplier_if_resolved}</p>
              {rec.preferred_supplier_rationale && <p className="text-sm text-gray-600 mt-1">{rec.preferred_supplier_rationale}</p>}
            </div>
          )}
          {/* Judge weight rationale */}
          {governance?.judge_decision?.weight_rationale && (
            <div className="p-4 bg-indigo-50 rounded-lg">
              <p className="text-xs text-indigo-400 uppercase tracking-wider font-medium mb-1">Judge Weight Rationale</p>
              <p className="text-sm text-indigo-800">{governance.judge_decision.weight_rationale}</p>
            </div>
          )}
        </div>
      </div>

      {/* Supplier Ranking from Judge */}
      {governance?.judge_decision?.final_ranking && governance.judge_decision.final_ranking.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Judge-Adjudicated Ranking</h4>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-100">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Rank</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Score</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Justification</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {governance.judge_decision.final_ranking.map((s) => (
                  <tr key={s.supplier_id} className={s.rank === 1 ? "bg-green-50/30" : ""}>
                    <td className="px-3 py-3"><span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${s.rank === 1 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{s.rank}</span></td>
                    <td className="px-3 py-3"><p className="text-sm font-medium text-gray-900">{s.supplier_name}</p><p className="text-xs text-gray-400 font-mono">{s.supplier_id}</p></td>
                    <td className="px-3 py-3 text-center"><span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-indigo-50 text-indigo-700">{Math.round(s.composite_score)}</span></td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-md">{s.justification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
// Tab 3: Agent Logic
// ---------------------------------------------------------------------------
function AgentLogicTab({ analysis }: { analysis: AnalysisResponse }) {
  const agents = analysis.agent_opinions;

  const agentMeta: Record<string, { purpose: string; border: string; bg: string }> = {
    historical: { purpose: "Analyzes past award patterns, win rates, and savings for this category/country", border: "border-blue-200", bg: "bg-blue-50" },
    risk:       { purpose: "Evaluates supplier risks including delivery, capacity, concentration, and compliance", border: "border-red-200",  bg: "bg-red-50" },
    value:      { purpose: "Assesses pricing competitiveness, budget fit, and total cost of ownership", border: "border-green-200", bg: "bg-green-50" },
    strategic:  { purpose: "Evaluates ESG alignment, preferred status, and long-term strategic fit", border: "border-purple-200", bg: "bg-purple-50" },
  };

  function getAgentMeta(name: string) {
    const lower = name.toLowerCase();
    for (const [key, val] of Object.entries(agentMeta)) {
      if (lower.includes(key)) return val;
    }
    return { purpose: "Specialist agent", border: "border-gray-200", bg: "bg-gray-50" };
  }

  if (agents.length === 0) return <p className="text-gray-500 text-sm">No agent opinions available.</p>;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm text-slate-600 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        Specialists evaluated independently — no agent saw another agent&apos;s output during analysis.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const meta = getAgentMeta(agent.agent_name);
          return (
            <div key={agent.agent_name} className={`rounded-xl border ${meta.border} overflow-hidden`}>
              <div className={`px-5 py-3 ${meta.bg} flex items-center justify-between`}>
                <h4 className="text-sm font-bold text-gray-800">{agent.agent_name.replace(/_/g, " ")}</h4>
                {agent.confidence != null && <span className="text-xs font-medium text-gray-600">Confidence: {Math.round(agent.confidence * 100)}%</span>}
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-gray-400 italic">{meta.purpose}</p>
                <p className="text-sm text-gray-700">{agent.opinion_summary}</p>
                {agent.key_factors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {agent.key_factors.map((f, i) => <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{f}</span>)}
                  </div>
                )}
                {agent.supplier_rankings.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Rankings</p>
                    {agent.supplier_rankings.map((sr) => (
                      <div key={sr.supplier_id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{sr.supplier_name}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(Math.round(sr.score), 100)}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right font-mono">{Math.round(sr.score)}</span>
                        </div>
                      </div>
                    ))}
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
function GovernanceTab({ analysis }: { analysis: AnalysisResponse }) {
  const gov = analysis.governance;
  if (!gov) return <p className="text-gray-500 text-sm">No governance data available.</p>;

  const findingTypeColors: Record<string, string> = {
    contradiction:     "bg-red-100 text-red-700",
    weak_evidence:     "bg-amber-100 text-amber-700",
    hidden_risk:       "bg-orange-100 text-orange-700",
    unsupported_claim: "bg-yellow-100 text-yellow-700",
    bias_alert:        "bg-purple-100 text-purple-700",
  };

  return (
    <div className="space-y-6">
      {/* Critic Findings */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Critic Findings</h4>
        {gov.critic_findings.length > 0 ? (
          <div className="space-y-2">
            {gov.critic_findings.map((f) => (
              <div key={f.finding_id} className={`p-4 rounded-lg border ${SEVERITY_COLORS[f.severity] || "bg-gray-50 border-gray-200"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${findingTypeColors[f.finding_type] || "bg-gray-100 text-gray-700"}`}>{f.finding_type.replace(/_/g, " ")}</span>
                  <span className="text-xs font-mono text-gray-400">{f.finding_id}</span>
                  <span className="text-xs font-bold uppercase ml-auto">{f.severity}</span>
                </div>
                <p className="text-sm font-medium">{f.description}</p>
                {f.affected_agents.length > 0 && <p className="text-xs text-gray-500 mt-1">Agents: {f.affected_agents.join(", ")}</p>}
                {f.suggested_action && <p className="text-xs text-gray-500 mt-0.5">Action: {f.suggested_action}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No findings — specialist analyses passed critic review.</p>
        )}
      </div>

      {/* Judge Resolution */}
      {gov.judge_decision && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Judge Resolution</h4>
          {gov.judge_decision.disagreements_resolved.length > 0 && (
            <div className="space-y-2 mb-4">
              {gov.judge_decision.disagreements_resolved.map((d, i) => (
                <div key={i} className="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                  <p className="text-sm font-medium text-indigo-800">{d.topic}</p>
                  <p className="text-xs text-indigo-600 mt-0.5">Agents: {d.agents_involved.join(", ")}</p>
                  <p className="text-sm text-gray-700 mt-1"><span className="font-medium">Resolution:</span> {d.resolution}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{d.reasoning}</p>
                </div>
              ))}
            </div>
          )}
          {gov.judge_decision.bias_checks.length > 0 && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Bias Checks</p>
              <div className="space-y-1">
                {gov.judge_decision.bias_checks.map((check, i) => (
                  <p key={i} className="text-sm text-gray-600 flex items-start gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" className="mt-0.5 flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                    {check}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reviewer Feedback */}
      {gov.reviewer_verdict && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Reviewer Feedback</h4>
          <div className={`p-4 rounded-lg border ${gov.reviewer_verdict.audit_ready ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${gov.reviewer_verdict.audit_ready ? "bg-green-500" : "bg-amber-500"}`} />
              <span className={`text-sm font-bold ${gov.reviewer_verdict.audit_ready ? "text-green-800" : "text-amber-800"}`}>
                {gov.reviewer_verdict.audit_ready ? "Audit Ready" : "Review Issues Found"}
              </span>
            </div>
            <p className="text-sm text-gray-700">{gov.reviewer_verdict.sign_off_note}</p>
            {gov.reviewer_verdict.issues.length > 0 && (
              <div className="mt-3 space-y-1">
                {gov.reviewer_verdict.issues.map((issue, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[issue.severity]?.split(" ").slice(0, 2).join(" ") || "bg-gray-100 text-gray-700"}`}>{issue.severity}</span>
                    <span className="text-gray-700">{issue.description}</span>
                  </div>
                ))}
              </div>
            )}
            {gov.reviewer_verdict.evidence_gaps.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Evidence Gaps</p>
                {gov.reviewer_verdict.evidence_gaps.map((gap, i) => <p key={i} className="text-sm text-gray-600">- {gap}</p>)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Governance Memory */}
      {gov.governance_memory_summary && gov.governance_memory_summary.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Governance Memory Applied</h4>
          <div className="space-y-1">
            {gov.governance_memory_summary.map((note, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">{note}</div>
            ))}
          </div>
        </div>
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

  return (
    <div className="space-y-6">
      {/* Validation */}
      {validation && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Validation</h4>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-3 ${validation.completeness === "pass" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            <span className={`w-2 h-2 rounded-full ${validation.completeness === "pass" ? "bg-green-500" : "bg-red-500"}`} />
            Completeness: {validation.completeness}
          </div>
          {validation.issues_detected.length > 0 && (
            <div className="space-y-2">
              {validation.issues_detected.map((issue) => (
                <div key={issue.issue_id} className={`p-4 rounded-lg border ${SEVERITY_COLORS[issue.severity] || "bg-gray-50 border-gray-200"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase">{issue.severity}</span>
                    <span className="text-xs opacity-60 font-mono">{issue.issue_id}</span>
                  </div>
                  <p className="text-sm font-medium">{issue.description}</p>
                  {issue.action_required && <p className="text-xs mt-1 opacity-75">Action: {issue.action_required}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Escalations */}
      {escalations.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Escalations</h4>
          <div className="space-y-2">
            {escalations.map((esc) => (
              <div key={esc.escalation_id} className={`p-4 rounded-lg border ${esc.blocking ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-bold ${esc.blocking ? "text-red-800" : "text-amber-800"}`}>{esc.blocking ? "BLOCKING" : "WARNING"}</span>
                  <span className="text-xs font-mono text-gray-400">{esc.escalation_id}</span>
                </div>
                {esc.rule && <p className="text-sm text-gray-700"><span className="font-medium">Rule:</span> {esc.rule}</p>}
                {esc.trigger && <p className="text-sm text-gray-700"><span className="font-medium">Trigger:</span> {esc.trigger}</p>}
                {esc.escalate_to && <p className="text-sm text-gray-700"><span className="font-medium">Escalate to:</span> {esc.escalate_to}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Policy */}
      {policy && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Policy Evaluation</h4>
          <div className="space-y-3">
            {policy.approval_threshold && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Approval Threshold</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {policy.approval_threshold.rule_applied && <div><span className="text-gray-400">Rule:</span> <span className="text-gray-700">{policy.approval_threshold.rule_applied}</span></div>}
                  {policy.approval_threshold.quotes_required != null && <div><span className="text-gray-400">Quotes:</span> <span className="text-gray-700">{policy.approval_threshold.quotes_required}</span></div>}
                </div>
              </div>
            )}
            {policy.preferred_supplier && policy.preferred_supplier.supplier && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Preferred Supplier</p>
                <p className="text-sm"><span className="text-gray-400">Supplier:</span> <span className="text-gray-700 font-medium">{policy.preferred_supplier.supplier}</span></p>
                <p className="text-sm"><span className="text-gray-400">Is Preferred:</span> <span className={policy.preferred_supplier.is_preferred ? "text-green-600" : "text-red-600"}>{policy.preferred_supplier.is_preferred ? "Yes" : "No"}</span></p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audit details */}
      {audit && (
        <div className="space-y-4">
          {audit.policies_checked.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Policies Checked</p>
              <div className="flex flex-wrap gap-1.5">{audit.policies_checked.map((p, i) => <span key={i} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium">{p}</span>)}</div>
            </div>
          )}
          {audit.supplier_ids_evaluated.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Suppliers Evaluated</p>
              <div className="flex flex-wrap gap-1.5">{audit.supplier_ids_evaluated.map((s, i) => <span key={i} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-mono">{s}</span>)}</div>
            </div>
          )}
          {audit.data_sources_used.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Data Sources</p>
              <div className="flex flex-wrap gap-1.5">{audit.data_sources_used.map((d, i) => <span key={i} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium">{d}</span>)}</div>
            </div>
          )}
        </div>
      )}

      {/* Supplier exclusions */}
      {analysis.suppliers_excluded.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Excluded Suppliers</h4>
          <div className="space-y-2">
            {analysis.suppliers_excluded.map((s) => (
              <div key={s.supplier_id} className="flex items-center gap-3 p-3 bg-red-50/50 border border-red-100 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-sm font-medium text-gray-800">{s.supplier_name}</span>
                <span className="text-sm text-gray-500">({s.supplier_id})</span>
                {s.reason && <span className="text-sm text-red-600 ml-auto">{s.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
