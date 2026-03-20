import type {
  PaginatedRequests,
  PaginatedHistoricalAwards,
  ProcurementRequest,
  AnalysisResponse,
  StatsResponse,
  CustomRequestInput,
  ProcessStep,
  WhitespaceEntry,
} from "./types";

// For regular API calls, use the Next.js proxy (relative path)
// For streaming SSE calls, hit the backend directly to avoid proxy buffering
const API_BASE = typeof window !== "undefined" ? "/api" : (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api");
const STREAM_BASE = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_STREAM_BASE || "http://localhost:8000/api")
  : "http://localhost:8000/api";

export async function fetchRequests(params?: {
  scenario_tag?: string;
  category_l1?: string;
  country?: string;
  status?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedRequests> {
  const searchParams = new URLSearchParams();
  if (params?.scenario_tag) searchParams.set("scenario_tag", params.scenario_tag);
  if (params?.category_l1) searchParams.set("category_l1", params.category_l1);
  if (params?.country) searchParams.set("country", params.country);
  if (params?.status) searchParams.set("status", params.status);
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

export async function analyzeCustomStream(
  body: CustomRequestInput,
  onStep: (step: ProcessStep) => void,
): Promise<AnalysisResponse> {
  const res = await fetch(`${STREAM_BASE}/analyze/custom/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to start streaming analysis: ${res.statusText}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: AnalysisResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.type === "complete") {
          finalResult = parsed.result as AnalysisResponse;
        } else if (parsed.type === "error") {
          throw new Error(parsed.detail || "Analysis failed");
        } else {
          onStep(parsed as ProcessStep);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Analysis failed")) throw e;
      }
    }
  }

  if (!finalResult) throw new Error("Stream ended without final result");
  return finalResult;
}

export async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
  return res.json();
}

export async function analyzeRequestStream(
  id: string,
  onStep: (step: ProcessStep) => void,
): Promise<AnalysisResponse> {
  const res = await fetch(`${STREAM_BASE}/analyze/${id}/stream`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start streaming analysis: ${res.statusText}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: AnalysisResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.type === "complete") {
          finalResult = parsed.result as AnalysisResponse;
        } else if (parsed.type === "error") {
          throw new Error(parsed.detail || "Analysis failed");
        } else {
          onStep(parsed as ProcessStep);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Analysis failed")) throw e;
        // Skip malformed events
      }
    }
  }

  if (!finalResult) throw new Error("Stream ended without final result");
  return finalResult;
}

export async function fetchWhitespace(): Promise<{ entries: WhitespaceEntry[] }> {
  const res = await fetch(`${API_BASE}/whitespace`);
  if (!res.ok) throw new Error(`Failed to fetch whitespace: ${res.statusText}`);
  return res.json();
}

export async function researchWhitespace(entryId: string): Promise<WhitespaceEntry> {
  const res = await fetch(`${API_BASE}/whitespace/${entryId}/research`, { method: "POST" });
  if (!res.ok) throw new Error(`Research failed: ${res.statusText}`);
  return res.json();
}

export async function fetchHistoricalAwards(params?: {
  category_l1?: string;
  country?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedHistoricalAwards> {
  const searchParams = new URLSearchParams();
  if (params?.category_l1) searchParams.set("category_l1", params.category_l1);
  if (params?.country) searchParams.set("country", params.country);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.page_size) searchParams.set("page_size", String(params.page_size));

  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/historical${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`Failed to fetch historical awards: ${res.statusText}`);
  return res.json();
}
