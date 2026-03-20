"use client";

import { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

type Tab = "suppliers" | "policies" | "categories";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("suppliers");

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-5">
        <h1 className="page-title">Administration</h1>
        <p className="page-subtitle">Manage suppliers, policies, and procurement rules</p>
      </div>

      <div className="flex gap-1 mb-5 bg-white rounded-xl shadow-sm border border-gray-200 p-1.5">
        {([["suppliers", "Suppliers"], ["policies", "Policies & Rules"], ["categories", "Categories"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === id ? "bg-ciq-red text-white" : "text-gray-600 hover:bg-gray-50"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "suppliers" && <SuppliersTab />}
      {tab === "policies" && <PoliciesTab />}
      {tab === "categories" && <CategoriesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suppliers Tab
// ---------------------------------------------------------------------------
function SuppliersTab() {
  const [suppliers, setSuppliers] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newSupplier, setNewSupplier] = useState<Record<string, string>>({ supplier_id: "", supplier_name: "", category_l1: "", category_l2: "", country_hq: "", service_regions: "", currency: "EUR", quality_score: "50", risk_score: "50", esg_score: "50", capacity_per_month: "1000" });
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`${API}/admin/suppliers`).then(r => r.json()).then(d => setSuppliers(d.suppliers)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Deduplicate by supplier_id (show unique suppliers)
  const deduped: Record<string, Record<string, unknown>> = {};
  for (const s of suppliers) {
    const id = s.supplier_id as string;
    if (!deduped[id]) deduped[id] = { ...s, _categories: [`${s.category_l1}/${s.category_l2}`] };
    else (deduped[id]._categories as string[]).push(`${s.category_l1}/${s.category_l2}`);
  }
  const uniqueSuppliers = Object.values(deduped).filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (s.supplier_name as string || "").toLowerCase().includes(q) || (s.supplier_id as string || "").toLowerCase().includes(q);
  });

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const handleSave = async (id: string) => {
    const res = await fetch(`${API}/admin/suppliers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editData) });
    if (res.ok) { flash("Supplier updated"); setEditId(null); const d = await fetch(`${API}/admin/suppliers`).then(r => r.json()); setSuppliers(d.suppliers); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete supplier ${id}? This cannot be undone.`)) return;
    const res = await fetch(`${API}/admin/suppliers/${id}`, { method: "DELETE" });
    if (res.ok) { flash("Supplier deleted"); setSuppliers(prev => prev.filter(s => s.supplier_id !== id)); }
  };

  const handleAdd = async () => {
    const body = { ...newSupplier, quality_score: parseInt(newSupplier.quality_score), risk_score: parseInt(newSupplier.risk_score), esg_score: parseInt(newSupplier.esg_score), capacity_per_month: parseInt(newSupplier.capacity_per_month), preferred_supplier: false, is_restricted: false };
    const res = await fetch(`${API}/admin/suppliers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { flash("Supplier added"); setShowAdd(false); const d = await fetch(`${API}/admin/suppliers`).then(r => r.json()); setSuppliers(d.suppliers); }
  };

  if (loading) return <div className="flex justify-center py-10"><div className="flex gap-1.5"><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /></div></div>;

  return (
    <div>
      {msg && <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 animate-fade-in">{msg}</div>}

      <div className="flex items-center gap-3 mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers..." className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-ciq-red" />
        <button onClick={() => setShowAdd(!showAdd)} className="px-4 py-2 bg-ciq-red text-white rounded-lg text-sm font-medium hover:bg-red-700">
          {showAdd ? "Cancel" : "+ Add Supplier"}
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm animate-fade-in">
          <h3 className="text-sm font-bold text-ciq-black mb-3">Register New Supplier</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(newSupplier).map(([key, val]) => (
              <div key={key}>
                <label className="text-[10px] text-gray-400 uppercase">{key.replace(/_/g, " ")}</label>
                <input value={val} onChange={e => setNewSupplier(p => ({ ...p, [key]: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-ciq-red" />
              </div>
            ))}
          </div>
          <button onClick={handleAdd} className="mt-3 px-4 py-2 bg-ciq-red text-white rounded-lg text-sm font-medium hover:bg-red-700">Register Supplier</button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-100 text-gray-500">
              <th className="px-3 py-2.5 text-left">ID</th>
              <th className="px-3 py-2.5 text-left">Name</th>
              <th className="px-3 py-2.5 text-left">Categories</th>
              <th className="px-3 py-2.5 text-left">HQ</th>
              <th className="px-3 py-2.5 text-center">Quality</th>
              <th className="px-3 py-2.5 text-center">Risk</th>
              <th className="px-3 py-2.5 text-center">ESG</th>
              <th className="px-3 py-2.5 text-center">Preferred</th>
              <th className="px-3 py-2.5 text-center">Restricted</th>
              <th className="px-3 py-2.5 text-center">Status</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {uniqueSuppliers.map(s => {
                const id = s.supplier_id as string;
                const isEditing = editId === id;
                return (
                  <tr key={id} className={isEditing ? "bg-red-50/30" : "hover:bg-gray-50"}>
                    <td className="px-3 py-2 font-mono text-gray-500">{id}</td>
                    <td className="px-3 py-2 font-medium text-ciq-black">{isEditing ? <input value={String(editData.supplier_name || s.supplier_name)} onChange={e => setEditData(p => ({ ...p, supplier_name: e.target.value }))} className="px-1 py-0.5 border rounded text-xs w-full" /> : String(s.supplier_name)}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[150px]"><div className="flex flex-wrap gap-0.5">{(s._categories as string[]).map((c, i) => <span key={i} className="px-1.5 py-0.5 bg-gray-100 rounded text-[9px]">{c}</span>)}</div></td>
                    <td className="px-3 py-2 text-gray-600">{String(s.country_hq || "-")}</td>
                    <td className="px-3 py-2 text-center">{isEditing ? <input type="number" value={String(editData.quality_score ?? s.quality_score)} onChange={e => setEditData(p => ({ ...p, quality_score: parseInt(e.target.value) }))} className="w-12 px-1 py-0.5 border rounded text-xs text-center" /> : <span className="text-green-700 font-medium">{String(s.quality_score)}</span>}</td>
                    <td className="px-3 py-2 text-center">{isEditing ? <input type="number" value={String(editData.risk_score ?? s.risk_score)} onChange={e => setEditData(p => ({ ...p, risk_score: parseInt(e.target.value) }))} className="w-12 px-1 py-0.5 border rounded text-xs text-center" /> : <span className={`font-medium ${(s.risk_score as number) > 30 ? "text-red-700" : "text-gray-600"}`}>{String(s.risk_score)}</span>}</td>
                    <td className="px-3 py-2 text-center">{isEditing ? <input type="number" value={String(editData.esg_score ?? s.esg_score)} onChange={e => setEditData(p => ({ ...p, esg_score: parseInt(e.target.value) }))} className="w-12 px-1 py-0.5 border rounded text-xs text-center" /> : String(s.esg_score)}</td>
                    <td className="px-3 py-2 text-center">{isEditing ? <input type="checkbox" checked={!!editData.preferred_supplier} onChange={e => setEditData(p => ({ ...p, preferred_supplier: e.target.checked }))} className="accent-ciq-red" /> : <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${s.preferred_supplier ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{s.preferred_supplier ? "Yes" : "No"}</span>}</td>
                    <td className="px-3 py-2 text-center">{isEditing ? <input type="checkbox" checked={!!editData.is_restricted} onChange={e => setEditData(p => ({ ...p, is_restricted: e.target.checked }))} className="accent-ciq-red" /> : <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${s.is_restricted ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>{s.is_restricted ? "Yes" : "No"}</span>}</td>
                    <td className="px-3 py-2 text-center"><span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${s.contract_status === "active" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{String(s.contract_status || "active")}</span></td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => handleSave(id)} className="px-2 py-1 bg-green-600 text-white rounded text-[10px] font-medium">Save</button>
                          <button onClick={() => setEditId(null)} className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-[10px]">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => { setEditId(id); setEditData({ supplier_name: s.supplier_name, quality_score: s.quality_score, risk_score: s.risk_score, esg_score: s.esg_score, preferred_supplier: s.preferred_supplier, is_restricted: s.is_restricted }); }} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-[10px] hover:bg-gray-200">Edit</button>
                          <button onClick={() => handleDelete(id)} className="px-2 py-1 bg-red-50 text-red-700 rounded text-[10px] hover:bg-red-100">Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-gray-100 text-xs text-gray-400">{uniqueSuppliers.length} suppliers ({suppliers.length} category mappings)</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policies Tab
// ---------------------------------------------------------------------------
function PoliciesTab() {
  const [policies, setPolicies] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editSection, setEditSection] = useState<string | null>(null);
  const [editJson, setEditJson] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`${API}/admin/policies`).then(r => r.json()).then(setPolicies).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const sectionLabels: Record<string, { label: string; desc: string }> = {
    approval_thresholds: { label: "Approval Thresholds", desc: "Budget tiers, quote requirements, and approval levels by currency" },
    preferred_suppliers: { label: "Preferred Suppliers", desc: "Preferred supplier/category/region combinations" },
    restricted_suppliers: { label: "Restricted Suppliers", desc: "Suppliers with usage restrictions (global, country-scoped, value-conditional)" },
    category_rules: { label: "Category Rules", desc: "Category-specific sourcing constraints (competitive comparison, security review, etc.)" },
    geography_rules: { label: "Geography Rules", desc: "Region-specific data sovereignty and compliance requirements" },
    escalation_rules: { label: "Escalation Rules", desc: "When to escalate to human decision-makers (ER-001 to ER-008)" },
  };

  const handleSave = async (section: string) => {
    try {
      const parsed = JSON.parse(editJson);
      const res = await fetch(`${API}/admin/policies/${section}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: parsed }) });
      if (res.ok) { flash(`${sectionLabels[section]?.label || section} updated`); setPolicies(prev => prev ? { ...prev, [section]: parsed } : prev); setEditSection(null); }
    } catch { flash("Invalid JSON — please check syntax"); }
  };

  if (loading) return <div className="flex justify-center py-10"><div className="flex gap-1.5"><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /></div></div>;
  if (!policies) return <p className="text-ciq-darkgrey">Failed to load policies.</p>;

  return (
    <div className="space-y-3">
      {msg && <div className="px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 animate-fade-in">{msg}</div>}

      {Object.entries(sectionLabels).map(([key, meta]) => {
        const data = policies[key];
        const isEditing = editSection === key;
        const itemCount = Array.isArray(data) ? data.length : typeof data === "object" && data ? Object.keys(data).length : 0;

        return (
          <div key={key} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50" onClick={() => { if (!isEditing) { setEditSection(editSection === key ? null : key); setEditJson(JSON.stringify(data, null, 2)); } }}>
              <div>
                <h3 className="text-sm font-semibold text-ciq-black">{meta.label}</h3>
                <p className="text-[10px] text-ciq-darkgrey mt-0.5">{meta.desc}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] text-gray-600">{itemCount} rules</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" className={`transition-transform ${isEditing ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </div>
            {isEditing && (
              <div className="border-t border-gray-100 p-4 bg-gray-50/50">
                <textarea value={editJson} onChange={e => setEditJson(e.target.value)} className="w-full h-64 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono text-ciq-black bg-white focus:ring-1 focus:ring-ciq-red resize-y" />
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => setEditSection(null)} className="px-3 py-1.5 text-xs text-ciq-darkgrey hover:bg-gray-200 rounded-lg">Cancel</button>
                  <button onClick={() => handleSave(key)} className="px-4 py-1.5 bg-ciq-red text-white text-xs font-medium rounded-lg hover:bg-red-700">Save Changes</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories Tab
// ---------------------------------------------------------------------------
function CategoriesTab() {
  const [categories, setCategories] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/admin/categories`).then(r => r.json()).then(d => setCategories(d.categories)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-10"><div className="flex gap-1.5"><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /><span className="w-2 h-2 rounded-full bg-ciq-red loading-dot" /></div></div>;

  // Group by L1
  const grouped: Record<string, Record<string, unknown>[]> = {};
  for (const cat of categories) {
    const l1 = cat.category_l1 as string || "Other";
    if (!grouped[l1]) grouped[l1] = [];
    grouped[l1].push(cat);
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([l1, cats]) => (
        <div key={l1} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <h3 className="text-sm font-bold text-ciq-black">{l1}</h3>
            <p className="text-[10px] text-gray-400">{cats.length} subcategories</p>
          </div>
          <div className="divide-y divide-gray-50">
            {cats.map((cat, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-ciq-black">{cat.category_l2 as string}</p>
                  <p className="text-[10px] text-gray-400">{cat.category_description as string || ""}</p>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  <span>Unit: {cat.typical_unit as string || "-"}</span>
                  <span>Model: {cat.pricing_model as string || "-"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
