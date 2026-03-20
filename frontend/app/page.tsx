"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { analyzeCustomStream, analyzeCustom } from "@/lib/api";
import type { ProcessStep } from "@/lib/types";

// Procurement doodle icons — scattered generously
const DOODLES = [
  // Row 1
  { path: "M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4z", x: 5, y: 5 },
  { path: "M3 3h18v2H3V3zm0 4h18v2H3V7zm0 4h12v2H3v-2zm0 4h18v2H3v-2zm0 4h12v2H3v-2z", x: 22, y: 3 },
  { path: "M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z", x: 40, y: 8 },
  { path: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z", x: 58, y: 4 },
  { path: "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z", x: 78, y: 6 },
  { path: "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z", x: 93, y: 3 },
  // Row 2
  { path: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z", x: 10, y: 22 },
  { path: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l4.59-4.58L18 11l-6 6z", x: 30, y: 20 },
  { path: "M20 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.11-.9-2-2-2zm0 14H4V8h16v10zm-6-1h4v-4h-4v4z", x: 50, y: 25 },
  { path: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z", x: 70, y: 18 },
  { path: "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z", x: 88, y: 22 },
  // Row 3
  { path: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", x: 3, y: 40 },
  { path: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z", x: 20, y: 42 },
  { path: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z", x: 42, y: 38 },
  { path: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z", x: 62, y: 43 },
  { path: "M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4z", x: 82, y: 40 },
  { path: "M3 3h18v2H3V3zm0 4h18v2H3V7zm0 4h12v2H3v-2zm0 4h18v2H3v-2z", x: 95, y: 45 },
  // Row 4
  { path: "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z", x: 8, y: 60 },
  { path: "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z", x: 28, y: 62 },
  { path: "M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z", x: 48, y: 58 },
  { path: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z", x: 68, y: 63 },
  { path: "M20 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.11-.9-2-2-2zm0 14H4V8h16v10zm-6-1h4v-4h-4v4z", x: 88, y: 58 },
  // Row 5
  { path: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z", x: 15, y: 80 },
  { path: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", x: 35, y: 82 },
  { path: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z", x: 55, y: 78 },
  { path: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z", x: 75, y: 83 },
  { path: "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z", x: 92, y: 80 },
  // Extra scattered
  { path: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z", x: 2, y: 93 },
  { path: "M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4z", x: 52, y: 95 },
  { path: "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z", x: 95, y: 92 },
];

function DoodleBackground({ mouseX, mouseY }: { mouseX: number; mouseY: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {DOODLES.map((d, i) => {
        // 3 depth layers for parallax feel
        const layer = i % 3;
        const speed = layer === 0 ? 0.3 : layer === 1 ? 0.15 : 0.06;
        const dir = i % 2 === 0 ? 1 : -1;
        const tx = (mouseX - 50) * speed * dir;
        const ty = (mouseY - 50) * speed * dir * 0.7;
        const size = layer === 0 ? 32 : layer === 1 ? 24 : 20;
        const opacity = layer === 0 ? 0.07 : layer === 1 ? 0.05 : 0.035;
        const rotation = (i * 37) % 360; // pseudo-random rotation
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className="absolute transition-transform duration-500 ease-out"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: `${size}px`,
              height: `${size}px`,
              transform: `translate(${tx}px, ${ty}px) rotate(${rotation}deg)`,
              opacity,
            }}
          >
            <path d={d.path} fill="#FF0000" />
          </svg>
        );
      })}
    </div>
  );
}

export default function ProcurePage() {
  const router = useRouter();
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [liveSteps, setLiveSteps] = useState<ProcessStep[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  }, []);

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
    <div className="flex items-center justify-center h-full relative" onMouseMove={handleMouseMove}>
      {/* Doodle background */}
      <DoodleBackground mouseX={mousePos.x} mouseY={mousePos.y} />
      <div className={`flex flex-col items-center w-full px-6 relative z-10 ${showTimeline ? "" : "max-w-2xl"}`}>
        {/* Logo */}
        <img src="/logo.png" alt="ChainIQ" className="h-20 w-auto object-contain mb-6" />

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
