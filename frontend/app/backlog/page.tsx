"use client";

import { useState, useEffect } from "react";

interface BacklogStep {
  id: string;
  label: string;
  detail: string;
  status: string;
  created_at: string;
}

interface BacklogEntry {
  request_id: string;
  title: string;
  category_l1?: string;
  country?: string;
  budget_amount?: number;
  currency?: string;
  request_text?: string;
  recommendation_status?: string;
  next_steps: BacklogStep[];
  created_at: string;
}

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  "Awaiting response":       { bg: "bg-amber-100", text: "text-amber-700" },
  "RFP draft pending":       { bg: "bg-blue-100",  text: "text-blue-700" },
  "Waiting for supplier reply": { bg: "bg-blue-100", text: "text-blue-700" },
  "In progress":             { bg: "bg-amber-100", text: "text-amber-700" },
  "Completed":               { bg: "bg-green-100", text: "text-green-700" },
};

function getStatusBadge(status: string) {
  return STATUS_BADGE[status] || { bg: "bg-gray-100", text: "text-gray-600" };
}

function generateFollowThroughActions(entry: BacklogEntry): string[] {
  const actions: string[] = [];
  const pendingSteps = entry.next_steps.filter(s => s.status !== "Completed");

  for (const step of pendingSteps) {
    if (step.id.startsWith("esc")) {
      actions.push(`Follow up with ${step.label.replace("Notify ", "")} — send a reminder email requesting response by EOD`);
    } else if (step.id === "rfp") {
      actions.push("Finalize RFP document and distribute to shortlisted suppliers with a 5-business-day response window");
    } else if (step.id === "budget") {
      actions.push("Escalate budget approval request to CFO if Finance has not responded within 48 hours");
    } else if (step.id === "supplier-contact") {
      actions.push(`Send follow-up to supplier requesting updated pricing and delivery timeline confirmation`);
    } else if (step.id === "email-proc") {
      actions.push("Schedule 15-min sync with Head of Procurement to align on sourcing strategy");
    } else if (step.id === "compliance") {
      actions.push("Book compliance review slot in the next governance meeting agenda");
    }
  }

  if (pendingSteps.length === 0) {
    actions.push("All actions completed — ready to finalize procurement decision");
  }

  return actions;
}

// Simulate status progression details
function getStepStatusDetail(step: BacklogStep): string {
  if (step.id.startsWith("esc")) return `Awaiting response from ${step.label.replace("Notify ", "")}`;
  if (step.id === "rfp") return "RFP document being drafted — expected distribution in 2 business days";
  if (step.id === "budget") return "Budget amendment submitted to Finance, pending approval";
  if (step.id === "supplier-contact") {
    const supplier = step.label.replace("Contact ", "");
    return `Waiting for reply from ${supplier}, expected by: ${new Date(Date.now() + 3 * 86400000).toLocaleDateString()}`;
  }
  if (step.id === "email-proc") return "Summary email sent to Head of Procurement";
  if (step.id === "compliance") return "Compliance review scheduled for next governance cycle";
  return step.status;
}

export default function BacklogPage() {
  const [entries, setEntries] = useState<BacklogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [followThroughId, setFollowThroughId] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("backlog_items");
    if (stored) {
      try {
        setEntries(JSON.parse(stored));
      } catch { /* ignore */ }
    }
  }, []);

  const recStatusColor = (status?: string) => {
    if (!status) return { bg: "bg-gray-100", text: "text-gray-600" };
    if (status.includes("cannot")) return { bg: "bg-red-100", text: "text-red-700" };
    if (status.includes("condition")) return { bg: "bg-amber-100", text: "text-amber-700" };
    return { bg: "bg-green-100", text: "text-green-700" };
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ciq-black">Backlog</h1>
        <p className="text-ciq-darkgrey mt-1">Open requests with active follow-up actions</p>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </div>
          <p className="text-ciq-darkgrey">No items in the backlog yet.</p>
          <p className="text-gray-400 text-sm mt-1">Submit a procurement request and click &quot;Next Steps&quot; to add items here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const isExpanded = expandedId === entry.request_id;
            const recColor = recStatusColor(entry.recommendation_status);
            const completedCount = entry.next_steps.filter(s => s.status === "Completed").length;
            const totalCount = entry.next_steps.length;

            return (
              <div key={entry.request_id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Row header */}
                <div
                  className="p-5 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : entry.request_id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <h3 className="text-sm font-semibold text-ciq-black">{entry.title}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs font-mono text-gray-400">{entry.request_id}</span>
                          {entry.category_l1 && <span className="text-xs text-ciq-darkgrey">{entry.category_l1}</span>}
                          {entry.country && <span className="text-xs text-ciq-darkgrey">&middot; {entry.country}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${recColor.bg} ${recColor.text}`}>
                        {entry.recommendation_status?.replace(/_/g, " ") || "pending"}
                      </span>
                      <span className="text-xs text-ciq-darkgrey">{completedCount}/{totalCount} steps</span>
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
                        className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-100 p-5 bg-gray-50/50 space-y-5">
                    {/* Request Summary */}
                    {entry.request_text && (
                      <div>
                        <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Request Summary</p>
                        <p className="text-sm text-ciq-darkgrey">{entry.request_text}</p>
                        {entry.budget_amount && (
                          <p className="text-xs text-ciq-darkgrey mt-1">Budget: {entry.currency || "EUR"} {entry.budget_amount.toLocaleString()}</p>
                        )}
                      </div>
                    )}

                    {/* Next Steps with statuses */}
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Action Items</p>
                      <div className="space-y-2">
                        {entry.next_steps.map((step) => {
                          const badge = getStatusBadge(step.status);
                          return (
                            <div key={step.id} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-gray-200">
                              <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${step.status === "Completed" ? "bg-green-500" : "bg-amber-400"}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-ciq-black">{step.label}</p>
                                <p className="text-xs text-ciq-darkgrey mt-0.5">{getStepStatusDetail(step)}</p>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${badge.bg} ${badge.text}`}>
                                {step.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Follow Through button */}
                    <button
                      onClick={() => setFollowThroughId(followThroughId === entry.request_id ? null : entry.request_id)}
                      className="px-5 py-2.5 bg-ciq-red text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors flex items-center gap-2"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                      Follow Through
                    </button>

                    {/* Follow Through recommendations */}
                    {followThroughId === entry.request_id && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg animate-fade-in">
                        <p className="text-xs text-red-600 uppercase tracking-wider font-medium mb-2">Recommended Actions</p>
                        <div className="space-y-2">
                          {generateFollowThroughActions(entry).map((action, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-ciq-red flex-shrink-0" />
                              <p className="text-sm text-ciq-black">{action}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
