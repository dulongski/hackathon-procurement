"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchHistoricalAwards } from "@/lib/api";
import type { PaginatedHistoricalAwards } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

export default function HistoricalPage() {
  const router = useRouter();
  const [data, setData] = useState<PaginatedHistoricalAwards | null>(null);
  const [filterOptions, setFilterOptions] = useState<{ categories: string[]; countries: string[] }>({ categories: [], countries: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterCategory, setFilterCategory] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    fetch(`${API_BASE}/historical/filters`)
      .then(r => r.json())
      .then(setFilterOptions)
      .catch(() => {});
  }, []);

  const loadAwards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHistoricalAwards({
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
  }, [filterCategory, filterCountry, page]);

  useEffect(() => { loadAwards(); }, [loadAwards]);
  useEffect(() => { setPage(1); }, [filterCategory, filterCountry]);

  const categories = filterOptions.categories;
  const countries = filterOptions.countries;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Historical Awards</h1>
        <p className="text-gray-500 mt-1">Past procurement decisions for analysis</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-ciq-red"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-ciq-red"
        >
          <option value="">All Countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {(filterCategory || filterCountry) && (
          <button
            onClick={() => { setFilterCategory(""); setFilterCountry(""); }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-ciq-red loading-dot" />
              <span className="w-2.5 h-2.5 rounded-full bg-ciq-red loading-dot" />
              <span className="w-2.5 h-2.5 rounded-full bg-ciq-red loading-dot" />
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-red-500">
            <p className="text-sm font-medium">{error}</p>
            <button onClick={loadAwards} className="mt-2 text-sm text-ciq-red hover:underline">Retry</button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Award ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Request</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Country</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Value</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data?.awards.map((award) => (
                    <tr key={award.award_id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-gray-600 whitespace-nowrap">{award.award_id}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">
                        <span className="font-mono text-gray-500 text-xs">{award.request_id}</span>
                        {award.request_title && <span className="ml-2 text-gray-700">{award.request_title}</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{award.supplier_name || award.supplier_id}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {award.category_l1 || "-"}
                        {award.category_l2 && <span className="text-gray-400"> / {award.category_l2}</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{(award as Record<string, unknown>).country as string || award.delivery_country || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {(award as Record<string, unknown>).total_value != null
                          ? `${Number((award as Record<string, unknown>).total_value).toLocaleString()} ${(award as Record<string, unknown>).currency || "EUR"}`
                          : award.award_value != null ? `${Number(award.award_value).toLocaleString()} EUR` : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {award.award_date ? new Date(award.award_date).toLocaleDateString() : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => router.push(`/request/${award.request_id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                          </svg>
                          AI Analysis
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
                  Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, data?.total || 0)} of {data?.total || 0}
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
                    let pageNum: number;
                    if (totalPages <= 5) pageNum = i + 1;
                    else if (page <= 3) pageNum = i + 1;
                    else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = page - 2 + i;
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`px-3 py-1.5 text-sm rounded-lg ${
                          page === pageNum
                            ? "bg-ciq-red text-white"
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
