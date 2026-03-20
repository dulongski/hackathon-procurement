"use client";

import { useState, useEffect } from "react";

const PATHS = [
  "M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4z", // briefcase
  "M3 3h18v2H3V3zm0 4h18v2H3V7zm0 4h12v2H3v-2zm0 4h18v2H3v-2zm0 4h12v2H3v-2z", // doc
  "M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z", // calendar
  "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z", // shield
  "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z", // dollar
  "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z", // bookmark
  "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z", // network
  "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l4.59-4.58L18 11l-6 6z", // checkbox
  "M20 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.11-.9-2-2-2zm0 14H4V8h16v10zm-6-1h4v-4h-4v4z", // card
  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z", // verified
  "M13 2L3 14h9l-1 8 10-12h-9l1-8z", // lightning
  "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z", // people
  "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z", // chart
  "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z", // copy
  "M21 18v1c0 1.1-.9 2-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14c1.1 0 2 .9 2 2v1", // box
];

// Generate 50+ positions scattered across the page
function generateDoodles(): { path: string; x: number; y: number }[] {
  const result: { path: string; x: number; y: number }[] = [];
  // Grid with jitter
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 7; col++) {
      const pathIdx = (row * 7 + col) % PATHS.length;
      const jitterX = ((row * 3 + col * 7) % 11) - 5;
      const jitterY = ((col * 5 + row * 3) % 9) - 4;
      result.push({
        path: PATHS[pathIdx],
        x: Math.max(1, Math.min(97, col * 15 + 3 + jitterX)),
        y: Math.max(1, Math.min(97, row * 13 + 2 + jitterY)),
      });
    }
  }
  return result;
}

const DOODLES = generateDoodles();

export function DoodleBackground() {
  const [mouse, setMouse] = useState({ x: 50, y: 50 });

  // Listen on document mousemove — works regardless of z-index layering
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      setMouse({
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      });
    };
    window.addEventListener("mousemove", handler, { passive: true });
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 pointer-events-none">
        {DOODLES.map((d, i) => {
          const layer = i % 3;
          const speed = layer === 0 ? 0.4 : layer === 1 ? 0.2 : 0.08;
          const dir = i % 2 === 0 ? 1 : -1;
          const tx = (mouse.x - 50) * speed * dir;
          const ty = (mouse.y - 50) * speed * dir * 0.6;
          const size = layer === 0 ? 30 : layer === 1 ? 24 : 18;
          const opacity = layer === 0 ? 0.06 : layer === 1 ? 0.04 : 0.025;
          const rotation = (i * 37) % 360;
          return (
            <svg
              key={i}
              viewBox="0 0 24 24"
              className="absolute transition-transform duration-300 ease-out"
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
    </div>
  );
}
