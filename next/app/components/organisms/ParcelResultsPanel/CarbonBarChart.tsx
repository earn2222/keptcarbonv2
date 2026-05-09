"use client";
import { useState } from "react";

// Colors for each rubber plantation cycle (~27 years each)
const CYCLE_COLORS = [
  { bar: "#10b981", bg: "rgba(16,185,129,0.12)", label: "#065f46", name: "รอบปลูกที่ 1" },
  { bar: "#3b82f6", bg: "rgba(59,130,246,0.12)", label: "#1e40af", name: "รอบปลูกที่ 2" },
  { bar: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "#92400e", name: "รอบปลูกที่ 3" },
  { bar: "#ec4899", bg: "rgba(236,72,153,0.12)", label: "#9d174d", name: "รอบปลูกที่ 4" },
];

export const CUT_AGE = 27;   // โค่นและปลูกใหม่ที่ 27 ปี
export const TOTAL_PROJ_YEARS = 35; // จำลองไปข้างหน้า 35 ปี

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
  const pts: BarPoint[] = [];
  let continuousAge = startAge;

  for (let i = 0; i < TOTAL_PROJ_YEARS; i++) {
    if (continuousAge > 35) break;

    const plantCycle = continuousAge > CUT_AGE ? 1 : 0;

    pts.push({
      age: continuousAge,
      yearBE: startYearBE + i,
      co2: carbonCo2(continuousAge, trees, spacing),
      cycle: Math.min(plantCycle, CYCLE_COLORS.length - 1),
      cycleAge: continuousAge,
    });
    continuousAge++;
  }
  return pts;
}

export function CarbonBarChart({
  pts,
  isMobile,
  title = "ปริมาณการกักเก็บคาร์บอนสะสม",
}: {
  pts: BarPoint[];
  isMobile?: boolean;
  title?: string;
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

  // Find plantation-cycle boundaries (รอบปลูก)
  const cycleStarts: { idx: number; name: string; color: string; yearStart: number }[] = [];
  pts.forEach((p, i) => {
    if (i === 0 || pts[i - 1].cycle !== p.cycle) {
      const col = getCycleColor(p.cycle);
      cycleStarts.push({ idx: i, name: col.name, color: col.bar, yearStart: p.yearBE });
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
    <div style={{ background: "linear-gradient(135deg,#f8fafc,#f1f5f9)", borderRadius: 16, padding: isMobile ? "12px 6px 8px" : "12px 10px 8px", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 6px 20px -4px rgba(0,0,0,0.07)" }}>
      {/* Chart Title */}
      {title && (
        <div style={{
          textAlign: "center",
          fontSize: isMobile ? 14 : 16,
          fontWeight: 800,
          color: "#334155",
          marginBottom: 10,
        }}>
          {title}
        </div>
      )}

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

          {/* Cut-line dividers between plantation cycles */}
          {cycleStarts.slice(1).map((cs) => {
            const x = PL + cs.idx * (barW + gap) - gap / 2;
            return (
              <g key={cs.idx} pointerEvents="none">
                <line x1={x} y1={PT - 8} x2={x} y2={PT + iH + 6}
                  stroke={cs.color} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.5} />
                <rect x={x - 42} y={PT - 24} width={84} height={20} rx={10} fill={cs.color} opacity={0.85} />
                <text x={x} y={PT - 10} textAnchor="middle" fontSize={12} fill="#fff" fontWeight={800}>
                  โค่น/ปลูกใหม่
                </text>
              </g>
            );
          })}

          {/* X-axis labels: show at cycle starts + every 5 years */}
          {pts.map((p, i) => {
            const isCycleStart = cycleStarts.some(cs => cs.idx === i);
            const showLabel = isCycleStart || p.age === CUT_AGE || (p.age % 5 === 0);
            if (!showLabel) return null;
            const x = PL + i * (barW + gap) + barW / 2;
            return (
              <g key={i}>
                <text x={x} y={PT + iH + 20} textAnchor="middle"
                  fontSize={isMobile ? 11 : 13} fontWeight={isCycleStart ? 800 : 600}
                  fill={getCycleColor(p.cycle).bar}>
                  {isCycleStart && p.age === 1 ? "ปี 1" : `${p.age} ปี`}
                </text>
                <text x={x} y={PT + iH + (isMobile ? 34 : 38)} textAnchor="middle"
                  fontSize={isMobile ? 10 : 11} fill="#94a3b8" fontWeight={500}>
                  {p.yearBE}
                </text>
              </g>
            );
          })}

          {/* Y-axis labels */}
          <text x={PL - 5} y={PT + 4} textAnchor="end" fontSize={12} fill="#94a3b8" fontWeight={600}>tCO₂</text>

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
