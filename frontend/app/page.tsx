"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { analyzeCustomStream, analyzeCustom } from "@/lib/api";
import type { ProcessStep } from "@/lib/types";

export default function ProcurePage() {
  const router = useRouter();
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [liveSteps, setLiveSteps] = useState<ProcessStep[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Pick up re-analyze text from clarification flow
  useEffect(() => {
    const reanalyze = sessionStorage.getItem("reanalyze_text");
    if (reanalyze) {
      setRequestText(reanalyze);
      sessionStorage.removeItem("reanalyze_text");
    }
  }, []);

  // Auto-scroll: always keep the rightmost element in view
  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
  }, []);

  useEffect(() => {
    if (liveSteps.length > 0) {
      // Small delay to let DOM render the new step
      const t = setTimeout(scrollToEnd, 80);
      return () => clearTimeout(t);
    }
  }, [liveSteps.length, scrollToEnd]);

  const handleSubmit = async () => {
    if (!requestText.trim()) return;
    setSubmitting(true);
    setShowTimeline(true);
    setLiveSteps([]);

    try {
      const result = await analyzeCustomStream(
        { request_text: requestText },
        (step) => setLiveSteps((prev) => [...prev, step]),
      );
      sessionStorage.setItem(`analysis_${result.request_id}`, JSON.stringify(result));
      router.push(`/request/${result.request_id}`);
    } catch {
      try {
        const result = await analyzeCustom({ request_text: requestText });
        sessionStorage.setItem(`analysis_${result.request_id}`, JSON.stringify(result));
        router.push(`/request/${result.request_id}`);
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : "Analysis failed");
        setSubmitting(false);
        setShowTimeline(false);
      }
    }
  };

  // For each step, pick a short conclusion text from output_summary (preferred) or step_description
  const getStepConclusion = (step: ProcessStep): string => {
    // output_summary is the result/conclusion — always prefer it
    if (step.output_summary) {
      const s = step.output_summary;
      return s.length > 50 ? s.slice(0, 47) + "..." : s;
    }
    return "";
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className={`flex flex-col items-center w-full px-6 ${showTimeline ? "" : "max-w-2xl"}`}>
        {/* Logo */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center mb-5">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-ciq-black mb-2">ChainIQ</h1>
        <p className="text-ciq-darkgrey text-center mb-8">
          Every procurement decision, focused and streamlined
        </p>

        {!showTimeline ? (
          <>
            <textarea
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              placeholder="Write your request — include quantity, country, budget, days until required, and details"
              className="w-full h-40 px-5 py-4 border border-gray-200 rounded-2xl text-sm text-ciq-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-ciq-red focus:border-transparent resize-none bg-white shadow-sm"
            />
            <button
              onClick={handleSubmit}
              disabled={!requestText.trim() || submitting}
              className="mt-5 px-8 py-4 bg-ciq-red text-white rounded-xl text-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 shadow-sm"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Analyze Request
            </button>
          </>
        ) : (
          <div className="w-full bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-ciq-black mb-1 text-center">
              Analyzing your request...
            </h2>
            <p className="text-sm text-ciq-darkgrey mb-5 text-center">
              {requestText.slice(0, 100)}{requestText.length > 100 ? "..." : ""}
            </p>

            {/* Horizontal pipeline — full width, hidden scrollbar, auto-focuses rightmost */}
            <div className="overflow-x-auto hide-scrollbar">
              <div className="flex items-start min-w-max py-2">
                {liveSteps.map((step, idx) => {
                  const isCompleted = step.status === "completed";
                  const isFailed = step.status === "failed";
                  const conclusion = getStepConclusion(step);

                  return (
                    <div key={step.step_id} className="flex items-start flex-shrink-0 animate-fade-in">
                      {/* Step node */}
                      <div className="flex flex-col items-center w-[140px]">
                        <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${
                          isCompleted ? "border-green-500 bg-green-50"
                          : isFailed ? "border-red-500 bg-red-50"
                          : "border-amber-400 bg-amber-50 scale-110"
                        }`}>
                          {isCompleted ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : isFailed ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          ) : (
                            <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                          )}
                        </div>
                        <p className="text-[11px] font-semibold mt-2 text-center leading-tight text-ciq-black">
                          {step.step_name}
                        </p>
                        {conclusion && (
                          <p className="text-[9px] text-ciq-darkgrey mt-1 text-center leading-snug px-1">
                            {conclusion}
                          </p>
                        )}
                      </div>
                      {/* Connector arrow */}
                      <div className="flex items-center pt-[18px] flex-shrink-0">
                        <div className={`h-[2px] w-10 ${isCompleted ? "bg-green-400" : "bg-gray-200"}`} />
                        {isCompleted && (
                          <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[5px] border-l-green-400 -ml-[1px]" />
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Pulsing "thinking" dot */}
                {liveSteps.length > 0 && (
                  <div className="flex flex-col items-center w-[110px] flex-shrink-0">
                    <div className="w-10 h-10 rounded-full border-2 border-ciq-red bg-red-50 flex items-center justify-center animate-pulse-glow">
                      <span className="w-3 h-3 rounded-full bg-ciq-red animate-pulse" />
                    </div>
                    <p className="text-[11px] text-ciq-darkgrey mt-2 italic">Thinking...</p>
                  </div>
                )}

                {/* Invisible anchor to scroll into view */}
                <div ref={endRef} className="w-1 flex-shrink-0" />
              </div>
            </div>

            {liveSteps.length === 0 && (
              <div className="flex items-center justify-center gap-3 py-4">
                <div className="w-5 h-5 border-2 border-red-200 border-t-ciq-red rounded-full animate-spin" />
                <p className="text-ciq-darkgrey text-sm">Initializing pipeline...</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
