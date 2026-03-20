"use client";

import { useState, useEffect } from "react";
import { fetchWhitespace, researchWhitespace } from "@/lib/api";
import type { WhitespaceEntry } from "@/lib/types";

export default function WhitespacePage() {
  const [entries, setEntries] = useState<WhitespaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [researching, setResearching] = useState<string | null>(null);

  useEffect(() => {
    fetchWhitespace()
      .then((data) => setEntries(data.entries))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleResearch = async (entryId: string) => {
    setResearching(entryId);
    try {
      const updated = await researchWhitespace(entryId);
      setEntries((prev) =>
        prev.map((e) => (e.entry_id === entryId ? updated : e))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Research failed");
    } finally {
      setResearching(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" />
          <span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" />
          <span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Whitespace Categories</h1>
        <p className="text-sm text-gray-500 mt-1">
          Unmatched procurement categories — demand that could not be routed to existing suppliers.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p className="text-gray-500">No whitespace categories detected yet.</p>
          <p className="text-gray-400 text-sm mt-1">Submit procurement requests that don&apos;t match existing categories to see them here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.entry_id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div
                className="p-5 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(expandedId === entry.entry_id ? null : entry.entry_id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 text-orange-700 text-sm font-bold">
                      {entry.frequency_count}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{entry.inferred_category_label}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        {entry.countries.length > 0 && (
                          <span className="text-xs text-gray-500">{entry.countries.join(", ")}</span>
                        )}
                        {entry.estimated_budget_range && (
                          <span className="text-xs text-gray-400">Budget: {entry.estimated_budget_range}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      entry.research_status === "completed"
                        ? "bg-green-100 text-green-700"
                        : entry.research_status === "in_progress"
                        ? "bg-blue-100 text-blue-700"
                        : entry.research_status === "failed"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {entry.research_status}
                    </span>
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
                      className={`transition-transform ${expandedId === entry.entry_id ? "rotate-180" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>
              </div>

              {expandedId === entry.entry_id && (
                <div className="border-t border-gray-100 p-5 bg-gray-50/50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">First Seen</p>
                      <p className="text-gray-700 mt-0.5">{new Date(entry.first_seen).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Last Seen</p>
                      <p className="text-gray-700 mt-0.5">{new Date(entry.last_seen).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Requests</p>
                      <p className="text-gray-700 mt-0.5">{entry.request_ids.length > 0 ? entry.request_ids.join(", ") : "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Countries</p>
                      <p className="text-gray-700 mt-0.5">{entry.countries.length > 0 ? entry.countries.join(", ") : "—"}</p>
                    </div>
                  </div>

                  {entry.research_status !== "completed" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleResearch(entry.entry_id); }}
                      disabled={researching === entry.entry_id}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-ciq-red text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 mb-4"
                    >
                      {researching === entry.entry_id ? (
                        <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Researching...</>
                      ) : (
                        <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>Research Suppliers</>
                      )}
                    </button>
                  )}

                  {/* Pros and Cons Market Analysis */}
                  <div className="mb-4">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Market Analysis: Should ChainIQ Invest?</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-xs font-bold text-green-700 uppercase mb-2">Pros</p>
                        <ul className="space-y-1.5 text-sm text-green-800">
                          <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                            {entry.frequency_count >= 3 ? "High demand signal" : "Emerging demand"} — {entry.frequency_count} request{entry.frequency_count !== 1 ? "s" : ""} detected across {entry.countries.length || 1} market{entry.countries.length !== 1 ? "s" : ""}
                          </li>
                          <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                            First-mover advantage in an underserved procurement category with no current supplier coverage
                          </li>
                          {entry.estimated_budget_range && (
                            <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                              Viable budget range ({entry.estimated_budget_range}) suggests willingness to pay for quality providers
                            </li>
                          )}
                          <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                            {entry.discovered_suppliers.length > 0 ? `${entry.discovered_suppliers.length} potential suppliers already identified — partner network expansion feasible` : "Growing category with potential for supplier partnerships"}
                          </li>
                        </ul>
                      </div>
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-xs font-bold text-red-700 uppercase mb-2">Cons</p>
                        <ul className="space-y-1.5 text-sm text-red-800">
                          <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                            No existing supplier relationships — requires full vendor qualification and onboarding
                          </li>
                          <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                            {entry.countries.length > 2 ? "Multi-country demand increases compliance and logistics complexity" : "Limited geographic signal — may not scale beyond current markets"}
                          </li>
                          <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                            Category taxonomy gap means no historical pricing benchmarks or award data for negotiation leverage
                          </li>
                          {entry.frequency_count < 5 && (
                            <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                              Demand volume still low — ROI may not justify investment until volume reaches critical mass
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="text-xs font-bold text-ciq-darkgrey uppercase mb-1">Recommendation</p>
                      <p className="text-sm text-ciq-black">
                        {entry.frequency_count >= 5 && entry.discovered_suppliers.length > 0
                          ? `Strong investment case. With ${entry.frequency_count} requests and ${entry.discovered_suppliers.length} identified suppliers, this vertical shows viable market demand. Recommend initiating supplier qualification.`
                          : entry.frequency_count >= 3
                          ? `Monitor and prepare. Demand is building (${entry.frequency_count} requests) but not yet at scale. Continue tracking and begin preliminary supplier outreach.`
                          : `Watch list. Current demand (${entry.frequency_count} request${entry.frequency_count !== 1 ? "s" : ""}) is insufficient to justify investment. Revisit when demand reaches 5+ requests.`
                        }
                      </p>
                    </div>
                  </div>

                  {entry.discovered_suppliers.length > 0 && (
                    <div>
                      {/* Opportunity Summary */}
                      <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                        <p className="text-sm font-medium text-indigo-800">
                          Requests for <span className="font-bold">{entry.inferred_category_label}</span>
                          {entry.countries.length > 0 && <> in <span className="font-bold">{entry.countries.join(", ")}</span></>}
                          {" "}&mdash; {entry.frequency_count} request{entry.frequency_count !== 1 ? "s" : ""}
                          {entry.estimated_budget_range && <>, budget range <span className="font-bold">{entry.estimated_budget_range}</span></>}
                        </p>
                      </div>

                      {/* Vendor Comparison Table */}
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">Vendor Comparison</p>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Vendor</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Coverage</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Strengths</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Website</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {entry.discovered_suppliers.map((sup, i) => (
                              <tr key={i} className="hover:bg-white/60 transition-colors">
                                <td className="px-3 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">{sup.name}</td>
                                <td className="px-3 py-3 text-xs text-gray-600">{sup.coverage || "-"}</td>
                                <td className="px-3 py-3 text-xs text-green-700">{sup.strengths || "-"}</td>
                                <td className="px-3 py-3 text-xs text-gray-600 max-w-xs">{sup.description}</td>
                                <td className="px-3 py-3 text-xs text-indigo-600 truncate max-w-[180px]">{sup.website || "-"}</td>
                                <td className="px-3 py-3 text-right">
                                  {sup.website ? (
                                    <a
                                      href={sup.website.startsWith("http") ? sup.website : `https://${sup.website}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                                    >
                                      Contact
                                    </a>
                                  ) : (
                                    <span className="text-xs text-gray-400">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
