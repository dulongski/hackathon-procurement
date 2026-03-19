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
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  can_proceed:      { bg: "bg-green-50",  border: "border-green-200", text: "text-green-800", label: "Can Proceed" },
  proceed:          { bg: "bg-green-50",  border: "border-green-200", text: "text-green-800", label: "Proceed" },
  conditions:       { bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-800", label: "Proceed with Conditions" },
  proceed_with_conditions: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", label: "Proceed with Conditions" },
  cannot_proceed:   { bg: "bg-red-50",    border: "border-red-200",   text: "text-red-800",   label: "Cannot Proceed" },
};

function getStatusStyle(status: string) {
  // Try exact match, then partial
  if (STATUS_COLORS[status]) return STATUS_COLORS[status];
  if (status.includes("cannot")) return STATUS_COLORS.cannot_proceed;
  if (status.includes("condition")) return STATUS_COLORS.conditions;
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

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------
const TABS = [
  { id: "recommendation", label: "Recommendation" },
  { id: "suppliers", label: "Supplier Comparison" },
  { id: "agents", label: "Agent Opinions" },
  { id: "policy", label: "Policy & Validation" },
  { id: "escalation", label: "Escalation" },
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
    // Check if we have a cached custom analysis result
    const cached = sessionStorage.getItem(`analysis_${requestId}`);
    if (cached) {
      try {
        const cachedAnalysis = JSON.parse(cached) as AnalysisResponse;
        setAnalysis(cachedAnalysis);
        // Build a synthetic request from the analysis interpretation
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
          unit_of_measure: interp?.unit_of_measure ?? undefined,
        });
        setLoading(false);
        sessionStorage.removeItem(`analysis_${requestId}`);
        return;
      } catch { /* fall through to fetch */ }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-indigo-500 loading-dot" />
          <span className="w-3 h-3 rounded-full bg-indigo-500 loading-dot" />
          <span className="w-3 h-3 rounded-full bg-indigo-500 loading-dot" />
        </div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-gray-500">Request not found</p>
        <button onClick={() => router.push("/")} className="text-indigo-600 text-sm hover:underline">
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <button onClick={() => router.push("/")} className="text-gray-400 hover:text-gray-600">
          Dashboard
        </button>
        <span className="text-gray-300">/</span>
        <span className="text-gray-700 font-medium">{requestId}</span>
      </div>

      {/* Request Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {request.title || "Untitled Request"}
            </h1>
            <p className="text-gray-500 text-sm mt-1 font-mono">{requestId}</p>
          </div>
          {!analysis && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {analyzing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Run Analysis
                </>
              )}
            </button>
          )}
        </div>

        {/* Request details grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100">
          <DetailItem label="Category" value={`${request.category_l1 || "-"} / ${request.category_l2 || "-"}`} />
          <DetailItem label="Country" value={request.country || "-"} />
          <DetailItem
            label="Budget"
            value={
              request.budget_amount != null
                ? `${Number(request.budget_amount).toLocaleString()} ${request.currency || "EUR"}`
                : "-"
            }
          />
          <DetailItem
            label="Quantity"
            value={
              request.quantity != null
                ? `${Number(request.quantity).toLocaleString()} ${request.unit_of_measure || "units"}`
                : "-"
            }
          />
        </div>

        {/* Tags */}
        {request.scenario_tags && request.scenario_tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {request.scenario_tags.map((tag) => {
              const tc = TAG_COLORS[tag] || { bg: "bg-gray-50", text: "text-gray-700" };
              return (
                <span key={tag} className={`px-2.5 py-1 rounded-full text-xs font-medium ${tc.bg} ${tc.text}`}>
                  {tag.replace(/_/g, " ")}
                </span>
              );
            })}
          </div>
        )}

        {/* Request text */}
        {request.request_text && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{request.request_text}</p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Analyzing state */}
      {analyzing && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" style={{ borderWidth: 3 }} />
          <p className="text-gray-600 font-medium">Running procurement analysis pipeline...</p>
          <p className="text-gray-400 text-sm">Evaluating suppliers, policies, and agent consensus</p>
        </div>
      )}

      {/* Analysis Results */}
      {analysis && !analyzing && (
        <div className="animate-fade-in">
          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-1.5 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                {tab.label}
                {tab.id === "escalation" && analysis.escalations.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs">
                    {analysis.escalations.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            {activeTab === "recommendation" && <RecommendationTab analysis={analysis} />}
            {activeTab === "suppliers" && <SupplierTab analysis={analysis} />}
            {activeTab === "agents" && <AgentsTab analysis={analysis} />}
            {activeTab === "policy" && <PolicyTab analysis={analysis} />}
            {activeTab === "escalation" && <EscalationTab analysis={analysis} />}
            {activeTab === "audit" && <AuditTab analysis={analysis} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5 font-medium">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confidence Gauge (circular SVG)
// ---------------------------------------------------------------------------
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
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
        <text x="60" y="56" textAnchor="middle" className="text-2xl font-bold" fill="#1f2937" fontSize="24">
          {pct}%
        </text>
        <text x="60" y="74" textAnchor="middle" fill="#9ca3af" fontSize="11">
          confidence
        </text>
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
  const routing = analysis.approval_routing;

  if (!rec) {
    return <p className="text-gray-500 text-sm">No recommendation available.</p>;
  }

  const statusStyle = getStatusStyle(rec.status);

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div className={`p-5 rounded-xl border ${statusStyle.bg} ${statusStyle.border}`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            rec.status.includes("cannot") ? "bg-red-500" : rec.status.includes("condition") ? "bg-amber-500" : "bg-green-500"
          }`} />
          <h3 className={`text-lg font-bold ${statusStyle.text}`}>
            {statusStyle.label}
          </h3>
        </div>
        {rec.reason && <p className={`mt-2 text-sm ${statusStyle.text} opacity-80`}>{rec.reason}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Confidence */}
        {confidence && (
          <div className="flex flex-col items-center p-6 bg-gray-50 rounded-xl">
            <ConfidenceGauge score={confidence.overall_score} />
            {confidence.explanation && (
              <p className="text-sm text-gray-600 mt-3 text-center">{confidence.explanation}</p>
            )}
            {confidence.factors.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
                {confidence.factors.map((f, i) => (
                  <span key={i} className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Details */}
        <div className="space-y-4">
          {rec.preferred_supplier_if_resolved && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Preferred Supplier</p>
              <p className="text-sm text-gray-800 font-medium">{rec.preferred_supplier_if_resolved}</p>
              {rec.preferred_supplier_rationale && (
                <p className="text-sm text-gray-600 mt-1">{rec.preferred_supplier_rationale}</p>
              )}
            </div>
          )}
          {rec.minimum_budget_required != null && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Minimum Budget Required</p>
              <p className="text-sm text-gray-800 font-medium">
                {Number(rec.minimum_budget_required).toLocaleString()} {rec.minimum_budget_currency || "EUR"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Approval Routing */}
      {routing && routing.steps.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Approval Routing</h4>
          <div className="flex flex-wrap gap-3">
            {routing.steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border ${
                  step.status === "approved"
                    ? "bg-green-50 border-green-200"
                    : step.status === "rejected"
                    ? "bg-red-50 border-red-200"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${
                  step.status === "approved" ? "bg-green-500" :
                  step.status === "rejected" ? "bg-red-500" :
                  step.status === "skipped" ? "bg-gray-400" : "bg-amber-500"
                }`} />
                <span className="text-sm font-medium text-gray-700">{step.role}</span>
                <span className="text-xs text-gray-400">({step.status})</span>
                {i < routing.steps.length - 1 && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Supplier Comparison
// ---------------------------------------------------------------------------
function SupplierTab({ analysis }: { analysis: AnalysisResponse }) {
  const suppliers = analysis.supplier_shortlist;
  const excluded = analysis.suppliers_excluded;

  if (suppliers.length === 0) {
    return <p className="text-gray-500 text-sm">No suppliers in shortlist.</p>;
  }

  // Radar chart data for recharts
  const radarKeys = ["quality_score", "risk_score", "esg_score"] as const;

  return (
    <div className="space-y-6">
      {/* Supplier ranking table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Rank</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Unit Price</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Total Price</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Lead Time</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Quality</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Risk</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">ESG</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Score</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Compliant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {suppliers.map((s) => (
              <tr key={s.supplier_id} className={`hover:bg-gray-50/50 ${s.rank === 1 ? "bg-green-50/30" : ""}`}>
                <td className="px-3 py-3">
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                    s.rank === 1 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {s.rank}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <p className="text-sm font-medium text-gray-900">{s.supplier_name}</p>
                  <p className="text-xs text-gray-400 font-mono">{s.supplier_id}</p>
                  {s.recommendation_note && (
                    <p className="text-xs text-gray-500 mt-0.5">{s.recommendation_note}</p>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex gap-1">
                    {s.preferred && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">Preferred</span>}
                    {s.incumbent && <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 text-xs rounded font-medium">Incumbent</span>}
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-sm text-gray-700 font-mono">
                  {s.unit_price_eur != null ? `${s.unit_price_eur.toLocaleString()} ${s.currency || "EUR"}` : "-"}
                </td>
                <td className="px-3 py-3 text-right text-sm text-gray-700 font-mono">
                  {s.total_price_eur != null ? `${s.total_price_eur.toLocaleString()} ${s.currency || "EUR"}` : "-"}
                </td>
                <td className="px-3 py-3 text-right text-sm text-gray-700">
                  {s.standard_lead_time_days != null ? `${s.standard_lead_time_days}d` : "-"}
                  {s.expedited_lead_time_days != null && (
                    <span className="text-xs text-gray-400 ml-1">(exp: {s.expedited_lead_time_days}d)</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <ScoreBadge score={s.quality_score} />
                </td>
                <td className="px-3 py-3 text-center">
                  <ScoreBadge score={s.risk_score} invert />
                </td>
                <td className="px-3 py-3 text-center">
                  <ScoreBadge score={s.esg_score} />
                </td>
                <td className="px-3 py-3 text-center">
                  {s.composite_score != null ? (
                    <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-indigo-50 text-indigo-700">
                      {Math.round(s.composite_score)}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {s.policy_compliant != null ? (
                    s.policy_compliant ? (
                      <span className="text-green-600 text-sm font-medium">Yes</span>
                    ) : (
                      <span className="text-red-600 text-sm font-medium">No</span>
                    )
                  ) : (
                    <span className="text-gray-400 text-sm">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Simple visual score comparison */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Score Comparison</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {radarKeys.map((key) => (
            <div key={key} className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-3">
                {key.replace(/_/g, " ")}
              </p>
              <div className="space-y-2">
                {suppliers.map((s) => {
                  const val = s[key] as number | undefined;
                  const pct = val != null ? Math.min(Math.round(val), 100) : 0;
                  return (
                    <div key={s.supplier_id} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-28 truncate">{s.supplier_name}</span>
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            key === "risk_score" ? "bg-red-400" : "bg-indigo-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-10 text-right">
                        {val != null ? Math.round(val) : "-"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Excluded suppliers */}
      {excluded.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Excluded Suppliers</h4>
          <div className="space-y-2">
            {excluded.map((s) => (
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

function ScoreBadge({ score, invert }: { score?: number | null; invert?: boolean }) {
  if (score == null) return <span className="text-gray-400 text-sm">-</span>;
  // Scores are 0-100 integers from the backend
  const val = Math.round(score);
  let color = "text-green-700 bg-green-50";
  if (invert) {
    if (val > 60) color = "text-red-700 bg-red-50";
    else if (val > 30) color = "text-amber-700 bg-amber-50";
  } else {
    if (val < 50) color = "text-red-700 bg-red-50";
    else if (val < 75) color = "text-amber-700 bg-amber-50";
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {val}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Agent Opinions
// ---------------------------------------------------------------------------
function AgentsTab({ analysis }: { analysis: AnalysisResponse }) {
  const agents = analysis.agent_opinions;

  if (agents.length === 0) {
    return <p className="text-gray-500 text-sm">No agent opinions available.</p>;
  }

  const agentColors: Record<string, { border: string; bg: string; icon: string }> = {
    historical: { border: "border-blue-200", bg: "bg-blue-50", icon: "text-blue-600" },
    risk:       { border: "border-red-200",  bg: "bg-red-50",  icon: "text-red-600" },
    value:      { border: "border-green-200", bg: "bg-green-50", icon: "text-green-600" },
    strategic:  { border: "border-purple-200", bg: "bg-purple-50", icon: "text-purple-600" },
  };

  function getAgentStyle(name: string) {
    const lower = name.toLowerCase();
    for (const [key, val] of Object.entries(agentColors)) {
      if (lower.includes(key)) return val;
    }
    return { border: "border-gray-200", bg: "bg-gray-50", icon: "text-gray-600" };
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {agents.map((agent) => {
        const style = getAgentStyle(agent.agent_name);
        return (
          <div key={agent.agent_name} className={`rounded-xl border ${style.border} overflow-hidden`}>
            {/* Agent header */}
            <div className={`px-5 py-3 ${style.bg} flex items-center justify-between`}>
              <h4 className="text-sm font-bold text-gray-800">{agent.agent_name}</h4>
              {agent.confidence != null && (
                <span className="text-xs font-medium text-gray-600">
                  Confidence: {Math.round(agent.confidence * 100)}%
                </span>
              )}
            </div>

            <div className="p-5 space-y-3">
              {/* Opinion */}
              <p className="text-sm text-gray-700">{agent.opinion_summary}</p>

              {/* Key factors */}
              {agent.key_factors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {agent.key_factors.map((f, i) => (
                    <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                      {f}
                    </span>
                  ))}
                </div>
              )}

              {/* Supplier rankings */}
              {agent.supplier_rankings.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Rankings</p>
                  {agent.supplier_rankings.map((sr) => (
                    <div key={sr.supplier_id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{sr.supplier_name}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${Math.min(Math.round(sr.score), 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 w-10 text-right font-mono">
                          {Math.round(sr.score)}
                        </span>
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
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Policy & Validation
// ---------------------------------------------------------------------------
function PolicyTab({ analysis }: { analysis: AnalysisResponse }) {
  const validation = analysis.validation;
  const policy = analysis.policy_evaluation;

  return (
    <div className="space-y-6">
      {/* Validation */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Validation</h4>
        {validation ? (
          <>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-3 ${
              validation.completeness === "pass"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                validation.completeness === "pass" ? "bg-green-500" : "bg-red-500"
              }`} />
              Completeness: {validation.completeness}
            </div>

            {validation.issues_detected.length > 0 ? (
              <div className="space-y-2">
                {validation.issues_detected.map((issue) => (
                  <div
                    key={issue.issue_id}
                    className={`p-4 rounded-lg border ${SEVERITY_COLORS[issue.severity] || "bg-gray-50 text-gray-800 border-gray-200"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold uppercase">{issue.severity}</span>
                      <span className="text-xs opacity-60 font-mono">{issue.issue_id}</span>
                    </div>
                    <p className="text-sm font-medium">{issue.description}</p>
                    {issue.action_required && (
                      <p className="text-xs mt-1 opacity-75">Action: {issue.action_required}</p>
                    )}
                    <span className="text-xs mt-1 inline-block opacity-60">Type: {issue.type}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No validation issues detected.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500">No validation data available.</p>
        )}
      </div>

      {/* Policy */}
      {policy && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Policy Evaluation</h4>
          <div className="space-y-4">
            {/* Approval Threshold */}
            {policy.approval_threshold && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">
                  Approval Threshold
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {policy.approval_threshold.rule_applied && (
                    <div><span className="text-gray-400">Rule:</span> <span className="text-gray-700">{policy.approval_threshold.rule_applied}</span></div>
                  )}
                  {policy.approval_threshold.basis && (
                    <div><span className="text-gray-400">Basis:</span> <span className="text-gray-700">{policy.approval_threshold.basis}</span></div>
                  )}
                  {policy.approval_threshold.quotes_required != null && (
                    <div><span className="text-gray-400">Quotes required:</span> <span className="text-gray-700">{policy.approval_threshold.quotes_required}</span></div>
                  )}
                  {policy.approval_threshold.approvers.length > 0 && (
                    <div className="col-span-2">
                      <span className="text-gray-400">Approvers:</span>{" "}
                      {policy.approval_threshold.approvers.map((a, i) => (
                        <span key={i} className="inline-flex mr-1 px-2 py-0.5 bg-white border border-gray-200 rounded text-xs text-gray-700">
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  {policy.approval_threshold.note && (
                    <div className="col-span-2"><span className="text-gray-400">Note:</span> <span className="text-gray-600">{policy.approval_threshold.note}</span></div>
                  )}
                </div>
              </div>
            )}

            {/* Preferred Supplier */}
            {policy.preferred_supplier && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">
                  Preferred Supplier Evaluation
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {policy.preferred_supplier.supplier && (
                    <div><span className="text-gray-400">Supplier:</span> <span className="text-gray-700 font-medium">{policy.preferred_supplier.supplier}</span></div>
                  )}
                  {policy.preferred_supplier.status && (
                    <div><span className="text-gray-400">Status:</span> <span className="text-gray-700">{policy.preferred_supplier.status}</span></div>
                  )}
                  {policy.preferred_supplier.is_preferred != null && (
                    <div><span className="text-gray-400">Is Preferred:</span> <span className={policy.preferred_supplier.is_preferred ? "text-green-600" : "text-red-600"}>{policy.preferred_supplier.is_preferred ? "Yes" : "No"}</span></div>
                  )}
                  {policy.preferred_supplier.policy_note && (
                    <div className="col-span-2"><span className="text-gray-400">Note:</span> <span className="text-gray-600">{policy.preferred_supplier.policy_note}</span></div>
                  )}
                </div>
              </div>
            )}

            {/* Restricted Suppliers */}
            {Object.keys(policy.restricted_suppliers).length > 0 && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">
                  Restricted Suppliers
                </p>
                <div className="space-y-2">
                  {Object.entries(policy.restricted_suppliers).map(([name, info]) => (
                    <div key={name} className={`flex items-center gap-2 text-sm ${info.restricted ? "text-red-700" : "text-gray-600"}`}>
                      <span className={`w-2 h-2 rounded-full ${info.restricted ? "bg-red-500" : "bg-green-500"}`} />
                      <span className="font-medium">{name}</span>
                      {info.note && <span className="text-gray-400">- {info.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rules applied */}
            {(policy.category_rules_applied.length > 0 || policy.geography_rules_applied.length > 0) && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Rules Applied</p>
                <div className="space-y-1.5 text-sm">
                  {policy.category_rules_applied.map((r, i) => (
                    <div key={`cat-${i}`} className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">Category</span>
                      <span className="text-gray-700">{typeof r === "string" ? r : JSON.stringify(r)}</span>
                    </div>
                  ))}
                  {policy.geography_rules_applied.map((r, i) => (
                    <div key={`geo-${i}`} className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 bg-green-50 text-green-700 text-xs rounded font-medium">Geography</span>
                      <span className="text-gray-700">{typeof r === "string" ? r : JSON.stringify(r)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5: Escalation
// ---------------------------------------------------------------------------
function EscalationTab({ analysis }: { analysis: AnalysisResponse }) {
  const escalations = analysis.escalations;

  if (escalations.length === 0) {
    return (
      <div className="flex flex-col items-center py-12">
        <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-gray-600 font-medium">No escalations required</p>
        <p className="text-gray-400 text-sm mt-1">All checks passed without issues</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {escalations.map((esc) => (
        <div
          key={esc.escalation_id}
          className={`p-5 rounded-xl border ${
            esc.blocking
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={esc.blocking ? "#ef4444" : "#f59e0b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className={`text-sm font-bold ${esc.blocking ? "text-red-800" : "text-amber-800"}`}>
                {esc.blocking ? "BLOCKING" : "WARNING"}
              </span>
            </div>
            <span className="text-xs font-mono text-gray-400">{esc.escalation_id}</span>
          </div>
          {esc.rule && <p className="text-sm text-gray-700 mb-1"><span className="font-medium">Rule:</span> {esc.rule}</p>}
          {esc.trigger && <p className="text-sm text-gray-700 mb-1"><span className="font-medium">Trigger:</span> {esc.trigger}</p>}
          {esc.escalate_to && <p className="text-sm text-gray-700"><span className="font-medium">Escalate to:</span> {esc.escalate_to}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6: Audit Trail
// ---------------------------------------------------------------------------
function AuditTab({ analysis }: { analysis: AnalysisResponse }) {
  const audit = analysis.audit_trail;
  const weights = analysis.dynamic_weights;

  return (
    <div className="space-y-6">
      {/* Processing info */}
      {analysis.processed_at && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Processed At</p>
          <p className="text-sm text-gray-700 font-mono">{analysis.processed_at}</p>
        </div>
      )}

      {audit ? (
        <>
          {/* Policies checked */}
          {audit.policies_checked.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Policies Checked</h4>
              <div className="flex flex-wrap gap-1.5">
                {audit.policies_checked.map((p, i) => (
                  <span key={i} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Supplier IDs evaluated */}
          {audit.supplier_ids_evaluated.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Suppliers Evaluated</h4>
              <div className="flex flex-wrap gap-1.5">
                {audit.supplier_ids_evaluated.map((s, i) => (
                  <span key={i} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-mono">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Data sources */}
          {audit.data_sources_used.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Data Sources Used</h4>
              <div className="flex flex-wrap gap-1.5">
                {audit.data_sources_used.map((d, i) => (
                  <span key={i} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pricing tiers */}
          {audit.pricing_tiers_applied && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Pricing Tiers Applied</p>
              <p className="text-sm text-gray-700">{audit.pricing_tiers_applied}</p>
            </div>
          )}

          {/* Historical */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Historical Awards</p>
            <p className="text-sm text-gray-700">
              {audit.historical_awards_consulted ? "Consulted" : "Not consulted"}
            </p>
            {audit.historical_award_note && (
              <p className="text-sm text-gray-500 mt-1">{audit.historical_award_note}</p>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500">No audit trail data available.</p>
      )}

      {/* Dynamic Weights */}
      {weights && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Dynamic Weight Adjustments</h4>

          {/* Base vs Adjusted */}
          {Object.keys(weights.adjusted_weights).length > 0 && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Weight</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Base</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Adjusted</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {Object.entries(weights.adjusted_weights).map(([key, val]) => {
                    const base = weights.base_weights[key] || 0;
                    const delta = val - base;
                    return (
                      <tr key={key}>
                        <td className="px-3 py-2 text-sm text-gray-700 font-medium">{key.replace(/_/g, " ")}</td>
                        <td className="px-3 py-2 text-sm text-gray-500 text-right font-mono">{base.toFixed(2)}</td>
                        <td className="px-3 py-2 text-sm text-gray-700 text-right font-mono font-medium">{val.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-sm text-right font-mono ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : "text-gray-400"}`}>
                          {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Adjustment reasons */}
          {weights.adjustments.length > 0 && (
            <div className="space-y-2">
              {weights.adjustments.map((adj, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-lg text-sm">
                  <span className="font-medium text-gray-700">{adj.weight_name}:</span>{" "}
                  <span className="text-gray-500">
                    {adj.old_value.toFixed(2)} &rarr; {adj.new_value.toFixed(2)}
                  </span>{" "}
                  <span className="text-gray-400">&mdash; {adj.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
