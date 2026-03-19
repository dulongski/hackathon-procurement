"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchRequests, fetchStats, analyzeCustom } from "@/lib/api";
import type { ProcurementRequest, StatsResponse, PaginatedRequests } from "@/lib/types";

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------
const TAG_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  standard:      { bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500" },
  missing_info:  { bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-500" },
  contradictory: { bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500" },
  threshold:     { bg: "bg-purple-50",  text: "text-purple-700",  dot: "bg-purple-500" },
  restricted:    { bg: "bg-orange-50",  text: "text-orange-700",  dot: "bg-orange-500" },
  lead_time:     { bg: "bg-yellow-50",  text: "text-yellow-700",  dot: "bg-yellow-500" },
  multilingual:  { bg: "bg-teal-50",    text: "text-teal-700",    dot: "bg-teal-500" },
  capacity:      { bg: "bg-indigo-50",  text: "text-indigo-700",  dot: "bg-indigo-500" },
  multi_country: { bg: "bg-pink-50",    text: "text-pink-700",    dot: "bg-pink-500" },
};

function getTagColor(tag: string) {
  return TAG_COLORS[tag] || { bg: "bg-gray-50", text: "text-gray-700", dot: "bg-gray-500" };
}

const STAT_BADGE_COLORS: Record<string, string> = {
  standard:      "bg-blue-500",
  missing_info:  "bg-amber-500",
  contradictory: "bg-red-500",
  threshold:     "bg-purple-500",
  restricted:    "bg-orange-500",
  lead_time:     "bg-yellow-500",
  multilingual:  "bg-teal-500",
  capacity:      "bg-indigo-500",
  multi_country: "bg-pink-500",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const router = useRouter();

  // Data states
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [data, setData] = useState<PaginatedRequests | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterTag, setFilterTag] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Custom request panel
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [customCountry, setCustomCountry] = useState("");
  const [customBudget, setCustomBudget] = useState("");
  const [customQuantity, setCustomQuantity] = useState("");
  const [customSubmitting, setCustomSubmitting] = useState(false);

  // Load stats
  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
  }, []);

  // Load requests
  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRequests({
        scenario_tag: filterTag || undefined,
        category_l1: filterCategory || undefined,
        country: filterCountry || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filterTag, filterCategory, filterCountry, page]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [filterTag, filterCategory, filterCountry]);

  // Unique values for filter dropdowns
  const categories = stats ? Object.keys(stats.by_category).sort() : [];
  const countries = stats ? Object.keys(stats.by_country).sort() : [];
  const scenarioTags = stats ? Object.keys(stats.by_scenario_tag).sort() : [];

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  // Handle custom request submission
  const handleCustomSubmit = async () => {
    if (!customText.trim()) return;
    setCustomSubmitting(true);
    try {
      const result = await analyzeCustom({
        request_text: customText,
        category_l1: customCategory || undefined,
        country: customCountry || undefined,
        budget_amount: customBudget ? parseFloat(customBudget) : undefined,
        quantity: customQuantity ? parseFloat(customQuantity) : undefined,
      });
      // Cache analysis result for the request page to pick up
      sessionStorage.setItem(`analysis_${result.request_id}`, JSON.stringify(result));
      router.push(`/request/${result.request_id}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setCustomSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Procurement Dashboard</h1>
        <p className="text-gray-500 mt-1">Manage and analyze procurement sourcing requests</p>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="mb-6 animate-fade-in">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                Scenario Tags
              </h2>
              <span className="text-sm text-gray-500">
                {stats.total_requests} total requests
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.by_scenario_tag)
                .sort((a, b) => b[1] - a[1])
                .map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => setFilterTag(filterTag === tag ? "" : tag)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      filterTag === tag
                        ? "ring-2 ring-offset-1 ring-blue-500 shadow-sm"
                        : "hover:shadow-sm"
                    }`}
                    style={{
                      backgroundColor: filterTag === tag ? undefined : undefined,
                    }}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${STAT_BADGE_COLORS[tag] || "bg-gray-500"}`}
                    />
                    <span className="text-gray-700">{tag.replace(/_/g, " ")}</span>
                    <span className="text-gray-400 text-xs">({count})</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Custom Request Panel */}
      <div className="mb-6">
        <button
          onClick={() => setShowCustom(!showCustom)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {showCustom ? "Hide Custom Request" : "Submit Custom Request"}
        </button>

        {showCustom && (
          <div className="mt-3 bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-fade-in">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Describe your procurement request</h3>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="e.g. We need 500 units of industrial safety gloves for our Berlin warehouse, budget around 15,000 EUR..."
              className="w-full h-28 px-4 py-3 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Category (e.g. IT)"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={customCountry}
                onChange={(e) => setCustomCountry(e.target.value)}
                placeholder="Country (e.g. DE)"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={customBudget}
                onChange={(e) => setCustomBudget(e.target.value)}
                placeholder="Budget (EUR)"
                type="number"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={customQuantity}
                onChange={(e) => setCustomQuantity(e.target.value)}
                placeholder="Quantity"
                type="number"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleCustomSubmit}
                disabled={!customText.trim() || customSubmitting}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {customSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  "Analyze Request"
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Scenarios</option>
          {scenarioTags.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {(filterTag || filterCategory || filterCountry) && (
          <button
            onClick={() => {
              setFilterTag("");
              setFilterCategory("");
              setFilterCountry("");
            }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Request Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 loading-dot" />
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 loading-dot" />
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 loading-dot" />
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-red-500">
            <p className="text-sm font-medium">{error}</p>
            <button onClick={loadRequests} className="mt-2 text-sm text-indigo-600 hover:underline">
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Country</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Budget</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Scenario Tags</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data?.requests.map((req) => (
                    <tr
                      key={req.request_id}
                      className="hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-mono text-gray-600 whitespace-nowrap">
                        {req.request_id}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">
                        {req.title || "Untitled"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        <span>{req.category_l1}</span>
                        {req.category_l2 && (
                          <span className="text-gray-400"> / {req.category_l2}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{req.country || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {req.budget_amount != null
                          ? `${Number(req.budget_amount).toLocaleString()} ${req.currency || "EUR"}`
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(req.scenario_tags || []).map((tag) => {
                            const colors = getTagColor(tag);
                            return (
                              <span
                                key={tag}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                                {tag.replace(/_/g, " ")}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => router.push(`/request/${req.request_id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                          </svg>
                          Analyze
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <p className="text-sm text-gray-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, data?.total || 0)} of{" "}
                  {data?.total || 0}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    // Show pages around current page
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (page <= 3) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`px-3 py-1.5 text-sm rounded-lg ${
                          page === pageNum
                            ? "bg-indigo-600 text-white"
                            : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
