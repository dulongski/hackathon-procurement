"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { fetchStats, fetchHistoricalAwards, fetchRequests } from "@/lib/api";
import type { ProcurementRequest } from "@/lib/types";
import type { StatsResponse, HistoricalAwardRow } from "@/lib/types";

type A = HistoricalAwardRow & Record<string, unknown>;
const v = (a: A) => (a.total_value as number) || a.award_value || 0;
const ld = (a: A) => (a.lead_time_days as number) || 0;
const sv = (a: A) => (a.savings_pct as number) || 0;
const rs = (a: A) => (a.risk_score_at_award as number) || 0;
const won = (a: A) => a.awarded === true;

export default function AnalyticsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [allAwards, setAllAwards] = useState<A[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [compareCategory, setCompareCategory] = useState("");
  const [showAudit, setShowAudit] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const auditRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetchStats(),
      fetchHistoricalAwards({ page_size: 600 }),
    ]).then(([s, a]) => {
      setStats(s);
      setAllAwards(a.awards as A[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const awards = useMemo(() => {
    let d = allAwards;
    if (filterCategory) d = d.filter(a => a.category_l1 === filterCategory);
    if (filterCountry) d = d.filter(a => (a.country as string || a.delivery_country) === filterCountry);
    if (filterSupplier) d = d.filter(a => a.supplier_name === filterSupplier);
    if (dateFrom) d = d.filter(a => (a.award_date || "") >= dateFrom);
    if (dateTo) d = d.filter(a => (a.award_date || "") <= dateTo);
    return d;
  }, [allAwards, filterCategory, filterCountry, filterSupplier, dateFrom, dateTo]);

  const compAwards = useMemo(() => {
    if (!compareCategory) return [];
    let d = allAwards.filter(a => a.category_l1 === compareCategory);
    if (filterCountry) d = d.filter(a => (a.country as string || a.delivery_country) === filterCountry);
    if (dateFrom) d = d.filter(a => (a.award_date || "") >= dateFrom);
    if (dateTo) d = d.filter(a => (a.award_date || "") <= dateTo);
    return d;
  }, [allAwards, compareCategory, filterCountry, dateFrom, dateTo]);

  const allCategories = useMemo(() => Array.from(new Set(allAwards.map(a => a.category_l1).filter(Boolean) as string[])).sort(), [allAwards]);
  const allCountries = useMemo(() => Array.from(new Set(allAwards.map(a => (a.country as string || "")).filter(Boolean))).sort(), [allAwards]);
  const allSuppliers = useMemo(() => Array.from(new Set(allAwards.map(a => a.supplier_name).filter(Boolean) as string[])).sort(), [allAwards]);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="flex gap-1.5"><span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" /><span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" /><span className="w-3 h-3 rounded-full bg-ciq-red loading-dot" /></div></div>;
  if (!stats) return <p className="p-6 text-ciq-darkgrey">Failed to load analytics data.</p>;

  // ---- Computed analytics ----
  const totalVal = awards.reduce((s, a) => s + v(a), 0);
  const wonCount = awards.filter(won).length;
  const avgSav = awards.filter(a => sv(a) > 0);
  const avgSavPct = avgSav.length ? avgSav.reduce((s, a) => s + sv(a), 0) / avgSav.length : 0;
  const avgLeadDays = awards.filter(a => ld(a) > 0);
  const avgLead = avgLeadDays.length ? avgLeadDays.reduce((s, a) => s + ld(a), 0) / avgLeadDays.length : 0;

  // Supplier concentration (HHI)
  const supVals: Record<string, number> = {};
  for (const a of awards) supVals[a.supplier_name || a.supplier_id] = (supVals[a.supplier_name || a.supplier_id] || 0) + v(a);
  const totalV2 = Object.values(supVals).reduce((s, x) => s + x, 0) || 1;
  const hhi = Object.values(supVals).reduce((s, x) => s + (x / totalV2) ** 2, 0);

  // Policy compliance rate
  const compliant = awards.filter(a => a.policy_compliant === true).length;
  const complianceRate = awards.length ? (compliant / awards.length) * 100 : 0;

  // Escalation rate
  const escalated = awards.filter(a => a.escalation_required === true).length;
  const escalationRate = awards.length ? (escalated / awards.length) * 100 : 0;

  // Monthly trend (properly)
  const monthMap: Record<string, { spend: number; count: number; savings: number }> = {};
  for (const a of awards) {
    const d = a.award_date as string;
    if (!d || d.length < 7) continue;
    const m = d.substring(0, 7);
    if (!monthMap[m]) monthMap[m] = { spend: 0, count: 0, savings: 0 };
    monthMap[m].spend += v(a);
    monthMap[m].count++;
    monthMap[m].savings += sv(a);
  }
  const months = Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0]));
  const maxMSpend = Math.max(...months.map(m => m[1].spend), 1);

  // Compare monthly
  const compMonthMap: Record<string, number> = {};
  for (const a of compAwards) {
    const d = a.award_date as string;
    if (!d || d.length < 7) continue;
    const m = d.substring(0, 7);
    compMonthMap[m] = (compMonthMap[m] || 0) + v(a);
  }
  const compMaxSpend = Math.max(...Object.values(compMonthMap), maxMSpend, 1);
  const effectiveMax = compareCategory ? compMaxSpend : maxMSpend;

  // Top suppliers
  const topSups = Object.entries(supVals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSupVal = Math.max(...topSups.map(s => s[1]), 1);

  // Risk heatmap: category × country
  const heatData: Record<string, Record<string, { risk: number; count: number }>> = {};
  for (const a of awards) {
    const cat = (a.category_l1 || "Other") as string;
    const co = (a.country as string) || "?";
    if (!heatData[cat]) heatData[cat] = {};
    if (!heatData[cat][co]) heatData[cat][co] = { risk: 0, count: 0 };
    heatData[cat][co].risk += rs(a);
    heatData[cat][co].count++;
  }
  const heatCats = Object.keys(heatData).sort();
  const heatCountries = Array.from(new Set(awards.map(a => (a.country as string) || "?"))).sort();

  // Savings by supplier
  const supSav: Record<string, { total: number; count: number; won: number }> = {};
  for (const a of awards) {
    const n = a.supplier_name || a.supplier_id;
    if (!supSav[n]) supSav[n] = { total: 0, count: 0, won: 0 };
    supSav[n].total += sv(a);
    supSav[n].count++;
    if (won(a)) supSav[n].won++;
  }
  const savRanking = Object.entries(supSav).map(([n, d]) => ({ name: n, avg: d.count ? d.total / d.count : 0, winRate: d.count ? (d.won / d.count) * 100 : 0, count: d.count }))
    .filter(s => s.avg > 0).sort((a, b) => b.avg - a.avg).slice(0, 6);

  const hasFilters = filterCategory || filterCountry || filterSupplier || dateFrom || dateTo;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Analytics Dashboard</h1>
          <p className="page-subtitle">Procurement intelligence &amp; spend analytics</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAudit(true)} className="px-4 py-2 bg-ciq-darkgrey text-white rounded-lg text-sm font-medium hover:bg-black transition-colors flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Generate Audit Report
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-5 flex flex-wrap items-center gap-2 p-3 bg-white rounded-xl border border-gray-200 shadow-sm">
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-ciq-darkgrey bg-white focus:ring-1 focus:ring-ciq-red">
          <option value="">All Categories</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-ciq-darkgrey bg-white focus:ring-1 focus:ring-ciq-red">
          <option value="">All Countries</option>
          {allCountries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-ciq-darkgrey bg-white focus:ring-1 focus:ring-ciq-red">
          <option value="">All Suppliers</option>
          {allSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-ciq-red" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-ciq-red" />
        <span className="text-gray-300">|</span>
        <select value={compareCategory} onChange={e => setCompareCategory(e.target.value)} className="px-2 py-1.5 border-2 border-blue-400 rounded-lg text-xs text-blue-700 bg-blue-50 focus:ring-1 focus:ring-blue-400">
          <option value="">Compare with...</option>
          {allCategories.filter(c => c !== filterCategory).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasFilters && <button onClick={() => { setFilterCategory(""); setFilterCountry(""); setFilterSupplier(""); setDateFrom(""); setDateTo(""); setCompareCategory(""); }} className="text-xs text-ciq-red hover:underline">Clear</button>}
      </div>

      {/* KPIs — 2 rows of 4 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <KPI label="Total Spend" value={`${(totalVal / 1e6).toFixed(1)}M`} sub="EUR" />
        <KPI label="Awards" value={awards.length.toString()} sub={`${wonCount} won · ${awards.length - wonCount} runners-up`} />
        <KPI label="Avg Savings" value={`${avgSavPct.toFixed(1)}%`} color={avgSavPct > 5 ? "text-green-600" : "text-amber-600"} />
        <KPI label="Avg Lead Time" value={`${avgLead.toFixed(0)}d`} />
        <KPI label="Compliance" value={`${complianceRate.toFixed(0)}%`} color={complianceRate > 90 ? "text-green-600" : "text-red-600"} sub={`${compliant}/${awards.length} compliant`} />
        <KPI label="Escalation Rate" value={`${escalationRate.toFixed(0)}%`} color={escalationRate > 30 ? "text-red-600" : "text-green-600"} sub={`${escalated} escalated`} />
        <KPI label="Concentration" value={hhi > 0.25 ? "HIGH" : hhi > 0.15 ? "MED" : "LOW"} color={hhi > 0.25 ? "text-red-600" : hhi > 0.15 ? "text-amber-600" : "text-green-600"} sub={`HHI ${(hhi * 100).toFixed(0)}%`} />
        <KPI label="Suppliers" value={Object.keys(supVals).length.toString()} sub="active in filtered set" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* MONTHLY TREND — bar chart with optional comparison overlay */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ciq-black">Monthly Spend Trend</h3>
            {compareCategory && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">vs {compareCategory}</span>}
          </div>
          <div className="flex items-end gap-[3px] h-44">
            {months.map(([month, d]) => {
              const compVal = compMonthMap[month] || 0;
              return (
                <div key={month} className="flex-1 flex flex-col items-center group relative">
                  <div className="w-full flex flex-col justify-end h-36">
                    {compareCategory && compVal > 0 && (
                      <div className="w-full bg-blue-400/40 rounded-t" style={{ height: `${(compVal / effectiveMax) * 100}%`, minHeight: compVal ? "3px" : 0 }} />
                    )}
                    <div className="w-full bg-ciq-red/80 rounded-t hover:bg-ciq-red transition-colors" style={{ height: `${(d.spend / effectiveMax) * 100}%`, minHeight: "3px" }} />
                  </div>
                  <span className="text-[7px] text-gray-400 mt-1 whitespace-nowrap">{month.slice(5)}</span>
                  <div className="absolute bottom-full mb-1 px-2 py-1 bg-gray-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {month}: EUR {(d.spend / 1000).toFixed(0)}k ({d.count} awards)
                    {compareCategory && compVal > 0 && <><br/>{compareCategory}: EUR {(compVal / 1000).toFixed(0)}k</>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RISK HEATMAP — category × country */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-ciq-black mb-3">Risk Heatmap: Category × Country</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-[9px] text-gray-400 text-left py-1 pr-2"></th>
                  {heatCountries.slice(0, 10).map(co => <th key={co} className="text-[9px] text-gray-400 text-center px-1 py-1">{co}</th>)}
                </tr>
              </thead>
              <tbody>
                {heatCats.map(cat => (
                  <tr key={cat}>
                    <td className="text-[9px] text-ciq-darkgrey pr-2 py-1 whitespace-nowrap max-w-[100px] truncate">{cat}</td>
                    {heatCountries.slice(0, 10).map(co => {
                      const cell = heatData[cat]?.[co];
                      if (!cell) return <td key={co} className="px-1 py-1"><div className="w-6 h-6 rounded bg-gray-50 mx-auto" /></td>;
                      const avgRisk = cell.risk / cell.count;
                      const bg = avgRisk > 30 ? "bg-red-500" : avgRisk > 20 ? "bg-amber-400" : "bg-green-400";
                      return (
                        <td key={co} className="px-1 py-1 group relative">
                          <div className={`w-6 h-6 rounded ${bg} mx-auto flex items-center justify-center`}>
                            <span className="text-[8px] text-white font-bold">{avgRisk.toFixed(0)}</span>
                          </div>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-[9px] rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                            {cat} · {co}: risk {avgRisk.toFixed(0)}, {cell.count} awards
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-400" />Low</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-400" />Medium</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500" />High</span>
          </div>
        </div>

        {/* SUPPLIER WIN RATE + SAVINGS — bubble-style */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-ciq-black mb-3">Supplier Performance: Win Rate vs Savings</h3>
          <div className="space-y-2">
            {savRanking.map(s => (
              <div key={s.name} className="flex items-center gap-3">
                <span className="text-[10px] text-ciq-darkgrey w-[130px] truncate flex-shrink-0">{s.name}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded-full relative overflow-hidden">
                  {/* Win rate bar */}
                  <div className="absolute top-0 h-full bg-ciq-red/70 rounded-full" style={{ width: `${s.winRate}%` }} />
                  {/* Savings marker */}
                  <div className="absolute top-0 h-full w-[2px] bg-green-600" style={{ left: `${Math.min(s.avg * 5, 100)}%` }} />
                </div>
                <div className="flex-shrink-0 text-right w-[80px]">
                  <span className="text-[10px] text-ciq-red font-bold">{s.winRate.toFixed(0)}%</span>
                  <span className="text-[9px] text-green-600 ml-1">{s.avg.toFixed(1)}% sav</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-ciq-red/70" />Win Rate</span>
            <span className="flex items-center gap-1"><span className="w-2 h-1 bg-green-600" />Avg Savings</span>
          </div>
        </div>

        {/* SUPPLIER MARKET SHARE — donut style */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-ciq-black mb-3">Market Share</h3>
          <div className="flex items-center gap-6">
            {/* Donut */}
            <div className="relative w-32 h-32 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                {(() => {
                  let offset = 0;
                  const colors = ["#FF0000", "#333333", "#666666", "#999999", "#BBBBBB", "#DDDDDD"];
                  return topSups.map(([, val], i) => {
                    const pct = (val / totalV2) * 100;
                    const dash = `${pct} ${100 - pct}`;
                    const el = <circle key={i} cx="18" cy="18" r="15.9155" fill="none" stroke={colors[i % colors.length]} strokeWidth="3" strokeDasharray={dash} strokeDashoffset={-offset} />;
                    offset += pct;
                    return el;
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-ciq-black">{Object.keys(supVals).length}</span>
              </div>
            </div>
            {/* Legend */}
            <div className="space-y-1.5 flex-1">
              {topSups.map(([name, val], i) => {
                const colors = ["bg-ciq-red", "bg-ciq-darkgrey", "bg-gray-500", "bg-gray-400", "bg-gray-300", "bg-gray-200"];
                return (
                  <div key={name} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${colors[i % colors.length]} flex-shrink-0`} />
                    <span className="text-[10px] text-ciq-darkgrey truncate flex-1">{name}</span>
                    <span className="text-[10px] text-ciq-black font-medium">{((val / totalV2) * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* SPEND BY COUNTRY — proportional blocks */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-ciq-black mb-3">Spend Distribution by Country</h3>
          <div className="flex flex-wrap gap-1">
            {(() => {
              const countryVals: Record<string, number> = {};
              for (const a of awards) countryVals[(a.country as string) || "?"] = (countryVals[(a.country as string) || "?"] || 0) + v(a);
              const sorted = Object.entries(countryVals).sort((a, b) => b[1] - a[1]);
              const total = sorted.reduce((s, [, val]) => s + val, 0) || 1;
              return sorted.map(([co, val], i) => {
                const pct = (val / total) * 100;
                const size = Math.max(pct * 2, 28);
                const colors = ["bg-ciq-red", "bg-red-400", "bg-red-300", "bg-ciq-darkgrey", "bg-gray-400", "bg-gray-300", "bg-gray-200"];
                return (
                  <div key={co} className={`${colors[i % colors.length]} rounded-lg flex items-center justify-center text-white group relative cursor-default`}
                    style={{ width: `${size}px`, height: `${size}px`, minWidth: "28px", minHeight: "28px" }}>
                    <span className="text-[9px] font-bold">{co}</span>
                    <div className="absolute bottom-full mb-1 px-2 py-1 bg-gray-900 text-white text-[9px] rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                      {co}: EUR {(val / 1000).toFixed(0)}k ({pct.toFixed(1)}%)
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* SCENARIO TAGS — clickable with alert flags */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-ciq-black mb-3">Request Complexity &amp; Alerts <span className="text-xs text-gray-400 font-normal ml-1">(click to view requests)</span></h3>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {Object.entries(stats.by_scenario_tag).sort((a, b) => b[1] - a[1]).map(([tag, count]) => {
              const isAlert = ["contradictory", "restricted", "missing_info"].includes(tag);
              const isSelected = selectedTag === tag;
              return (
                <button key={tag} onClick={() => setSelectedTag(isSelected ? null : tag)} className={`p-3 rounded-lg border text-center transition-all ${isSelected ? "ring-2 ring-ciq-red border-ciq-red" : isAlert ? "border-red-200 bg-red-50 hover:ring-1 hover:ring-red-300" : "border-gray-200 hover:ring-1 hover:ring-gray-300"}`}>
                  <p className={`text-lg font-bold ${isAlert ? "text-red-600" : "text-ciq-black"}`}>
                    {count}
                    {isAlert && <span className="text-xs ml-1">!</span>}
                  </p>
                  <p className="text-[9px] text-ciq-darkgrey uppercase tracking-wider mt-0.5">{tag.replace(/_/g, " ")}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tag detail view */}
        {selectedTag && (
          <TagDetailPanel tag={selectedTag} onClose={() => setSelectedTag(null)} />
        )}
      </div>

      {/* AUDIT REPORT MODAL */}
      {showAudit && (() => {
        // Pre-compute all audit data
        const nonCompliant = awards.filter(a => a.policy_compliant !== true);
        const escAwards = awards.filter(a => a.escalation_required === true);
        const prefUsed = awards.filter(a => a.preferred_supplier_used === true);
        const avgRiskScore = awards.length ? awards.reduce((s, a) => s + rs(a), 0) / awards.length : 0;
        const highRisk = awards.filter(a => rs(a) > 30);

        // Escalation breakdown by target
        const escTargets: Record<string, number> = {};
        for (const a of escAwards) { const t = (a.escalated_to as string) || "Unspecified"; if (t) escTargets[t] = (escTargets[t] || 0) + 1; }

        // Supplier detail table
        const supDetail = Object.entries(supVals).map(([name, value]) => {
          const supAwards = awards.filter(a => (a.supplier_name || a.supplier_id) === name);
          const wonAwards = supAwards.filter(won);
          const avgSaving = supAwards.filter(a => sv(a) > 0);
          const avgS = avgSaving.length ? avgSaving.reduce((s, a) => s + sv(a), 0) / avgSaving.length : 0;
          const avgR = supAwards.length ? supAwards.reduce((s, a) => s + rs(a), 0) / supAwards.length : 0;
          const comp = supAwards.filter(a => a.policy_compliant === true).length;
          const avgL = supAwards.filter(a => ld(a) > 0);
          const aL = avgL.length ? avgL.reduce((s, a) => s + ld(a), 0) / avgL.length : 0;
          return { name, value, bids: supAwards.length, wins: wonAwards.length, winRate: supAwards.length ? (wonAwards.length / supAwards.length) * 100 : 0, avgSavings: avgS, avgRisk: avgR, compliance: supAwards.length ? (comp / supAwards.length) * 100 : 0, avgLead: aL, share: (value / totalV2) * 100 };
        }).sort((a, b) => b.value - a.value);

        // Category breakdown
        // Category breakdown for audit
        const auditCatValues: Record<string, { value: number; count: number }> = {};
        for (const a of awards) { const cat = a.category_l1 || "Unknown"; if (!auditCatValues[cat]) auditCatValues[cat] = { value: 0, count: 0 }; auditCatValues[cat].value += v(a); auditCatValues[cat].count++; }

        const catDetail = Object.entries(auditCatValues).map(([cat, d]) => {
          const catAwards = awards.filter(a => a.category_l1 === cat);
          const comp = catAwards.filter(a => a.policy_compliant === true).length;
          const esc = catAwards.filter(a => a.escalation_required === true).length;
          return { cat, value: d.value, count: d.count, compliance: catAwards.length ? (comp / catAwards.length) * 100 : 0, escalations: esc };
        });

        // Country coverage
        const countryDetail: Record<string, { value: number; count: number; suppliers: Set<string> }> = {};
        for (const a of awards) { const c = (a.country as string) || "?"; if (!countryDetail[c]) countryDetail[c] = { value: 0, count: 0, suppliers: new Set() }; countryDetail[c].value += v(a); countryDetail[c].count++; countryDetail[c].suppliers.add(a.supplier_name || a.supplier_id); }

        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAudit(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div ref={auditRef}>
              {/* Header */}
              <div className="p-8 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Confidential — Internal Use Only</p>
                    <h2 className="text-2xl font-bold text-ciq-black">Procurement Audit &amp; Compliance Report</h2>
                    <p className="text-sm text-ciq-darkgrey mt-1">Autonomous Sourcing Decision Audit Trail</p>
                    <div className="flex gap-4 mt-3 text-xs text-gray-500">
                      <span>Report ID: AUD-{Date.now().toString(36).toUpperCase()}</span>
                      <span>Generated: {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
                      <span>System: ChainIQ v1.0</span>
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center flex-shrink-0">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                  </div>
                </div>
              </div>

              <div className="p-8 space-y-8 text-sm">
                {/* 1. Executive Summary */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">1</span> Executive Summary</h3>
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-ciq-darkgrey leading-relaxed">
                    This report covers <strong>{awards.length}</strong> sourcing decisions totaling <strong>EUR {(totalVal / 1e6).toFixed(2)}M</strong> across <strong>{Object.keys(supVals).length}</strong> suppliers in <strong>{Object.keys(countryDetail).length}</strong> countries.
                    Policy compliance stands at <strong className={complianceRate >= 95 ? "text-green-700" : "text-red-700"}>{complianceRate.toFixed(1)}%</strong>.
                    {nonCompliant.length > 0 && <> <strong className="text-red-700">{nonCompliant.length} non-compliant decision{nonCompliant.length > 1 ? "s" : ""}</strong> require remediation.</>}
                    {escAwards.length > 0 && <> <strong>{escalationRate.toFixed(0)}%</strong> of awards required escalation ({escAwards.length} total).</>}
                    {" "}Supplier concentration (HHI) is <strong className={hhi > 0.25 ? "text-red-700" : hhi > 0.15 ? "text-amber-700" : "text-green-700"}>{(hhi * 100).toFixed(0)}%</strong> ({hhi > 0.25 ? "high risk" : hhi > 0.15 ? "moderate" : "healthy"}).
                    Average negotiated savings: <strong className="text-green-700">{avgSavPct.toFixed(1)}%</strong>. Average lead time: <strong>{avgLead.toFixed(0)} days</strong>.
                  </div>
                </section>

                {/* 2. Scope & Methodology */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">2</span> Audit Scope &amp; Methodology</h3>
                  <table className="w-full text-sm"><tbody className="divide-y divide-gray-100">
                    <tr><td className="py-2 text-gray-500 w-44">Review Period</td><td className="py-2">{dateFrom || "Inception"} — {dateTo || "Present"}</td></tr>
                    <tr><td className="py-2 text-gray-500">Category Scope</td><td className="py-2">{filterCategory || "All categories"} ({catDetail.length} L1 categories)</td></tr>
                    <tr><td className="py-2 text-gray-500">Geographic Scope</td><td className="py-2">{filterCountry || "All countries"} ({Object.keys(countryDetail).length} countries, 3 currency zones)</td></tr>
                    <tr><td className="py-2 text-gray-500">Awards Examined</td><td className="py-2">{awards.length} awards (including {wonCount} awarded, {awards.length - wonCount} evaluated alternatives)</td></tr>
                    <tr><td className="py-2 text-gray-500">Total Value</td><td className="py-2">EUR {totalVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
                    <tr><td className="py-2 text-gray-500">Data Sources</td><td className="py-2">requests.json, suppliers.csv, pricing.csv, policies.json, historical_awards.csv, categories.csv</td></tr>
                    <tr><td className="py-2 text-gray-500">Methodology</td><td className="py-2">Automated rule enforcement via ChainIQ orchestration pipeline. Each decision evaluated against approval thresholds, preferred/restricted supplier policies, category rules, and geography rules per policies.json.</td></tr>
                  </tbody></table>
                </section>

                {/* 3. Policy Compliance */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">3</span> Policy Compliance Assessment</h3>
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <div className={`p-3 rounded-lg text-center border ${complianceRate >= 95 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                      <p className={`text-2xl font-bold ${complianceRate >= 95 ? "text-green-700" : "text-red-700"}`}>{complianceRate.toFixed(1)}%</p>
                      <p className="text-[9px] text-gray-500 uppercase">Compliance</p>
                    </div>
                    <div className={`p-3 rounded-lg text-center border ${escalationRate < 20 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                      <p className={`text-2xl font-bold ${escalationRate < 20 ? "text-green-700" : "text-amber-700"}`}>{escalationRate.toFixed(0)}%</p>
                      <p className="text-[9px] text-gray-500 uppercase">Escalation Rate</p>
                    </div>
                    <div className="p-3 rounded-lg text-center border border-gray-200 bg-gray-50">
                      <p className="text-2xl font-bold text-ciq-black">{prefUsed.length}</p>
                      <p className="text-[9px] text-gray-500 uppercase">Preferred Used</p>
                    </div>
                    <div className="p-3 rounded-lg text-center border border-gray-200 bg-gray-50">
                      <p className="text-2xl font-bold text-ciq-black">{nonCompliant.length}</p>
                      <p className="text-[9px] text-gray-500 uppercase">Non-Compliant</p>
                    </div>
                  </div>

                  {nonCompliant.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-bold text-red-700 mb-2">Non-Compliant Decisions Requiring Remediation:</p>
                      <table className="w-full text-xs"><thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-1 text-left">Award</th><th className="py-1 text-left">Supplier</th><th className="py-1 text-right">Value</th><th className="py-1 text-left">Rationale</th></tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {nonCompliant.slice(0, 10).map(a => (
                          <tr key={a.award_id} className="text-red-800 bg-red-50/50"><td className="py-1 font-mono">{a.award_id}</td><td className="py-1">{a.supplier_name}</td><td className="py-1 text-right">{(v(a) / 1000).toFixed(0)}k</td><td className="py-1 max-w-xs truncate">{a.decision_rationale as string || "-"}</td></tr>
                        ))}
                      </tbody></table>
                      {nonCompliant.length > 10 && <p className="text-[9px] text-gray-400 mt-1">...and {nonCompliant.length - 10} more.</p>}
                    </div>
                  )}

                  {/* Compliance by Category */}
                  <p className="text-xs font-bold text-ciq-darkgrey mb-2">Compliance by Category:</p>
                  <table className="w-full text-xs mb-2"><thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-1 text-left">Category</th><th className="py-1 text-right">Awards</th><th className="py-1 text-right">Value</th><th className="py-1 text-right">Compliance</th><th className="py-1 text-right">Escalations</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {catDetail.map(c => (
                      <tr key={c.cat}><td className="py-1">{c.cat}</td><td className="py-1 text-right">{c.count}</td><td className="py-1 text-right">{(c.value / 1000).toFixed(0)}k</td><td className={`py-1 text-right font-medium ${c.compliance >= 95 ? "text-green-700" : "text-red-700"}`}>{c.compliance.toFixed(0)}%</td><td className="py-1 text-right">{c.escalations}</td></tr>
                    ))}
                  </tbody></table>
                </section>

                {/* 4. Escalation Analysis */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">4</span> Escalation Routing Analysis</h3>
                  <p className="text-sm text-ciq-darkgrey mb-3">{escAwards.length} awards required human escalation per policy rules (ER-001 through ER-008).</p>
                  {Object.keys(escTargets).length > 0 && (
                    <table className="w-full text-xs"><thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-1 text-left">Escalation Target</th><th className="py-1 text-right">Count</th><th className="py-1 text-right">% of Escalations</th></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {Object.entries(escTargets).sort((a, b) => b[1] - a[1]).map(([target, count]) => (
                        <tr key={target}><td className="py-1">{target}</td><td className="py-1 text-right">{count}</td><td className="py-1 text-right">{((count / escAwards.length) * 100).toFixed(0)}%</td></tr>
                      ))}
                    </tbody></table>
                  )}
                </section>

                {/* 5. Supplier Concentration */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">5</span> Supplier Concentration &amp; Dependency Risk</h3>
                  <div className={`p-3 rounded-lg border mb-4 ${hhi > 0.25 ? "bg-red-50 border-red-200" : hhi > 0.15 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
                    <p className="text-sm"><strong>HHI: {(hhi * 10000).toFixed(0)} / 10,000</strong> ({(hhi * 100).toFixed(1)}%) — {hhi > 0.25 ? "Highly concentrated. Dependency on fewer suppliers creates supply chain risk. Diversification recommended." : hhi > 0.15 ? "Moderately concentrated. Monitor top-supplier dependency." : "Well-diversified supplier base."}</p>
                  </div>
                  <table className="w-full text-xs"><thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-1 text-left">Supplier</th><th className="py-1 text-right">Share</th><th className="py-1 text-right">Value</th><th className="py-1 text-right">Win Rate</th><th className="py-1 text-right">Avg Savings</th><th className="py-1 text-right">Risk</th><th className="py-1 text-right">Compliance</th><th className="py-1 text-right">Lead (d)</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {supDetail.slice(0, 10).map(s => (
                      <tr key={s.name}><td className="py-1 max-w-[140px] truncate">{s.name}</td><td className="py-1 text-right">{s.share.toFixed(1)}%</td><td className="py-1 text-right">{(s.value / 1000).toFixed(0)}k</td><td className="py-1 text-right">{s.winRate.toFixed(0)}%</td><td className={`py-1 text-right ${s.avgSavings > 5 ? "text-green-700" : ""}`}>{s.avgSavings.toFixed(1)}%</td><td className={`py-1 text-right ${s.avgRisk > 30 ? "text-red-700 font-bold" : ""}`}>{s.avgRisk.toFixed(0)}</td><td className={`py-1 text-right ${s.compliance < 100 ? "text-red-700" : "text-green-700"}`}>{s.compliance.toFixed(0)}%</td><td className="py-1 text-right">{s.avgLead.toFixed(0)}</td></tr>
                    ))}
                  </tbody></table>
                </section>

                {/* 6. Savings & Value Delivery */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">6</span> Cost Savings &amp; Value Delivery</h3>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-center"><p className="text-2xl font-bold text-green-700">{avgSavPct.toFixed(1)}%</p><p className="text-[9px] text-gray-500 uppercase">Avg Savings</p></div>
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-center"><p className="text-2xl font-bold text-ciq-black">{avgLead.toFixed(0)}d</p><p className="text-[9px] text-gray-500 uppercase">Avg Lead Time</p></div>
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-center"><p className="text-2xl font-bold text-ciq-black">{wonCount}</p><p className="text-[9px] text-gray-500 uppercase">Awards Made</p></div>
                  </div>
                  {avgSavPct < 3 && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">Average savings of {avgSavPct.toFixed(1)}% is below the 3% benchmark. Recommend framework agreement renegotiation and increased competitive bidding.</div>}
                </section>

                {/* 7. Risk */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">7</span> Risk Assessment</h3>
                  <p className="text-sm text-ciq-darkgrey mb-2">Average risk score at award: <strong>{avgRiskScore.toFixed(0)}/100</strong> (lower = better)</p>
                  {highRisk.length > 0 ? (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs font-bold text-red-700 mb-1">{highRisk.length} High-Risk Awards (score &gt; 30)</p>
                      <table className="w-full text-xs mt-2"><thead><tr className="border-b border-red-200 text-red-600"><th className="py-1 text-left">Award</th><th className="py-1 text-left">Supplier</th><th className="py-1 text-right">Risk</th><th className="py-1 text-right">Value</th></tr></thead>
                      <tbody className="divide-y divide-red-100">
                        {highRisk.slice(0, 5).map(a => (
                          <tr key={a.award_id}><td className="py-1 font-mono">{a.award_id}</td><td className="py-1">{a.supplier_name}</td><td className="py-1 text-right font-bold">{rs(a)}</td><td className="py-1 text-right">{(v(a) / 1000).toFixed(0)}k</td></tr>
                        ))}
                      </tbody></table>
                      {highRisk.length > 5 && <p className="text-[9px] text-red-500 mt-1">...and {highRisk.length - 5} more high-risk awards.</p>}
                    </div>
                  ) : <p className="text-xs text-green-700 p-3 bg-green-50 rounded-lg border border-green-200">All awards within acceptable risk thresholds (&le;30).</p>}
                </section>

                {/* 8. Geographic Coverage */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">8</span> Geographic Coverage &amp; Regulatory Compliance</h3>
                  <table className="w-full text-xs"><thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-1 text-left">Country</th><th className="py-1 text-right">Awards</th><th className="py-1 text-right">Value</th><th className="py-1 text-right">Suppliers</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {Object.entries(countryDetail).sort((a, b) => b[1].value - a[1].value).map(([co, d]) => (
                      <tr key={co}><td className="py-1 font-medium">{co}</td><td className="py-1 text-right">{d.count}</td><td className="py-1 text-right">{(d.value / 1000).toFixed(0)}k</td><td className="py-1 text-right">{d.suppliers.size}</td></tr>
                    ))}
                  </tbody></table>
                  <p className="text-[9px] text-gray-400 mt-2">Geography rules from policies.json (data sovereignty, regional rollout requirements) apply per delivery country. CH requires CHF-denominated contracts; APAC/MEA/Americas use USD thresholds.</p>
                </section>

                {/* 9. Auditor Notes & Recommendations */}
                <section>
                  <h3 className="text-base font-bold text-ciq-black mb-3 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">9</span> Recommendations</h3>
                  <div className="space-y-2">
                    {nonCompliant.length > 0 && <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded-r-lg text-xs text-red-800"><strong>CRITICAL:</strong> {nonCompliant.length} non-compliant awards identified. Initiate remediation review and document exception approvals where applicable.</div>}
                    {hhi > 0.25 && <div className="p-3 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg text-xs text-amber-800"><strong>HIGH:</strong> Supplier concentration exceeds safe threshold (HHI {(hhi * 100).toFixed(0)}%). Develop supplier diversification strategy for top-spend categories.</div>}
                    {highRisk.length > 0 && <div className="p-3 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg text-xs text-amber-800"><strong>MEDIUM:</strong> {highRisk.length} awards made to suppliers with risk scores above 30. Schedule quarterly supplier performance reviews.</div>}
                    {avgSavPct < 3 && <div className="p-3 bg-blue-50 border-l-4 border-blue-500 rounded-r-lg text-xs text-blue-800"><strong>IMPROVEMENT:</strong> Average savings ({avgSavPct.toFixed(1)}%) below 3% target. Recommend renegotiating framework agreements and increasing competitive bidding.</div>}
                    <div className="p-3 bg-gray-50 border-l-4 border-gray-400 rounded-r-lg text-xs text-gray-700"><strong>GENERAL:</strong> All sourcing decisions processed through ChainIQ autonomous pipeline with full rule enforcement. Escalation routing verified against policy rules ER-001 through ER-008. Decision reasoning captured in process trace for each award.</div>
                  </div>
                </section>

                {/* 10. Sign-off */}
                <section className="border-t-2 border-gray-200 pt-6">
                  <h3 className="text-base font-bold text-ciq-black mb-4 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-ciq-red text-white flex items-center justify-center text-xs font-bold">10</span> Sign-Off</h3>
                  <div className="grid grid-cols-3 gap-6">
                    <div><div className="border-b-2 border-gray-300 pb-10 mb-2"></div><p className="text-[10px] text-gray-500">Prepared by</p><p className="text-xs text-ciq-black">ChainIQ Sourcing Agent v1.0</p></div>
                    <div><div className="border-b-2 border-gray-300 pb-10 mb-2"></div><p className="text-[10px] text-gray-500">Reviewed by</p><p className="text-xs text-gray-400">Name / Date</p></div>
                    <div><div className="border-b-2 border-gray-300 pb-10 mb-2"></div><p className="text-[10px] text-gray-500">Approved by</p><p className="text-xs text-gray-400">Name / Date</p></div>
                  </div>
                  <p className="text-[8px] text-gray-400 mt-4 leading-relaxed">
                    This report was auto-generated by ChainIQ Autonomous Sourcing Agent. All decisions were evaluated against procurement policies including approval thresholds (AT-001 through AT-005), preferred supplier rules, restricted supplier checks (including country-scoped and value-conditional restrictions), category rules, geography rules (data sovereignty, regional rollout), and escalation rules (ER-001 through ER-008). Data sources: requests.json (304 requests), suppliers.csv (40 suppliers, 151 category-supplier mappings), pricing.csv (599 pricing tiers), policies.json (6 governance sections), historical_awards.csv (590 awards), categories.csv (30 category definitions). This document is intended for internal audit and compliance review purposes only.
                  </p>
                </section>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white rounded-b-2xl">
              <button onClick={() => setShowAudit(false)} className="px-4 py-2 text-sm text-ciq-darkgrey hover:bg-gray-100 rounded-lg">Close</button>
              <button
                onClick={() => {
                  if (!auditRef.current) return;
                  const w = window.open("", "_blank");
                  if (!w) return;
                  w.document.write(`<html><head><title>ChainIQ Audit Report</title><style>
                    body{font-family:'Segoe UI',system-ui,sans-serif;padding:50px 60px;color:#333;font-size:12px;line-height:1.6}
                    h2{font-size:22px;color:#000;margin-bottom:4px} h3{font-size:14px;color:#000;margin-top:24px;margin-bottom:8px}
                    table{width:100%;border-collapse:collapse;margin:8px 0} td,th{padding:5px 8px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:11px}
                    th{color:#6b7280;font-weight:600} strong{font-weight:700} .text-green-700{color:#15803d} .text-red-700{color:#b91c1c} .text-amber-700{color:#b45309}
                    @media print{body{padding:20px 30px} @page{margin:1.5cm}}
                  </style></head><body>${auditRef.current.innerHTML}</body></html>`);
                  w.document.close();
                  setTimeout(() => w.print(), 300);
                }}
                className="px-5 py-2 bg-ciq-red text-white text-sm font-semibold rounded-lg hover:bg-red-700 flex items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Download PDF
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function TagDetailPanel({ tag, onClose }: { tag: string; onClose: () => void }) {
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRequests({ scenario_tag: tag, page_size: 200 })
      .then(d => setRequests(d.requests))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tag]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 lg:col-span-2 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ciq-black">Requests tagged: <span className="text-ciq-red">{tag.replace(/_/g, " ")}</span></h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">Close</button>
      </div>
      {loading ? (
        <div className="flex gap-1.5 justify-center py-4"><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /></div>
      ) : (
        <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-200 text-gray-500"><th className="py-1.5 text-left">ID</th><th className="py-1.5 text-left">Title</th><th className="py-1.5 text-left">Category</th><th className="py-1.5 text-left">Country</th><th className="py-1.5 text-right">Budget</th><th className="py-1.5 text-left">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {requests.map(r => (
                <tr key={r.request_id} className="hover:bg-gray-50">
                  <td className="py-1.5 font-mono text-gray-500">{r.request_id}</td>
                  <td className="py-1.5 text-ciq-black max-w-[200px] truncate">{r.title || "-"}</td>
                  <td className="py-1.5 text-gray-600">{r.category_l1 || "-"}</td>
                  <td className="py-1.5 text-gray-600">{r.country || "-"}</td>
                  <td className="py-1.5 text-right text-gray-600">{r.budget_amount ? `${r.budget_amount.toLocaleString()} ${r.currency || "EUR"}` : "-"}</td>
                  <td className="py-1.5"><span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-600">{r.status || "new"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
      <p className="text-[9px] text-gray-400 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${color || "text-ciq-black"}`}>{value}</p>
      {sub && <p className="text-[9px] text-ciq-darkgrey">{sub}</p>}
    </div>
  );
}
