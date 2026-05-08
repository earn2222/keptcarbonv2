"use client";
import { useState } from "react";

// Colors for each 7-year cycle
const CYCLE_COLORS = [
  { bar: "#10b981", bg: "rgba(16,185,129,0.12)", label: "#065f46", name: "รอบที่ 1" },
  { bar: "#3b82f6", bg: "rgba(59,130,246,0.12)", label: "#1e40af", name: "รอบที่ 2" },
  { bar: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "#92400e", name: "รอบที่ 3" },
  { bar: "#ec4899", bg: "rgba(236,72,153,0.12)", label: "#9d174d", name: "รอบที่ 4" },
  { bar: "#8b5cf6", bg: "rgba(139,92,246,0.12)", label: "#4c1d95", name: "รอบที่ 5" },
];

const getCycleColor = (cycle: number) => CYCLE_COLORS[Math.min(Math.max(0, cycle), CYCLE_COLORS.length - 1)];

function carbonCo2(age: number, trees: number, spacing: string): number {
  // Adjust density based on spacing
  const spacingMap: Record<string, number> = {
    "2.5*8": 80, "3*7": 76, "2.5*7": 91, "3*6": 89,
  };
  const treesPerRai = spacingMap[spacing] || 80;
  const effectiveTrees = trees > 0 ? trees : treesPerRai;
  const H = Math.min(2.0 + 1.8 * age, 28);
  const D = Math.min(3 + 4.5 * age, 60);
  const AGB = 0.1284 * D * D * H * 0.001;
  return (AGB + AGB * 0.26) * 0.47 * 3.67 * effectiveTrees;
}

type BarPoint = { age: number; yearBE: number; co2: number; cycle: number; cycleAge: number };

export function buildBarPoints(
  startAge: number,
  startYearBE: number,
  trees: number,
  spacing: string
): BarPoint[] {
  const MAX_AGE = 35;
  const pts: BarPoint[] = [];
  for (let age = startAge; age <= MAX_AGE; age++) {
    const cycleNum = Math.floor((age - 1) / 7); // 0-indexed cycle
    const cycleAge = ((age - 1) % 7) + 1; // 1-7 within cycle
    pts.push({
      age,
      yearBE: startYearBE + (age - startAge),
      co2: carbonCo2(age, trees, spacing),
      cycle: Math.min(cycleNum, CYCLE_COLORS.length - 1),
      cycleAge,
    });
  }
  return pts;
}

export function CarbonBarChart({
  pts,
  isMobile,
}: {
  pts: BarPoint[];
  isMobile?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!pts.length) return null;

  const W = isMobile ? 380 : 700;
  const H = isMobile ? 280 : 340;
  const PL = isMobile ? 8 : 12;
  const PT = 36;
  const PB = isMobile ? 60 : 54;
  const PR = 8;
  const iW = W - PL - PR;
  const iH = H - PT - PB;

  const maxCo2 = Math.max(...pts.map((p) => p.co2), 1);
  const barW = iW / pts.length - (isMobile ? 1 : 2);
  const gap = isMobile ? 1 : 2;

  // Find cycle boundaries for labels
  const cycleStarts: { idx: number; name: string; color: string }[] = [];
  pts.forEach((p, i) => {
    if (i === 0 || pts[i - 1].cycle !== p.cycle) {
      const col = getCycleColor(p.cycle);
      cycleStarts.push({ idx: i, name: col.name, color: col.bar });
    }
  });

  return (
    <div style={{ background: "linear-gradient(135deg,#f0fdf4,#ecfdf5)", borderRadius: 16, padding: "12px 4px 8px", overflowX: "auto" }}>
      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 8px 10px", justifyContent: "center" }}>
        {cycleStarts.map((cs, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#374151" }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: cs.color }} />
            {cs.name} ({pts[cs.idx].age}–{i < cycleStarts.length - 1 ? pts[cycleStarts[i + 1].idx - 1].age : pts[pts.length - 1].age} ปี)
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: Math.max(W, pts.length * (isMobile ? 16 : 22)), height: H, display: "block" }}
        >
          <defs>
            {CYCLE_COLORS.map((c, i) => (
              <linearGradient key={i} id={`cycleGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.bar} stopOpacity="0.95" />
                <stop offset="100%" stopColor={c.bar} stopOpacity="0.6" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t}
              x1={PL} y1={PT + t * iH} x2={PL + iW} y2={PT + t * iH}
              stroke="rgba(0,0,0,0.06)" strokeWidth={t === 1 ? 1 : 0.5}
              strokeDasharray={t < 1 ? "3,3" : undefined}
            />
          ))}

          {/* Cycle separator lines */}
          {cycleStarts.slice(1).map((cs) => {
            const x = PL + cs.idx * (barW + gap);
            return (
              <line key={cs.idx}
                x1={x - gap / 2} y1={PT - 8} x2={x - gap / 2} y2={PT + iH + 4}
                stroke={getCycleColor(pts[cs.idx].cycle).bar}
                strokeWidth={1.5} strokeDasharray="4,3" opacity={0.4}
              />
            );
          })}

          {/* Bars */}
          {pts.map((p, i) => {
            const bh = Math.max((p.co2 / maxCo2) * iH, 2);
            const x = PL + i * (barW + gap);
            const y = PT + iH - bh;
            const col = getCycleColor(p.cycle);
            const isHov = hoverIdx === i;
            const cycleClamp = Math.min(Math.max(0, p.cycle), CYCLE_COLORS.length - 1);
            return (
              <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer" }}>
                {/* Hover glow */}
                {isHov && (
                  <rect x={x - 2} y={y - 4} width={barW + 4} height={bh + 4} rx={4}
                    fill={col.bar} opacity={0.18} />
                )}
                <rect x={x} y={y} width={barW} height={bh} rx={isMobile ? 2 : 3}
                  fill={`url(#cycleGrad${cycleClamp})`}
                  opacity={isHov ? 1 : 0.85}
                />
                {/* Cycle renewal marker (age 8, 15, 22, 29) */}
                {p.cycleAge === 1 && p.age > 1 && (
                  <circle cx={x + barW / 2} cy={y - 8} r={3} fill={col.bar} opacity={0.7} />
                )}
              </g>
            );
          })}

          {/* X-axis age labels (every 7 years + start) */}
          {pts.map((p, i) => {
            const showLabel = p.age === pts[0].age || p.age % 7 === 0;
            if (!showLabel) return null;
            const x = PL + i * (barW + gap) + barW / 2;
            return (
              <g key={i}>
                <text x={x} y={PT + iH + 16} textAnchor="middle"
                  fontSize={isMobile ? 10 : 11} fontWeight={700}
                  fill={getCycleColor(p.cycle).bar}>
                  อายุ {p.age}
                </text>
                <text x={x} y={PT + iH + (isMobile ? 30 : 29)} textAnchor="middle"
                  fontSize={isMobile ? 9 : 9.5} fill="#94a3b8">
                  พ.ศ.{p.yearBE}
                </text>
              </g>
            );
          })}

          {/* Tooltip */}
          {hoverIdx !== null && (() => {
            const p = pts[hoverIdx];
            const col = getCycleColor(p.cycle);
            const bh = Math.max((p.co2 / maxCo2) * iH, 2);
            const x = PL + hoverIdx * (barW + gap) + barW / 2;
            const y = PT + iH - bh;
            const ttW = 110, ttH = 58;
            const ttX = Math.min(Math.max(x - ttW / 2, 0), W - ttW - 2);
            const ttY = Math.max(y - ttH - 8, 2);
            return (
              <g pointerEvents="none">
                <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={8} fill="#0f172a" opacity={0.94} />
                <text x={ttX + ttW / 2} y={ttY + 15} textAnchor="middle" fontSize={10} fill={col.bar} fontWeight={700}>
                  {col.name} · อายุ {p.age} ปี
                </text>
                <text x={ttX + ttW / 2} y={ttY + 32} textAnchor="middle" fontSize={13} fill="#fff" fontWeight={800}>
                  {p.co2.toLocaleString("th-TH", { maximumFractionDigits: 1 })} tCO₂
                </text>
                <text x={ttX + ttW / 2} y={ttY + 48} textAnchor="middle" fontSize={9.5} fill="#94a3b8">
                  พ.ศ. {p.yearBE}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}

export { carbonCo2 };
export type { BarPoint };
