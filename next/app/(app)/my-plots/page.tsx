"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

const HERO_BG =
  "radial-gradient(1200px 500px at -10% -10%, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0) 60%)," +
  "radial-gradient(900px 450px at 110% 0%, rgba(13,148,136,0.12) 0%, rgba(13,148,136,0) 58%)," +
  "radial-gradient(700px 360px at 30% 120%, rgba(22,163,74,0.1) 0%, rgba(22,163,74,0) 55%)," +
  "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.9) 100%)";

function carbonCo2(age: number, trees: number): number {
  const H = Math.min(2.0 + 1.8 * age, 28);
  const D = Math.min(3 + 4.5 * age, 60);
  const AGB = 0.1284 * D * D * H * 0.001;
  return (AGB + AGB * 0.26) * 0.47 * 3.67 * trees;
}

function fmtCompact(v: number): string {
  if (v >= 10000) return Math.round(v / 1000) + "k";
  if (v >= 1000) return (v / 1000).toFixed(1) + "k";
  return v.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

type Forecast = { yr3: number; yr5: number; yr7: number };

type SavedPlot = {
  id: string;
  name: string;
  areaRai: number;
  carbonTotal: number;
  rubberAge: number;
  plantYearBE?: number;
  trees?: number;
  confidence?: number;
  ownerName?: string;
  province?: string;
  date: string;
  geojson?: unknown;
  boundaryGeojson?: unknown;
  forecast?: Forecast;
};

// Smooth cubic bezier path builder (module-level, not inside component)
function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 2) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], cur = pts[i];
    const cp1x = prev.x + (cur.x - prev.x) * 0.45;
    const cp2x = cur.x - (cur.x - prev.x) * 0.45;
    d += ` C${cp1x.toFixed(2)},${prev.y.toFixed(2)} ${cp2x.toFixed(2)},${cur.y.toFixed(2)} ${cur.x.toFixed(2)},${cur.y.toFixed(2)}`;
  }
  return d;
}

function ForecastBody({
  milestones,
  chartPts,
  base,
  maxCo2,
}: {
  milestones: { label: string; co2: number; yr: number }[];
  chartPts: { yr: number; label: string; co2: number }[];
  base: number;
  maxCo2: number;
}) {
  const [view, setView] = useState<"timeline" | "chart">("timeline");
  const [hoveredPt, setHoveredPt] = useState<number | null>(null);

  // Stable IDs for SVG gradients (safe for SSR hydration)
  const rawId = useId();
  const uid = rawId.replace(/:/g, "-");

  // SVG dimensions
  const W = 340, H = 110, PL = 8, PT = 18, PB = 28;
  const iW = W - PL * 2, iH = H - PT - PB;
  const n = chartPts.length;

  const vals = chartPts.length > 0 ? chartPts.map(p => p.co2) : [0];
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals, 1);
  const rng = maxV - minV || maxV * 0.1 || 1;

  const xi = (i: number) => PL + (n > 1 ? i / (n - 1) : 0.5) * iW;
  const yi = (v: number) => PT + (1 - (v - minV) / rng) * iH;

  const svgPts = chartPts.map((p, i) => ({ x: xi(i), y: yi(p.co2), ...p }));
  const linePath = buildSmoothPath(svgPts);
  const areaPath = svgPts.length > 0
    ? `${linePath} L${xi(n - 1).toFixed(2)},${(PT + iH).toFixed(2)} L${PL.toFixed(2)},${(PT + iH).toFixed(2)} Z`
    : "";

  const hp = hoveredPt !== null ? svgPts[hoveredPt] ?? null : null;

  return (
    <>
      {/* Toggle button */}
      <div style={{ padding: "8px 16px 0", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => setView(v => v === "timeline" ? "chart" : "timeline")}
          title={view === "timeline" ? "ดูกราฟรายปี" : "ดู Timeline"}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
            borderRadius: 8, cursor: "pointer", fontSize: 10, fontWeight: 700,
            border: "1.5px solid rgba(16,185,129,0.35)",
            background: view === "chart" ? "rgba(16,185,129,0.12)" : "transparent",
            color: "#059669", transition: "background 0.15s",
          }}
        >
          <i className={`bi ${view === "timeline" ? "bi-graph-up" : "bi-calendar3"}`} style={{ fontSize: 11 }} />
          {view === "timeline" ? "กราฟเส้น" : "Timeline"}
        </button>
      </div>

      {/* Timeline view */}
      {view === "timeline" && (
        <div style={{ padding: "12px 16px 12px", display: "flex", gap: 0, alignItems: "stretch" }}>
          {milestones.map((m, i) => {
            const isFirst = i === 0;
            const isLast = i === milestones.length - 1;
            const changeFromBase = isFirst ? 0 : m.co2 - base;
            const changePct = base > 0 ? (changeFromBase / base) * 100 : 0;
            const barFill = maxCo2 > 0 ? Math.round((m.co2 / maxCo2) * 100) : 0;
            const dotColor = isFirst ? "#059669" : isLast ? "#16a34a" : "#10b981";
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                {!isLast && (
                  <div style={{ position: "absolute", top: 10, left: "50%", right: "-50%", height: 2, background: "linear-gradient(90deg,rgba(16,185,129,0.35),rgba(16,185,129,0.1))", zIndex: 0 }} />
                )}
                <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, background: isFirst ? dotColor : "#fff", border: `2.5px solid ${dotColor}`, boxShadow: isFirst ? "0 0 0 4px rgba(5,150,105,0.12)" : "none", zIndex: 1, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isFirst && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ fontSize: 9.5, fontWeight: isFirst ? 700 : 500, color: isFirst ? "#059669" : "#64748b", marginBottom: 3, textAlign: "center" }}>{m.label}</div>
                <div style={{ fontSize: isFirst ? 13 : 12, fontWeight: 800, color: isFirst ? "#059669" : isLast ? "#15803d" : "#0f172a", textAlign: "center" }}>{fmtCompact(m.co2)}</div>
                <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 1, textAlign: "center" }}>tCO₂</div>
                {!isFirst && changeFromBase !== 0 && (
                  <div style={{ marginTop: 4, fontSize: 8.5, fontWeight: 700, color: changeFromBase > 0 ? "#16a34a" : "#dc2626", background: changeFromBase > 0 ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)", padding: "1px 5px", borderRadius: 6, textAlign: "center" }}>
                    {changeFromBase > 0 ? "+" : ""}{changePct.toFixed(1)}%
                  </div>
                )}
                <div style={{ marginTop: 6, width: "70%", height: 3, borderRadius: 3, background: "rgba(16,185,129,0.1)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${barFill}%`, background: isFirst ? "linear-gradient(90deg,#059669,#10b981)" : isLast ? "linear-gradient(90deg,#10b981,#34d399)" : "rgba(16,185,129,0.5)", transition: "width 0.4s ease" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Line chart view */}
      {view === "chart" && (
        <div style={{ padding: "10px 16px 12px" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: H, display: "block", overflow: "visible" }}
          >
            <defs>
              <linearGradient id={`areaGrad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.30" />
                <stop offset="60%" stopColor="#10b981" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`lineGrad-${uid}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#059669" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
              <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#10b981" floodOpacity="0.45" />
              </filter>
              <filter id={`dotGlow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#34d399" floodOpacity="0.6" />
              </filter>
            </defs>

            {/* Subtle horizontal grid lines */}
            {[0, 0.5, 1].map(t => (
              <line key={t}
                x1={PL} y1={PT + t * iH} x2={PL + iW} y2={PT + t * iH}
                stroke="rgba(16,185,129,0.12)"
                strokeWidth={t === 0 || t === 1 ? 1 : 0.6}
                strokeDasharray={t === 0.5 ? "4 3" : undefined}
              />
            ))}

            {/* Hover vertical guide */}
            {hp && (
              <line
                x1={hp.x} y1={PT} x2={hp.x} y2={PT + iH}
                stroke="rgba(16,185,129,0.25)" strokeWidth={1.5} strokeDasharray="4 3"
              />
            )}

            {/* Area fill */}
            <path d={areaPath} fill={`url(#areaGrad-${uid})`} />

            {/* Line with gradient stroke */}
            <path
              d={linePath}
              fill="none"
              stroke={`url(#lineGrad-${uid})`}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#glow-${uid})`}
            />

            {/* Invisible wide hit targets */}
            {svgPts.map((p, i) => (
              <rect key={i}
                x={i === 0 ? PL : (svgPts[i - 1].x + p.x) / 2}
                y={PT}
                width={
                  i === 0
                    ? (svgPts[1] ? (svgPts[1].x + p.x) / 2 - PL : iW)
                    : i === n - 1
                    ? PL + iW - (svgPts[i - 1].x + p.x) / 2
                    : p.x - svgPts[i - 1].x
                }
                height={iH}
                fill="transparent"
                style={{ cursor: "crosshair" }}
                onMouseEnter={() => setHoveredPt(i)}
                onMouseLeave={() => setHoveredPt(null)}
              />
            ))}

            {/* Dots */}
            {svgPts.map((p, i) => {
              const isHov = hoveredPt === i;
              const isFirst = i === 0;
              const isLast = i === n - 1;
              return (
                <g key={i}>
                  {isHov && (
                    <circle cx={p.x} cy={p.y} r={10}
                      fill="rgba(16,185,129,0.15)"
                    />
                  )}
                  <circle
                    cx={p.x} cy={p.y}
                    r={isHov ? 5.5 : isFirst || isLast ? 4 : 3}
                    fill={isHov ? "#34d399" : isFirst ? "#059669" : "#fff"}
                    stroke={isFirst ? "#059669" : "#10b981"}
                    strokeWidth={isHov ? 2.5 : 2}
                    filter={isHov ? `url(#dotGlow-${uid})` : undefined}
                    style={{ transition: "r 0.15s ease" }}
                  />
                </g>
              );
            })}

            {/* Year labels along x-axis */}
            {svgPts.map((p, i) => (
              <text key={i} x={p.x} y={H - 6}
                textAnchor="middle" fontSize={8}
                fontWeight={i === 0 ? 700 : 400}
                fill={i === 0 ? "#059669" : "#94a3b8"}
              >
                {p.label}
              </text>
            ))}

            {/* Tooltip */}
            {hp && (() => {
              const isFirst = hoveredPt === 0;
              const changeAbs = hp.co2 - base;
              const changePct = base > 0 ? (changeAbs / base) * 100 : 0;
              const ttW = 112, ttH = isFirst ? 38 : 52;
              const ttX = Math.min(Math.max(hp.x - ttW / 2, PL), PL + iW - ttW);
              const ttY = hp.y - ttH - 12;
              return (
                <g pointerEvents="none">
                  {/* Backdrop blur effect via rect */}
                  <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={9}
                    fill="#064e3b" opacity={0.95}
                  />
                  <text x={ttX + ttW / 2} y={ttY + 13}
                    textAnchor="middle" fontSize={8.5} fill="#6ee7b7" fontWeight={600}
                  >
                    {isFirst ? "ณ ปัจจุบัน" : `อีก ${hp.yr} ปีข้างหน้า`}
                  </text>
                  <text x={ttX + ttW / 2} y={ttY + 27}
                    textAnchor="middle" fontSize={11} fill="#ffffff" fontWeight={800}
                  >
                    {hp.co2.toLocaleString("th-TH", { maximumFractionDigits: 1 })} tCO₂
                  </text>
                  {!isFirst && (
                    <text x={ttX + ttW / 2} y={ttY + 42}
                      textAnchor="middle" fontSize={8.5}
                      fill={changePct >= 0 ? "#34d399" : "#f87171"} fontWeight={700}
                    >
                      {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}% จากปัจจุบัน
                    </text>
                  )}
                  {/* Arrow */}
                  <polygon
                    points={`${hp.x - 5},${ttY + ttH} ${hp.x + 5},${ttY + ttH} ${hp.x},${ttY + ttH + 6}`}
                    fill="#064e3b" opacity={0.95}
                  />
                </g>
              );
            })()}
          </svg>
          <div style={{ textAlign: "center", fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
            hover บนเส้นเพื่อดูรายละเอียด · หน่วย tCO₂
          </div>
        </div>
      )}
    </>
  );
}

function ForecastSection({
  rubberAge,
  trees,
  carbonTotal,
  forecast,
}: {
  rubberAge: number;
  trees: number;
  carbonTotal: number;
  forecast?: Forecast;
}) {
  const canCompute = trees > 0 && rubberAge > 0;

  const milestones: { label: string; co2: number; yr: number }[] = [];
  if (canCompute) {
    milestones.push({ label: "ปัจจุบัน", co2: carbonTotal, yr: 0 });
    milestones.push({ label: "+1 ปี", co2: carbonCo2(rubberAge + 1, trees), yr: 1 });
    milestones.push({ label: "+3 ปี", co2: carbonCo2(rubberAge + 3, trees), yr: 3 });
    milestones.push({ label: "+5 ปี", co2: carbonCo2(rubberAge + 5, trees), yr: 5 });
    milestones.push({ label: "+7 ปี", co2: carbonCo2(rubberAge + 7, trees), yr: 7 });
  } else if (forecast && (forecast.yr3 > 0 || forecast.yr5 > 0 || forecast.yr7 > 0)) {
    milestones.push({ label: "ปัจจุบัน", co2: carbonTotal, yr: 0 });
    if (forecast.yr3 > 0) milestones.push({ label: "+3 ปี", co2: forecast.yr3, yr: 3 });
    if (forecast.yr5 > 0) milestones.push({ label: "+5 ปี", co2: forecast.yr5, yr: 5 });
    if (forecast.yr7 > 0) milestones.push({ label: "+7 ปี", co2: forecast.yr7, yr: 7 });
  }

  if (milestones.length === 0) {
    return (
      <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(148,163,184,0.05)", borderRadius: 10, fontSize: 11, color: "#94a3b8", textAlign: "center", border: "1px dashed rgba(148,163,184,0.2)" }}>
        <i className="bi bi-graph-up me-1" /> ไม่มีข้อมูลพยากรณ์ (บันทึกใหม่เพื่อรับข้อมูลนี้)
      </div>
    );
  }

  const base = milestones[0].co2;
  const last = milestones[milestones.length - 1].co2;
  const growthPct = base > 0 ? ((last - base) / base) * 100 : 0;
  const maxCo2 = Math.max(...milestones.map(m => m.co2), 1);

  const chartPts = canCompute
    ? Array.from({ length: 8 }, (_, i) => ({
        yr: i,
        label: i === 0 ? "ปัจจุบัน" : `+${i}`,
        co2: i === 0 ? carbonTotal : carbonCo2(rubberAge + i, trees),
      }))
    : milestones.map(m => ({ yr: m.yr, label: m.label, co2: m.co2 }));

  return (
    <div style={{ marginTop: 14, borderRadius: 14, border: "1px solid rgba(16,185,129,0.18)", overflow: "hidden", background: "#fff" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", background: "linear-gradient(135deg,rgba(16,185,129,0.07) 0%,rgba(5,150,105,0.04) 100%)", borderBottom: "1px solid rgba(16,185,129,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", display: "flex", alignItems: "center", gap: 6 }}>
          <i className="bi bi-graph-up-arrow" style={{ fontSize: 13 }} />
          พยากรณ์การกักเก็บคาร์บอน (tCO₂)
        </span>
        {growthPct > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", background: "rgba(22,163,74,0.1)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(22,163,74,0.25)", display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 9 }}>▲</span> {growthPct.toFixed(1)}% ใน {milestones[milestones.length - 1].yr} ปี
          </span>
        )}
      </div>
      <ForecastBody milestones={milestones} chartPts={chartPts} base={base} maxCo2={maxCo2} />
    </div>
  );
}

function PlotCard({ plot, onDelete }: { plot: SavedPlot; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 20,
        border: "1px solid rgba(16,185,129,0.12)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "box-shadow 0.2s ease",
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 8px 28px rgba(16,185,129,0.13)")}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.04)")}
    >
      {/* Accent bar */}
      <div style={{ height: 4, background: "linear-gradient(90deg,#059669 0%,#10b981 50%,#34d399 100%)", flexShrink: 0 }} />

      <div style={{ padding: "18px 20px", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0, flex: 1 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0,
              background: "linear-gradient(135deg,rgba(16,185,129,0.15),rgba(5,150,105,0.1))",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className="bi bi-geo-alt-fill" style={{ color: "#059669", fontSize: 17 }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {plot.name}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {plot.ownerName && <span><i className="bi bi-person me-1" />{plot.ownerName}</span>}
                {plot.province && <span><i className="bi bi-pin-map me-1" />{plot.province}</span>}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0, marginLeft: 8, textAlign: "right", lineHeight: 1.4 }}>
            {new Date(plot.date).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
          {[
            { label: "พื้นที่", val: plot.areaRai > 0 ? plot.areaRai.toFixed(2) : "—", unit: "ไร่", color: "#0d9488", bg: "rgba(13,148,136,0.07)" },
            { label: "อายุยาง", val: plot.rubberAge > 0 ? String(plot.rubberAge) : "—", unit: "ปี", color: "#0891b2", bg: "rgba(8,145,178,0.07)" },
            { label: "ต้นยาง", val: plot.trees && plot.trees > 0 ? (plot.trees >= 1000 ? Math.round(plot.trees / 1000) + "k" : String(plot.trees)) : "—", unit: "ต้น", color: "#7c3aed", bg: "rgba(124,58,237,0.07)" },
            { label: "คาร์บอน", val: plot.carbonTotal > 0 ? fmtCompact(plot.carbonTotal) : "—", unit: "tCO₂", color: "#059669", bg: "rgba(5,150,105,0.07)" },
          ].map(({ label, val, unit, color, bg }) => (
            <div key={label} style={{ borderRadius: 10, padding: "8px 4px", textAlign: "center", background: bg }}>
              <div style={{ fontSize: 15, fontWeight: 800, color }}>{val}</div>
              <div style={{ fontSize: 9, color: color + "99" }}>{unit}</div>
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Extra info */}
        {(plot.plantYearBE || plot.confidence) && (
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 12 }}>
            {plot.plantYearBE && plot.plantYearBE > 0 && (
              <div style={{ fontSize: 11, color: "#64748b" }}>
                <i className="bi bi-calendar-event me-1" style={{ color: "#0891b2" }} />
                ปีปลูก <strong style={{ color: "#0f172a" }}>พ.ศ. {plot.plantYearBE}</strong>
              </div>
            )}
            {plot.confidence && plot.confidence > 0 && (
              <div style={{ fontSize: 11, color: "#64748b" }}>
                <i className="bi bi-shield-check me-1" style={{ color: "#7c3aed" }} />
                ความมั่นใจ <strong style={{ color: "#0f172a" }}>{Math.round(plot.confidence * 100)}%</strong>
              </div>
            )}
          </div>
        )}

        {/* Forecast with chart */}
        <ForecastSection
          rubberAge={plot.rubberAge}
          trees={plot.trees ?? 0}
          carbonTotal={plot.carbonTotal}
          forecast={plot.forecast}
        />

        {/* Expand raw details */}
        <button
          onClick={() => setExpanded(p => !p)}
          style={{
            marginTop: 12, width: "100%", padding: "7px 0",
            background: "none", border: "none", borderTop: "1px dashed rgba(0,0,0,0.07)",
            cursor: "pointer", fontSize: 11, color: "#94a3b8",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}
        >
          <i className={`bi bi-chevron-${expanded ? "up" : "down"}`} />
          {expanded ? "ซ่อนรายละเอียด" : "ดูรายละเอียดเพิ่มเติม"}
        </button>

        {expanded && (
          <div style={{ paddingTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              {[
                { k: "ID", v: plot.id },
                { k: "วันที่บันทึก", v: new Date(plot.date).toLocaleString("th-TH") },
                { k: "พื้นที่ (ไร่)", v: plot.areaRai.toFixed(4) },
                { k: "อายุยาง", v: `${plot.rubberAge} ปี` },
                { k: "จำนวนต้น", v: plot.trees?.toLocaleString("th-TH") ?? "—" },
                { k: "ปีปลูก (พ.ศ.)", v: plot.plantYearBE ? String(plot.plantYearBE) : "—" },
                { k: "คาร์บอนปัจจุบัน", v: `${plot.carbonTotal.toFixed(2)} tCO₂` },
                { k: "ความมั่นใจ", v: plot.confidence ? `${Math.round(plot.confidence * 100)}%` : "—" },
              ].map(({ k, v }) => (
                <div key={k} style={{ padding: "5px 8px", background: "rgba(0,0,0,0.02)", borderRadius: 7 }}>
                  <div style={{ color: "#94a3b8", fontSize: 9 }}>{k}</div>
                  <div style={{ color: "#0f172a", fontWeight: 600, marginTop: 1, fontSize: 11, wordBreak: "break-all" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete */}
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          {confirmDelete ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#ef4444" }}>ยืนยันลบ?</span>
              <button
                onClick={onDelete}
                style={{ padding: "4px 14px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 11 }}
              >ลบ</button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ padding: "4px 12px", background: "rgba(0,0,0,0.06)", color: "#64748b", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 11 }}
              >ยกเลิก</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 3 }}
            >
              <i className="bi bi-trash3" /> ลบแปลงนี้
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyPlotsPage() {
  const { user, ready } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [plots, setPlots] = useState<SavedPlot[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("user_saved_plots");
      if (stored) setPlots(JSON.parse(stored));
    } catch {}
  }, []);

  const handleDelete = (id: string) => {
    const updated = plots.filter(p => p.id !== id);
    setPlots(updated);
    try {
      localStorage.setItem("user_saved_plots", JSON.stringify(updated));
    } catch {}
  };

  const totalArea = plots.reduce((s, p) => s + (p.areaRai || 0), 0);
  const totalCarbon = plots.reduce((s, p) => s + (p.carbonTotal || 0), 0);
  const totalForecast7 = plots.reduce((s, p) => {
    if (p.forecast?.yr7) return s + p.forecast.yr7;
    if ((p.trees ?? 0) > 0 && p.rubberAge > 0) return s + carbonCo2(p.rubberAge + 7, p.trees!);
    return s;
  }, 0);

  const filteredPlots = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return plots;
    return plots.filter(p =>
      p.name.toLowerCase().includes(term) ||
      (p.province ?? "").toLowerCase().includes(term) ||
      (p.ownerName ?? "").toLowerCase().includes(term)
    );
  }, [plots, searchTerm]);

  if (!ready || !mounted)
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fdfb" }}>
        <div className="spinner-border" style={{ color: "#10b981", width: "3rem", height: "3rem" }} role="status" />
      </div>
    );

  if (!user) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#f4fcf8", paddingTop: 100, paddingBottom: "60px", fontFamily: "'Inter','Noto Sans Thai',sans-serif" }}>
      <div className="container" style={{ maxWidth: "1100px" }}>

        {/* Hero */}
        <div style={{
          background: HERO_BG, borderRadius: 24, padding: "36px 48px", marginBottom: 24,
          border: "1px solid rgba(16,185,129,0.15)", boxShadow: "0 20px 40px rgba(0,0,0,0.03)",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -50, left: -50, width: 200, height: 200, background: "rgba(16,185,129,0.2)", filter: "blur(60px)", borderRadius: "50%", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -50, right: -50, width: 250, height: 250, background: "rgba(13,148,136,0.15)", filter: "blur(70px)", borderRadius: "50%", pointerEvents: "none" }} />

          <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 14px", background: "rgba(16,185,129,0.1)", color: "#059669", borderRadius: 50, fontSize: 12, fontWeight: 700, marginBottom: 10, border: "1px solid rgba(16,185,129,0.2)" }}>
                <i className="bi bi-folder-fill" /> ข้อมูลของฉัน
              </div>
              <h1 style={{ fontSize: 30, fontWeight: 800, color: "#064e3b", marginBottom: 8, lineHeight: 1.2 }}>
                แปลงยางพาราของฉัน
              </h1>
              <p style={{ fontSize: 14, color: "#475569", margin: "0 0 18px", lineHeight: 1.6 }}>
                จัดการและติดตามข้อมูลแปลงยาง พร้อมพยากรณ์คาร์บอนรายปีที่ 1–7
              </p>
              {/* Search */}
              <div style={{ position: "relative", maxWidth: 440 }}>
                <i className="bi bi-search" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: searchFocused ? "#059669" : "#94a3b8", fontSize: 14, pointerEvents: "none", transition: "color 0.15s" }} />
                <input
                  type="text"
                  placeholder="ค้นหาแปลง ชื่อเจ้าของ หรือจังหวัด..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  style={{
                    width: "100%", padding: "11px 38px 11px 40px",
                    borderRadius: 13, fontSize: 13, color: "#0f172a",
                    border: `2px solid ${searchFocused ? "#10b981" : "rgba(16,185,129,0.25)"}`,
                    background: "rgba(255,255,255,0.95)", outline: "none",
                    boxShadow: searchFocused ? "0 0 0 4px rgba(16,185,129,0.1)" : "0 2px 10px rgba(0,0,0,0.04)",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm("")} style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: 2, lineHeight: 1 }}>
                    <i className="bi bi-x-circle-fill" />
                  </button>
                )}
              </div>
            </div>

            <Link
              href="/map-draw"
              style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "linear-gradient(135deg,#10b981 0%,#059669 100%)", color: "#fff", padding: "13px 26px", borderRadius: 13, fontWeight: 700, fontSize: 14, textDecoration: "none", boxShadow: "0 8px 20px rgba(16,185,129,0.3)", flexShrink: 0 }}
            >
              <i className="bi bi-plus-circle" style={{ fontSize: 17 }} /> วาดแปลงใหม่
            </Link>
          </div>
        </div>

        {/* KPI Cards */}
        {plots.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 24 }}>
            {([
              { label: "แปลงทั้งหมด", val: plots.length.toLocaleString("th-TH"), unit: "แปลง", icon: "bi-map", color: "#16a34a", bg: "rgba(22,163,74,0.08)" },
              { label: "พื้นที่รวม", val: totalArea.toFixed(2), unit: "ไร่", icon: "bi-grid-fill", color: "#0d9488", bg: "rgba(13,148,136,0.08)" },
              { label: "คาร์บอนปัจจุบัน", val: fmtCompact(totalCarbon), unit: "tCO₂", icon: "bi-cloud-arrow-up-fill", color: "#059669", bg: "rgba(5,150,105,0.08)" },
              ...(totalForecast7 > 0 ? [{ label: "พยากรณ์ +7 ปี", val: fmtCompact(totalForecast7), unit: "tCO₂", icon: "bi-graph-up-arrow", color: "#7c3aed", bg: "rgba(124,58,237,0.08)" }] : []),
            ] as { label: string; val: string; unit: string; icon: string; color: string; bg: string }[]).map(({ label, val, unit, icon, color, bg }) => (
              <div key={label} style={{ background: "#fff", borderRadius: 16, padding: "16px 18px", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`bi ${icon}`} style={{ color, fontSize: 14 }} />
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{unit}</div>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {plots.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)",
            borderRadius: 24, padding: "60px 40px", textAlign: "center",
            border: "1px solid rgba(45,158,95,0.1)", boxShadow: "0 10px 30px rgba(0,0,0,0.02)",
            display: "flex", flexDirection: "column", alignItems: "center", minHeight: 320, justifyContent: "center",
          }}>
            <div style={{ width: 84, height: 84, borderRadius: "50%", background: "linear-gradient(135deg,rgba(16,185,129,0.1),rgba(13,148,136,0.1))", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, position: "relative", border: "1px solid rgba(16,185,129,0.2)" }}>
              <div style={{ position: "absolute", inset: -10, border: "1px dashed rgba(16,185,129,0.3)", borderRadius: "50%" }} />
              <i className="bi bi-map" style={{ fontSize: 36, color: "#059669" }} />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: "#064e3b", marginBottom: 8 }}>ยังไม่มีข้อมูลแปลงยาง</h3>
            <p style={{ fontSize: 13, color: "#64748b", maxWidth: 400, lineHeight: 1.6, marginBottom: 24 }}>
              เริ่มวาดแปลงบนแผนที่เพื่อตรวจจับและบันทึกข้อมูลพร้อมการพยากรณ์คาร์บอนปีที่ 1–7
            </p>
            <Link href="/map-draw" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#fff", color: "#059669", padding: "11px 22px", borderRadius: 12, fontWeight: 700, fontSize: 13, textDecoration: "none", border: "2px solid #10b981", boxShadow: "0 4px 12px rgba(16,185,129,0.1)" }}>
              <i className="bi bi-pencil-square" /> ไปหน้าวาดแปลงยาง
            </Link>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, padding: "0 2px" }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#064e3b", margin: 0 }}>
                รายการแปลงที่บันทึกแล้ว
                <span style={{ fontSize: 12, fontWeight: 400, color: "#64748b", marginLeft: 8 }}>
                  {searchTerm ? `พบ ${filteredPlots.length} จาก ${plots.length} แปลง` : `(${plots.length})`}
                </span>
              </h2>
            </div>

            {filteredPlots.length === 0 ? (
              <div style={{ textAlign: "center", padding: "44px 24px", background: "#fff", borderRadius: 20, color: "#94a3b8", fontSize: 13 }}>
                <i className="bi bi-search" style={{ fontSize: 30, display: "block", marginBottom: 8 }} />
                ไม่พบแปลงที่ตรงกับ &ldquo;<strong style={{ color: "#64748b" }}>{searchTerm}</strong>&rdquo;
                <br />
                <button onClick={() => setSearchTerm("")} style={{ marginTop: 12, padding: "5px 16px", background: "rgba(16,185,129,0.08)", color: "#059669", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                  ล้างการค้นหา
                </button>
              </div>
            ) : (
              <div className="row g-3">
                {filteredPlots.map(plot => (
                  <div key={plot.id} className="col-12 col-md-6">
                    <PlotCard plot={plot} onDelete={() => handleDelete(plot.id)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
