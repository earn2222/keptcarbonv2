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

  const W = isMobile ? 450 : 940;
  const H = isMobile ? 300 : 660;
  const PL = isMobile ? 25 : 38;
  const PT = isMobile ? 35 : 36;
  const PB = isMobile ? 75 : 58;
  const PR = isMobile ? 25 : 38;
  const iW = W - PL - PR;
  const iH = H - PT - PB;

  const maxCo2 = Math.max(...pts.map((p) => p.co2), 1) * 1.15;
  const barW = iW / pts.length - (isMobile ? 1.5 : 4);
  const gap = isMobile ? 1.5 : 4;

  // Find cycle boundaries for labels
  const cycleStarts: { idx: number; name: string; color: string }[] = [];
  pts.forEach((p, i) => {
    if (i === 0 || pts[i - 1].cycle !== p.cycle) {
      const col = getCycleColor(p.cycle);
      cycleStarts.push({ idx: i, name: col.name, color: col.bar });
    }
  });

  // Calculate line path points
  const linePoints = pts.map((p, i) => {
    const bh = Math.max((p.co2 / maxCo2) * iH, 2);
    const x = PL + i * (barW + gap) + barW / 2;
    const y = PT + iH - bh;
    return { x, y };
  });

  // Simple spline or line path
  const linePath = linePoints.map((p, i) => (i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`)).join(" ");

  return (
    <div style={{ background: "linear-gradient(135deg,#f8fafc,#f1f5f9)", borderRadius: 16, padding: isMobile ? "12px 6px 8px" : "6px 4px 4px", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 6px 20px -4px rgba(0,0,0,0.07)" }}>
      {/* Legend — compact single row */}
      <div style={{ 
        display: "flex", 
        flexWrap: "nowrap",
        overflowX: "auto",
        gap: "6px", 
        padding: isMobile ? "0 8px 10px" : "0 8px 6px", 
        justifyContent: "center",
        msOverflowStyle: "none",
        scrollbarWidth: "none"
      }}>
        {cycleStarts.map((cs, i) => (
          <div key={i} style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: 4, 
            fontSize: 10, 
            fontWeight: 600, 
            color: "#64748b", 
            background: "rgba(255,255,255,0.7)", 
            padding: "3px 8px", 
            borderRadius: 20, 
            border: "1px solid rgba(0,0,0,0.04)",
            flexShrink: 0,
            whiteSpace: "nowrap"
          }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: cs.color }} />
            {cs.name} ({pts[cs.idx].age}–{i < cycleStarts.length - 1 ? pts[cycleStarts[i + 1].idx - 1].age : pts[pts.length - 1].age})
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: isMobile ? Math.max(W, pts.length * 18) : "100%", height: "auto", display: "block", overflow: "visible" }}
        >
          <defs>
            {CYCLE_COLORS.map((c, i) => (
              <linearGradient key={i} id={`cycleGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.bar} stopOpacity="1" />
                <stop offset="100%" stopColor={c.bar} stopOpacity="0.75" />
              </linearGradient>
            ))}
            <filter id="barShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
            </filter>
            <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t}
              x1={PL} y1={PT + t * iH} x2={PL + iW} y2={PT + t * iH}
              stroke="rgba(0,0,0,0.05)" strokeWidth={1}
              strokeDasharray={t < 1 && t > 0 ? "4,4" : undefined}
            />
          ))}

          {/* Bars */}
          {pts.map((p, i) => {
            const bh = Math.max((p.co2 / maxCo2) * iH, 2);
            const x = PL + i * (barW + gap);
            const y = PT + iH - bh;
            const col = getCycleColor(p.cycle);
            const isHov = hoverIdx === i;
            const cycleClamp = Math.min(Math.max(0, p.cycle), CYCLE_COLORS.length - 1);
            
            // +- indicators (error bars)
            const errorSize = bh * 0.08; // 8% error margin
            const lineX = x + barW / 2;

            return (
              <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer" }}>
                {/* Hover effect bg */}
                {isHov && (
                  <rect x={x - 2} y={PT} width={barW + 4} height={iH} rx={4}
                    fill={col.bar} opacity={0.06} />
                )}
                
                {/* Main Bar */}
                <rect x={x} y={y} width={barW} height={bh} rx={isMobile ? 2 : 4}
                  fill={`url(#cycleGrad${cycleClamp})`}
                  filter={isHov ? "url(#barShadow)" : undefined}
                  style={{ transition: "all 0.2s" }}
                />

                {/* +- (Error Bars) */}
                <line 
                  x1={lineX} y1={y - errorSize} x2={lineX} y2={y + errorSize} 
                  stroke={isHov ? col.bar : "#94a3b8"} strokeWidth={1} opacity={0.6} 
                />
                <line 
                  x1={lineX - 2} y1={y - errorSize} x2={lineX + 2} y2={y - errorSize} 
                  stroke={isHov ? col.bar : "#94a3b8"} strokeWidth={1} opacity={0.6} 
                />
                <line 
                  x1={lineX - 2} y1={y + errorSize} x2={lineX + 2} y2={y + errorSize} 
                  stroke={isHov ? col.bar : "#94a3b8"} strokeWidth={1} opacity={0.6} 
                />
              </g>
            );
          })}

          {/* Trend Line */}
          <path 
            d={linePath} 
            fill="none" 
            stroke="url(#lineGrad)" 
            strokeWidth={2.5} 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            opacity={0.8}
            style={{ pointerEvents: "none" }}
          />
          
          {/* Trend Line Points */}
          {linePoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#fff" stroke={getCycleColor(pts[i].cycle).bar} strokeWidth={1.5} opacity={0.9} style={{ pointerEvents: "none" }} />
          ))}

          {/* X-axis age labels */}
          {pts.map((p, i) => {
            const showLabel = p.age === pts[0].age || p.age === pts[pts.length - 1].age || p.age % 7 === 0;
            if (!showLabel) return null;
            const x = PL + i * (barW + gap) + barW / 2;
            return (
              <g key={i}>
                <text x={x} y={PT + iH + 18} textAnchor="middle"
                  fontSize={isMobile ? 10 : 12} fontWeight={800}
                  fill={getCycleColor(p.cycle).bar}>
                  {p.age} ปี
                </text>
                <text x={x} y={PT + iH + (isMobile ? 32 : 34)} textAnchor="middle"
                  fontSize={isMobile ? 9 : 10} fill="#64748b" fontWeight={500}>
                  {p.yearBE}
                </text>
              </g>
            );
          })}

          {/* Y-axis labels */}
          <text x={PL - 5} y={PT + 4} textAnchor="end" fontSize={10} fill="#94a3b8" fontWeight={600}>tCO₂</text>

          {/* Tooltip */}
          {hoverIdx !== null && (() => {
            const p = pts[hoverIdx];
            const col = getCycleColor(p.cycle);
            const bh = Math.max((p.co2 / maxCo2) * iH, 2);
            const x = PL + hoverIdx * (barW + gap) + barW / 2;
            const y = PT + iH - bh;
            const ttW = 120, ttH = 64;
            const ttX = Math.min(Math.max(x - ttW / 2, 4), W - ttW - 4);
            const ttY = Math.max(y - ttH - 12, 4);
            return (
              <g pointerEvents="none">
                <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={12} fill="#1e293b" style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.3))" }} />
                <text x={ttX + ttW / 2} y={ttY + 18} textAnchor="middle" fontSize={11} fill={col.bar} fontWeight={800}>
                  {col.name} · {p.age} ปี
                </text>
                <text x={ttX + ttW / 2} y={ttY + 38} textAnchor="middle" fontSize={15} fill="#fff" fontWeight={900}>
                  ±{p.co2.toLocaleString("th-TH", { maximumFractionDigits: 1 })}
                </text>
                <text x={ttX + ttW / 2} y={ttY + 54} textAnchor="middle" fontSize={10} fill="#94a3b8" fontWeight={600}>
                   ตันคาร์บอน (tCO₂)
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
