import type {
  PaginatedRequests,
  ProcurementRequest,
  AnalysisResponse,
  StatsResponse,
  CustomRequestInput,
} from "./types";

// Hit backend directly to avoid Next.js proxy timeout on long-running analysis calls
const API_BASE = "http://localhost:8000/api";

export async function fetchRequests(params?: {
  scenario_tag?: string;
  category_l1?: string;
  country?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedRequests> {
  const searchParams = new URLSearchParams();
  if (params?.scenario_tag) searchParams.set("scenario_tag", params.scenario_tag);
  if (params?.category_l1) searchParams.set("category_l1", params.category_l1);
  if (params?.country) searchParams.set("country", params.country);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.page_size) searchParams.set("page_size", String(params.page_size));

  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/requests${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`Failed to fetch requests: ${res.statusText}`);
  return res.json();
}

export async function fetchRequest(id: string): Promise<ProcurementRequest> {
  const res = await fetch(`${API_BASE}/requests/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch request ${id}: ${res.statusText}`);
  return res.json();
}

export async function analyzeRequest(id: string): Promise<AnalysisResponse> {
  const res = await fetch(`${API_BASE}/analyze/${id}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to analyze request ${id}: ${res.statusText}`);
  return res.json();
}

export async function analyzeCustom(body: CustomRequestInput): Promise<AnalysisResponse> {
  const res = await fetch(`${API_BASE}/analyze/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to analyze custom request: ${res.statusText}`);
  return res.json();
}

export async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
  return res.json();
}
