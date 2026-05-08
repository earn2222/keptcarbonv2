"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const HERO_BG =
  "radial-gradient(1200px 500px at -10% -10%, rgba(16,185,129,0.20) 0%, rgba(16,185,129,0) 60%)," +
  "radial-gradient(900px 450px at 110% 0%, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0) 58%)," +
  "radial-gradient(700px 360px at 30% 120%, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0) 55%)," +
  "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.86) 100%)";

function carbonCo2(age: number, trees: number): number {
  const H = Math.min(2.0 + 1.8 * age, 28);
  const D = Math.min(3 + 4.5 * age, 60);
  const AGB = 0.1284 * D * D * H * 0.001;
  return (AGB + AGB * 0.26) * 0.47 * 3.67 * trees;
}

function fmtCompact(v: number): string {
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
  userId?: string;
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
  isMobile,
}: {
  milestones: any[];
  chartPts: any[];
  base: number;
  maxCo2: number;
  isMobile?: boolean;
}) {
  const [view, setView] = useState<"timeline" | "chart">("timeline");
  const [hoveredPt, setHoveredPt] = useState<number | null>(null);

  // Stable IDs for SVG gradients (safe for SSR hydration)
  const rawId = useId();
  const uid = rawId.replace(/:/g, "-");

  // SVG dimensions - Enlarged for better desktop visibility
  const W = isMobile ? 400 : 800, H = isMobile ? 240 : 300, PL = 12, PT = 24, PB = 36;
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
        <div style={{ padding: isMobile ? "14px 10px" : "12px 16px 12px", display: "flex", gap: 0, alignItems: "stretch" }}>
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
                  <div style={{ position: "absolute", top: isMobile ? 12 : 10, left: "50%", right: "-50%", height: 2, background: "linear-gradient(90deg,rgba(16,185,129,0.35),rgba(16,185,129,0.1))", zIndex: 0 }} />
                )}
                <div style={{ width: isMobile ? 24 : 20, height: isMobile ? 24 : 20, borderRadius: "50%", flexShrink: 0, background: isFirst ? dotColor : "#fff", border: `2.5px solid ${dotColor}`, boxShadow: isFirst ? "0 0 0 4px rgba(5,150,105,0.12)" : "none", zIndex: 1, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isFirst && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ fontSize: isMobile ? 11 : 11.5, fontWeight: isFirst ? 800 : 500, color: isFirst ? "#059669" : "#64748b", marginBottom: 3, textAlign: "center" }}>{m.label}</div>
                <div style={{ fontSize: isMobile ? 16 : 14, fontWeight: 800, color: isFirst ? "#059669" : isLast ? "#15803d" : "#0f172a", textAlign: "center" }}>{fmtCompact(m.co2)}</div>
                <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 1, textAlign: "center" }}>tCO₂</div>
                {!isFirst && changeFromBase !== 0 && (
                  <div style={{ marginTop: 5, fontSize: isMobile ? 10.5 : 10, fontWeight: 700, color: changeFromBase > 0 ? "#16a34a" : "#dc2626", background: changeFromBase > 0 ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)", padding: isMobile ? "2px 6px" : "1px 5px", borderRadius: 6, textAlign: "center" }}>
                    {changeFromBase > 0 ? "+" : ""}{changePct.toFixed(1)}%
                  </div>
                )}
                <div style={{ marginTop: 8, width: "80%", height: 3.5, borderRadius: 3, background: "rgba(16,185,129,0.1)", overflow: "hidden" }}>
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
              <text key={i} x={p.x} y={H - 10}
                textAnchor="middle" fontSize={isMobile ? 12 : 13}
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
              const ttW = isMobile ? 112 : 130, ttH = isFirst ? (isMobile ? 38 : 42) : (isMobile ? 52 : 60);
              const ttX = Math.min(Math.max(hp.x - ttW / 2, PL), PL + iW - ttW);
              const ttY = hp.y - ttH - 12;
              return (
                <g pointerEvents="none">
                  {/* Backdrop blur effect via rect */}
                  <rect x={ttX} y={ttY} width={ttW + 10} height={ttH + 10} rx={9}
                    fill="#064e3b" opacity={0.95}
                  />
                  <text x={ttX + (ttW + 10) / 2} y={ttY + (isMobile ? 16 : 18)}
                    textAnchor="middle" fontSize={isMobile ? 11 : 12} fill="#6ee7b7" fontWeight={600}
                  >
                    {isFirst ? "ณ ปัจจุบัน" : `อีก ${hp.yr} ปีข้างหน้า`}
                  </text>
                  <text x={ttX + (ttW + 10) / 2} y={ttY + (isMobile ? 34 : 38)}
                    textAnchor="middle" fontSize={isMobile ? 13 : 15} fill="#ffffff" fontWeight={800}
                  >
                    {hp.co2.toLocaleString("th-TH", { maximumFractionDigits: 1 })} tCO₂
                  </text>
                  {!isFirst && (
                    <text x={ttX + (ttW + 10) / 2} y={ttY + (isMobile ? 50 : 54)}
                      textAnchor="middle" fontSize={isMobile ? 11 : 11.5}
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
  isMobile,
}: {
  rubberAge: number;
  trees: number;
  carbonTotal: number;
  forecast?: Forecast;
  isMobile?: boolean;
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
        <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, color: "#059669", display: "flex", alignItems: "center", gap: 6 }}>
          <i className="bi bi-graph-up-arrow" style={{ fontSize: isMobile ? 13 : 14 }} />
          พยากรณ์การกักเก็บคาร์บอน (tCO₂)
        </span>
        {growthPct > 0 && (
          <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 700, color: "#16a34a", background: "rgba(22,163,74,0.1)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(22,163,74,0.25)", display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: isMobile ? 9 : 10 }}>▲</span> {growthPct.toFixed(1)}% ใน {milestones[milestones.length - 1].yr} ปี
          </span>
        )}
      </div>
      <ForecastBody milestones={milestones} chartPts={chartPts} base={base} maxCo2={maxCo2} isMobile={isMobile} />
    </div>
  );
}

function PlotsMapView({ plots, isMobile }: { plots: SavedPlot[], isMobile: boolean }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          sat: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            minzoom: 1,
            maxzoom: 18,
            attribution: "",
          },
          street: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            minzoom: 1,
            maxzoom: 18,
            attribution: "",
          },
        },
        layers: [
          { id: "sat", type: "raster", source: "sat", layout: { visibility: "visible" } },
          { id: "street", type: "raster", source: "street", layout: { visibility: "none" } },
        ],
      },
      center: [101.258, 13.5],
      zoom: 5,
      attributionControl: false,
    });

    mapRef.current = map;
    const nav = new maplibregl.NavigationControl();
    map.addControl(nav, "bottom-right");

    const onMapLoad = () => {
      if (!mapRef.current) return;
      const m = mapRef.current;
      const boundaryFeatures: any[] = [];
      const parcelFeatures: any[] = [];

      plots.forEach((p, i) => {
        const carbonPerTree = (p.trees && p.trees > 0)
          ? (p.carbonTotal / p.trees).toFixed(3)
          : null;
        const props = {
          id: p.id,
          name: p.name,
          area: p.areaRai.toFixed(2),
          carbon: p.carbonTotal.toFixed(2),
          carbonPerTree: carbonPerTree ?? "—",
          province: p.province || "—",
          index: String(i + 1)
        };

        if (p.boundaryGeojson) {
          boundaryFeatures.push({
            type: "Feature",
            geometry: p.boundaryGeojson,
            properties: { ...props, type: 'boundary' }
          });
        }
        if (p.geojson) {
          parcelFeatures.push({
            type: "Feature",
            geometry: p.geojson,
            properties: { ...props, type: 'parcel' }
          });
        }
      });

      map.addSource("my-boundaries", {
        type: "geojson",
        data: { type: "FeatureCollection", features: boundaryFeatures }
      });
      map.addSource("my-parcels", {
        type: "geojson",
        data: { type: "FeatureCollection", features: parcelFeatures }
      });

      map.addLayer({
        id: "boundary-fill",
        type: "fill",
        source: "my-boundaries",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.05 }
      });
      map.addLayer({
        id: "boundary-outline",
        type: "line",
        source: "my-boundaries",
        paint: {
          "line-color": "#3b82f6",
          "line-width": 1.5,
          "line-dasharray": [4, 2]
        }
      });

      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "my-parcels",
        paint: {
          "fill-color": "#ea580c",
          "fill-opacity": 0.35
        }
      });
      map.addLayer({
        id: "parcel-outline",
        type: "line",
        source: "my-parcels",
        paint: { "line-color": "#9a3412", "line-width": 2 }
      });

      // Index Labels
      map.addLayer({
        id: "parcel-label",
        type: "symbol",
        source: "my-parcels",
        layout: {
          "text-field": ["get", "index"],
          "text-size": 16,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#dc2626",
          "text-halo-color": "#ffffff",
          "text-halo-width": 3,
        }
      });

      const handlePlotClick = (e: any) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties;
        const isBoundary = p.type === 'boundary';
        if (isBoundary) return;  // ไม่แสดง popup สำหรับขอบเขตที่วาด
        const dot = isBoundary ? '#6366f1' : '#10b981';
        const html = `
          <div style="
            font-family: 'Noto Sans Thai', 'Noto Sans', system-ui, sans-serif;
            width: 220px;
            background: #fff;
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 8px 24px rgba(0,0,0,0.10);
            overflow: hidden;
          ">
            <!-- Accent top bar -->
            <div style="height: 3px; background: ${dot};"></div>

            <!-- Content -->
            <div style="padding: 14px 16px 12px;">
              <!-- Type + Index -->
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                <span style="
                  font-size: 9.5px; font-weight: 700; letter-spacing: 0.5px;
                  color: ${dot}; text-transform: uppercase;
                ">${isBoundary ? 'ขอบเขตที่วาด' : 'แปลงที่ตรวจพบ'}</span>
                <span style="font-size: 10px; color: #cbd5e1; font-weight: 600;">#${p.index}</span>
              </div>

              <!-- Name -->
              <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 6px; line-height: 1.2;">${p.name}</div>

              <!-- Province -->
              <div style="display:flex; align-items:center; gap:5px; color:#94a3b8; font-size:11.5px; margin-bottom:14px;">
                <i class="bi bi-geo-alt-fill" style="font-size:10px; color:${dot};"></i>
                <span>${p.province}</span>
              </div>

              <!-- Divider -->
              <div style="height:1px; background:#f1f5f9; margin-bottom:12px;"></div>

              <!-- Stats row -->
              <div style="display:flex; gap:12px; align-items:flex-start;">
                <div>
                  <div style="font-size:15px; font-weight:800; color:#0f172a;">${p.area}</div>
                  <div style="font-size:9.5px; color:#94a3b8; margin-top:1px;">ไร่</div>
                </div>
                <div style="width:1px; background:#f1f5f9; align-self:stretch;"></div>
                <div>
                  <div style="font-size:15px; font-weight:800; color:#059669;">${p.carbon}</div>
                  <div style="font-size:9.5px; color:#94a3b8; margin-top:1px;">tCO₂</div>
                </div>
                ${p.carbonPerTree !== '—' ? `
                <div style="width:1px; background:#f1f5f9; align-self:stretch;"></div>
                <div>
                  <div style="font-size:13px; font-weight:800; color:#0891b2;">${p.carbonPerTree}</div>
                  <div style="font-size:9px; color:#94a3b8; margin-top:1px; line-height:1.3;">tCO₂<br>/ต้น</div>
                </div>
                ` : ''}
              </div>
            </div>
          </div>
        `;
        new maplibregl.Popup({ closeButton: false, maxWidth: 'none', className: 'kc-custom-popup' })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      };

      map.on("click", "parcel-fill", handlePlotClick);
      map.on("mouseenter", "parcel-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "parcel-fill", () => { map.getCanvas().style.cursor = ""; });

      if (boundaryFeatures.length > 0 || parcelFeatures.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        [...boundaryFeatures, ...parcelFeatures].forEach(f => {
          const geom = f.geometry as any;
          const processCoords = (coords: any) => {
            if (typeof coords[0] === "number") bounds.extend(coords as [number, number]);
            else coords.forEach(processCoords);
          };
          processCoords(geom.coordinates);
        });
        map.fitBounds(bounds, { padding: isMobile ? 40 : 80, duration: 1200 });
      }
    };

    map.on("load", onMapLoad);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [isMobile]); // Only recreate map if isMobile changes (rare)

  // Separate effect to update data when plots change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const boundaryFeatures: any[] = [];
    const parcelFeatures: any[] = [];

    plots.forEach((p, i) => {
      const carbonPerTree = (p.trees && p.trees > 0)
        ? (p.carbonTotal / p.trees).toFixed(3)
        : null;
      const props = {
        id: p.id,
        name: p.name,
        area: p.areaRai.toFixed(2),
        carbon: p.carbonTotal.toFixed(2),
        carbonPerTree: carbonPerTree ?? "—",
        province: p.province || "—",
        index: String(i + 1)
      };

      if (p.boundaryGeojson) {
        boundaryFeatures.push({
          type: "Feature",
          geometry: p.boundaryGeojson,
          properties: { ...props, type: 'boundary' }
        });
      }
      if (p.geojson) {
        parcelFeatures.push({
          type: "Feature",
          geometry: p.geojson,
          properties: { ...props, type: 'parcel' }
        });
      }
    });

    const bSrc = map.getSource("my-boundaries") as maplibregl.GeoJSONSource;
    const pSrc = map.getSource("my-parcels") as maplibregl.GeoJSONSource;

    if (bSrc) bSrc.setData({ type: "FeatureCollection", features: boundaryFeatures });
    if (pSrc) pSrc.setData({ type: "FeatureCollection", features: parcelFeatures });

    if (boundaryFeatures.length > 0 || parcelFeatures.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      [...boundaryFeatures, ...parcelFeatures].forEach(f => {
        const geom = f.geometry as any;
        const processCoords = (coords: any) => {
          if (typeof coords[0] === "number") bounds.extend(coords as [number, number]);
          else if (Array.isArray(coords)) coords.forEach(processCoords);
        };
        processCoords(geom.coordinates);
      });
      if (!bounds.isEmpty()) {
        // Only fit bounds if the number of plots has changed to avoid fighting manual zoom
        const prevCount = map.getContainer().getAttribute('data-plot-count');
        if (prevCount !== String(plots.length)) {
          map.fitBounds(bounds, { padding: isMobile ? 40 : 80, duration: 1200 });
          map.getContainer().setAttribute('data-plot-count', String(plots.length));
        }
      }
    }
  }, [plots, isMobile]);

  return (
    <div style={{ position: "relative", marginBottom: 24 }}>
      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: isMobile ? "450px" : "600px",
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(16,185,129,0.15)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)"
        }}
      />
      {/* Basemap toggle */}
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6, background: "rgba(255,255,255,0.9)", padding: 4, borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 1 }}>
        <button
          onClick={() => {
            if (!mapRef.current) return;
            mapRef.current.setLayoutProperty("sat", "visibility", "visible");
            mapRef.current.setLayoutProperty("street", "visibility", "none");
          }}
          style={{ padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", background: "transparent" }}
        >ดาวเทียม</button>
        <button
          onClick={() => {
            if (!mapRef.current) return;
            mapRef.current.setLayoutProperty("sat", "visibility", "none");
            mapRef.current.setLayoutProperty("street", "visibility", "visible");
          }}
          style={{ padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", background: "transparent" }}
        >ลายเส้น</button>
      </div>
    </div>
  );
}

function EditPlotModal({ plot, onClose, onSave, isMobile }: { plot: SavedPlot; onClose: () => void; onSave: (p: SavedPlot) => void; isMobile: boolean }) {
  const [formData, setFormData] = useState({
    name: plot.name || "",
    ownerName: plot.ownerName || "",
    province: plot.province || "",
    areaRai: plot.areaRai?.toString() || "",
    rubberAge: plot.rubberAge?.toString() || "",
    trees: plot.trees?.toString() || "",
    plantYearBE: plot.plantYearBE?.toString() || "",
  });

  const handleSave = () => {
    const ageNum = parseInt(formData.rubberAge) || 0;
    const treesNum = parseInt(formData.trees) || 0;
    const newCarbon = (ageNum > 0 && treesNum > 0) ? carbonCo2(ageNum, treesNum) : plot.carbonTotal;
    const forecast = {
      yr3: carbonCo2(ageNum + 3, treesNum),
      yr5: carbonCo2(ageNum + 5, treesNum),
      yr7: carbonCo2(ageNum + 7, treesNum)
    };

    onSave({
      ...plot,
      name: formData.name,
      ownerName: formData.ownerName,
      province: formData.province,
      areaRai: parseFloat(formData.areaRai) || 0,
      rubberAge: ageNum,
      trees: treesNum,
      plantYearBE: parseInt(formData.plantYearBE) || undefined,
      carbonTotal: newCarbon,
      forecast
    });
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "90vh", overflow: "auto", padding: isMobile ? 20 : 30, boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#064e3b", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <i className="bi bi-pencil-square" style={{ color: "#10b981" }}/> แก้ไขข้อมูลแปลง
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>ชื่อโครงการ</label>
            <input type="text" value={formData.name} onChange={e => setFormData(f => ({...f, name: e.target.value}))} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>ชื่อเจ้าของ</label>
            <input type="text" value={formData.ownerName} onChange={e => setFormData(f => ({...f, ownerName: e.target.value}))} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>จังหวัด</label>
            <input type="text" value={formData.province} onChange={e => setFormData(f => ({...f, province: e.target.value}))} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>พื้นที่ (ไร่)</label>
            <input type="number" step="0.01" value={formData.areaRai} onChange={e => setFormData(f => ({...f, areaRai: e.target.value}))} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>อายุยาง (ปี)</label>
            <input type="number" value={formData.rubberAge} onChange={e => setFormData(f => ({...f, rubberAge: e.target.value}))} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>จำนวนต้น</label>
            <input type="number" value={formData.trees} onChange={e => setFormData(f => ({...f, trees: e.target.value}))} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>ปีที่ปลูก (พ.ศ.)</label>
            <input type="number" value={formData.plantYearBE} onChange={e => setFormData(f => ({...f, plantYearBE: e.target.value}))} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 14 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#f1f5f9", color: "#475569", fontWeight: 700, cursor: "pointer" }}>ยกเลิก</button>
          <button onClick={handleSave} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#10b981", color: "#fff", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="bi bi-floppy-disk"/> บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

function PlotCard({ plot, index, onDelete, onEdit, expanded, onToggle, isMobile }: { plot: SavedPlot; index: number; onDelete: () => void; onEdit?: (p: SavedPlot) => void; expanded: boolean; onToggle: () => void; isMobile: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const carbonPerTree = plot.trees && plot.trees > 0
    ? (plot.carbonTotal / plot.trees)
    : null;

  const statItems = [
    { label: "พื้นที่", val: plot.areaRai > 0 ? plot.areaRai.toFixed(2) : "—", unit: "ไร่", color: "#0d9488", bg: "rgba(13,148,136,0.08)" },
    { label: "ปีที่ปลูก", val: plot.plantYearBE && plot.plantYearBE > 0 ? String(plot.plantYearBE) : "—", unit: "พ.ศ.", color: "#0369a1", bg: "rgba(3,105,161,0.08)" },
    { label: "อายุยาง", val: plot.rubberAge > 0 ? String(plot.rubberAge) : "—", unit: "ปี", color: "#0891b2", bg: "rgba(8,145,178,0.08)" },
    { label: "ต้นยาง", val: plot.trees && plot.trees > 0 ? plot.trees.toLocaleString("th-TH") : "—", unit: "ต้น", color: "#7c3aed", bg: "rgba(124,58,237,0.08)" },
    { label: "คาร์บอน/ต้น", val: carbonPerTree !== null ? carbonPerTree < 0.001 ? carbonPerTree.toExponential(2) : carbonPerTree.toFixed(4) : "—", unit: "tCO₂/ต้น", color: "#0e7490", bg: "rgba(14,116,144,0.08)" },
    { label: "คาร์บอนทั้งแปลง", val: plot.carbonTotal > 0 ? fmtCompact(plot.carbonTotal) : "—", unit: "tCO₂", color: "#059669", bg: "rgba(5,150,105,0.08)" },
  ];

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 22,
        border: "1px solid rgba(16,185,129,0.13)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        transition: "box-shadow 0.25s ease, transform 0.2s ease",
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 12px 36px rgba(16,185,129,0.16)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.05)"; e.currentTarget.style.transform = ""; }}
    >
      {/* Removed Gradient top accent */}

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: isMobile ? 12 : 14, padding: isMobile ? "16px 18px 12px" : "20px 24px 14px" }}>
        {/* Plot Index Number */}
        <div style={{
          width: isMobile ? 38 : 42, height: isMobile ? 38 : 42, borderRadius: isMobile ? 10 : 12, flexShrink: 0,
          background: "rgba(16,185,129,0.1)",
          border: "2px solid #10b981",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 12px rgba(16,185,129,0.08)",
          fontSize: isMobile ? 18 : 20, fontWeight: 900, color: "#059669",
        }}>
          {index}
        </div>

        {/* Name + meta */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: "#0f172a", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 6 }}>
            {plot.name}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 6 : 7, alignItems: "center" }}>
            {plot.ownerName && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#475569", background: "#f1f5f9", padding: "3px 10px", borderRadius: 20, border: "1px solid #e2e8f0" }}>
                <i className="bi bi-person-fill" style={{ color: "#64748b", fontSize: 10 }} />{plot.ownerName}
              </span>
            )}
            {plot.province && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#475569", background: "#f1f5f9", padding: "3px 10px", borderRadius: 20, border: "1px solid #e2e8f0" }}>
                <i className="bi bi-pin-map-fill" style={{ color: "#64748b", fontSize: 10 }} />{plot.province}
              </span>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#64748b", background: "rgba(148,163,184,0.1)", padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(148,163,184,0.2)" }}>
              <i className="bi bi-clock-history" style={{ color: "#94a3b8", fontSize: 10 }} />
              <span style={{ opacity: 0.7, fontSize: 10 }}>บันทึกเมื่อ:</span>
              {new Date(plot.date).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row — Responsive grid */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(6,1fr)", gap: isMobile ? 8 : 10, padding: isMobile ? "0 18px 12px" : "0 24px 14px" }}>
        {statItems.map(({ label, val, unit, color, bg }) => (
          <div key={label} style={{
            borderRadius: 14, padding: isMobile ? "10px 4px" : "12px 6px", textAlign: "center",
            background: bg, border: `1px solid ${color}22`,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          }}>
            <div style={{ fontSize: 8.5, color: "#94a3b8", marginBottom: 1 }}>{label}</div>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, color, letterSpacing: -0.5, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: color + "bb", lineHeight: 1 }}>{unit}</div>
          </div>
        ))}
      </div>



      {/* Divider */}
      <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(16,185,129,0.15),transparent)", margin: "0 24px" }} />

      {/* Footer: expand + delete */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "10px 16px 14px" : "11px 20px 15px" }}>
        <button
          onClick={onToggle}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: isMobile ? "5px 10px" : "6px 15px",
            background: expanded ? "rgba(16,185,129,0.09)" : "transparent",
            border: "1.5px solid rgba(16,185,129,0.28)",
            borderRadius: 10, cursor: "pointer", fontSize: isMobile ? 11 : 12, fontWeight: 700,
            color: "#059669", transition: "all 0.15s",
          }}
        >
          <i className={`bi bi-chevron-${expanded ? "up" : "down"}`} />
          {expanded ? (isMobile ? "ซ่อน" : "ซ่อนรายละเอียด") : (isMobile ? "ดูเพิ่ม" : "ดูรายละเอียดเพิ่มเติม")}
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {confirmDelete ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>ยืนยันลบ?</span>
              <button onClick={onDelete} style={{ padding: "5px 14px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>ลบ</button>
              <button onClick={() => setConfirmDelete(false)} style={{ padding: "5px 12px", background: "rgba(0,0,0,0.06)", color: "#64748b", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>ยกเลิก</button>
            </div>
          ) : (
            <>
              <button
                onClick={() => onEdit?.(plot)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", background: "rgba(14,165,233,0.07)", color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.2)", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(14,165,233,0.13)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(14,165,233,0.07)"; }}
              >
                <i className="bi bi-pencil-square" /> แก้ไข
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", background: "rgba(239,68,68,0.07)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.13)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.07)"; }}
              >
                <i className="bi bi-trash3" /> ลบแปลงนี้
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: isMobile ? "4px 12px 22px" : "4px 24px 22px", borderTop: "1px dashed rgba(16,185,129,0.15)" }}>
          <ForecastSection
            rubberAge={plot.rubberAge}
            trees={plot.trees ?? 0}
            carbonTotal={plot.carbonTotal}
            forecast={plot.forecast}
            isMobile={isMobile}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 8, marginTop: 14 }}>
            {[
              { k: "ID", v: plot.id },
              { k: "วันที่บันทึก", v: new Date(plot.date).toLocaleString("th-TH") },
              { k: "พื้นที่ (ไร่)", v: plot.areaRai.toFixed(4) },
              { k: "อายุยาง", v: `${plot.rubberAge} ปี` },
              { k: "จำนวนต้น", v: plot.trees?.toLocaleString("th-TH") ?? "—" },
              { k: "ปีปลูก (พ.ศ.)", v: plot.plantYearBE ? String(plot.plantYearBE) : "—" },
              { k: "คาร์บอนปัจจุบัน", v: `${plot.carbonTotal.toFixed(2)} tCO₂` },
              { k: "คาร์บอน/ต้น", v: plot.trees && plot.trees > 0 ? `${(plot.carbonTotal / plot.trees).toFixed(4)} tCO₂` : "—" },
            ].map(({ k, v }) => (
              <div key={k} style={{ padding: "8px 12px", background: "rgba(0,0,0,0.025)", borderRadius: 10, border: "1px solid rgba(0,0,0,0.04)" }}>
                <div style={{ color: "#94a3b8", fontSize: 9.5, fontWeight: 600, letterSpacing: 0.3 }}>{k}</div>
                <div style={{ color: "#0f172a", fontWeight: 700, marginTop: 2, fontSize: 12, wordBreak: "break-all" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyPlotsPage() {
  const { user, ready } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [plots, setPlots] = useState<SavedPlot[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [expandedPlotId, setExpandedPlotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"mine" | "all">("mine");
  const [displayMode, setDisplayMode] = useState<"list" | "map">("list");
  const [isMobile, setIsMobile] = useState(false);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    setMounted(true);
    if (ready && user) {
      try {
        if (viewMode === "mine") {
          const key = `user_saved_plots_${user.id}`;
          const stored = localStorage.getItem(key);
          if (stored) {
            const parsed = JSON.parse(stored);
            const myOnly = Array.isArray(parsed) ? parsed.filter((p: any) => p.userId === user.id || !p.userId) : [];
            setPlots(myOnly);
          } else {
            setPlots([]);
          }
        } else if (isAdmin) {
          // Admin view: fetch plots from ALL users
          const usersRaw = localStorage.getItem("kc_users");
          const allUsers = usersRaw ? JSON.parse(usersRaw) : [];
          let allPlots: SavedPlot[] = [];

          allUsers.forEach((u: any) => {
            const userKey = `user_saved_plots_${u.id}`;
            const userPlotsRaw = localStorage.getItem(userKey);
            if (userPlotsRaw) {
              const parsed = JSON.parse(userPlotsRaw);
              if (Array.isArray(parsed)) {
                // Decorate plots with owner info if missing
                const decorated = parsed.map(p => ({
                  ...p,
                  userId: u.id,
                  ownerName: p.ownerName || u.fullname
                }));
                allPlots = [...allPlots, ...decorated];
              }
            }
          });

          // Also check the global_saved_plots for any legacy/anonymous ones
          const globalKey = 'global_saved_plots';
          const globalRaw = localStorage.getItem(globalKey);
          if (globalRaw) {
            const globalPlots = JSON.parse(globalRaw);
            // Only add global plots that aren't already in the list (by ID)
            const existingIds = new Set(allPlots.map(p => p.id));
            globalPlots.forEach((gp: any) => {
              if (!existingIds.has(gp.id)) {
                allPlots.push(gp);
              }
            });
          }

          // Sort by date desc
          allPlots.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          setPlots(allPlots);
        }
      } catch { }
    }
  }, [ready, user, viewMode]);


  const handleDelete = (id: string) => {
    if (!user) return;
    const plotToDelete = plots.find(p => p.id === id);
    if (!plotToDelete) return;

    const updated = plots.filter(p => p.id !== id);
    setPlots(updated);

    try {
      // 1. Update the owner's specific storage
      const ownerId = plotToDelete.userId || user.id;
      const key = `user_saved_plots_${ownerId}`;
      const ownerStoredRaw = localStorage.getItem(key);
      if (ownerStoredRaw) {
        const ownerPlots = JSON.parse(ownerStoredRaw);
        const filtered = ownerPlots.filter((p: any) => p.id !== id);
        localStorage.setItem(key, JSON.stringify(filtered));
      }

      // 2. Also remove from global list
      const globalKey = 'global_saved_plots';
      const globalRaw = localStorage.getItem(globalKey);
      if (globalRaw) {
        const globalPlots = JSON.parse(globalRaw);
        const filteredGlobal = globalPlots.filter((p: any) => p.id !== id);
        localStorage.setItem(globalKey, JSON.stringify(filteredGlobal));
      }
    } catch { }
  };



  const handleDeleteAll = () => {
    if (!user) return;
    if (viewMode === "all") {
      // Admin deleting everything? Let's limit this to current view for safety
      // Actually, standard behavior: delete what is shown
      plots.forEach(p => handleDelete(p.id));
    } else {
      const idsToDelete = plots.map(p => p.id);
      setPlots([]);
      try {
        const key = `user_saved_plots_${user.id}`;
        localStorage.removeItem(key);

        const globalKey = 'global_saved_plots';
        const globalRaw = localStorage.getItem(globalKey);
        if (globalRaw) {
          const globalPlots = JSON.parse(globalRaw);
          const filteredGlobal = globalPlots.filter((p: any) => !idsToDelete.includes(p.id));
          localStorage.setItem(globalKey, JSON.stringify(filteredGlobal));
        }
      } catch { }
    }
    setConfirmDeleteAll(false);
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

  const projectGroups = useMemo(() => {
    const groups: { [key: string]: { projectName: string, plots: SavedPlot[], totalArea: number, totalCarbon: number, date: number } } = {};
    filteredPlots.forEach(p => {
      const pName = p.name || "ไม่มีชื่อโครงการ";
      if (!groups[pName]) {
        groups[pName] = { projectName: pName, plots: [], totalArea: 0, totalCarbon: 0, date: 0 };
      }
      groups[pName].plots.push(p);
      groups[pName].totalArea += (p.areaRai || 0);
      groups[pName].totalCarbon += (p.carbonTotal || 0);
      const d = new Date(p.date).getTime();
      if (d > groups[pName].date) groups[pName].date = d;
    });
    return Object.values(groups).sort((a, b) => b.date - a.date);
  }, [filteredPlots]);

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const toggleProject = (pName: string) => setExpandedProjects(prev => ({...prev, [pName]: !prev[pName]}));

  const [editingPlot, setEditingPlot] = useState<SavedPlot | null>(null);

  const handleUpdatePlot = (updated: SavedPlot) => {
    if (!user) return;
    const newPlots = plots.map(p => p.id === updated.id ? updated : p);
    setPlots(newPlots);
    try {
      const ownerId = updated.userId || user.id;
      const key = `user_saved_plots_${ownerId}`;
      const ownerStoredRaw = localStorage.getItem(key);
      if (ownerStoredRaw) {
        const ownerPlots = JSON.parse(ownerStoredRaw);
        const saved = ownerPlots.map((p: any) => p.id === updated.id ? updated : p);
        localStorage.setItem(key, JSON.stringify(saved));
      }
      
      const globalKey = 'global_saved_plots';
      const globalRaw = localStorage.getItem(globalKey);
      if (globalRaw) {
        const globalPlots = JSON.parse(globalRaw);
        const savedGlobal = globalPlots.map((p: any) => p.id === updated.id ? updated : p);
        localStorage.setItem(globalKey, JSON.stringify(savedGlobal));
      }
    } catch {}
    setEditingPlot(null);
  };

  if (!ready || !mounted)
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fdfb" }}>
        <div className="spinner-border" style={{ color: "#10b981", width: "3rem", height: "3rem" }} role="status" />
      </div>
    );

  if (!user) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#f4fcf8", paddingTop: 140, paddingBottom: "60px", fontFamily: "'Inter','Noto Sans Thai',sans-serif" }}>
      <div className="container" style={{ maxWidth: "1100px" }}>

        {/* Hero */}
        <div style={{
          background: HERO_BG, borderRadius: isMobile ? 20 : 24, padding: isMobile ? "24px 20px" : "36px 48px", marginBottom: 24,
          border: "1px solid rgba(16,185,129,0.15)", boxShadow: "0 20px 40px rgba(0,0,0,0.03)",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -50, left: -50, width: isMobile ? 150 : 200, height: isMobile ? 150 : 200, background: "rgba(16,185,129,0.2)", filter: "blur(60px)", borderRadius: "50%", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -50, right: -50, width: isMobile ? 200 : 250, height: isMobile ? 200 : 250, background: "rgba(13,148,136,0.15)", filter: "blur(70px)", borderRadius: "50%", pointerEvents: "none" }} />

          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: 20 }}>
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 12px", background: "rgba(16,185,129,0.1)", color: "#059669", borderRadius: 50, fontSize: 11, fontWeight: 700, border: "1px solid rgba(16,185,129,0.2)" }}>
                  <i className="bi bi-folder-fill" /> {viewMode === "all" ? "ข้อมูลทั้งหมดในระบบ" : "ข้อมูลของฉัน"}
                </div>
              </div>
              <h1 style={{ fontSize: isMobile ? 24 : 30, fontWeight: 800, color: "#064e3b", marginBottom: 8, lineHeight: 1.2 }}>
                {viewMode === "all" ? "การจัดการแปลงยางพาราทั้งหมด" : "แปลงยางพาราของฉัน"}
              </h1>
              <p style={{ fontSize: isMobile ? 13 : 14, color: "#475569", margin: "0 0 18px", lineHeight: 1.6 }}>
                {viewMode === "all"
                  ? "ตรวจสอบและจัดการข้อมูลแปลงยางพาราของผู้ใช้งานทุกคนในระบบ"
                  : "จัดการและติดตามข้อมูลแปลงยาง พร้อมพยากรณ์คาร์บอนรายปี"}
              </p>
              {/* Search */}
              <div style={{ position: "relative", maxWidth: isMobile ? "100%" : 440 }}>
                <i className="bi bi-search" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: searchFocused ? "#059669" : "#94a3b8", fontSize: 14, pointerEvents: "none" }} />
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

            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flexWrap: "wrap", alignItems: "center", justifyContent: isMobile ? "flex-start" : "flex-end", gap: isMobile ? 12 : 16, width: isMobile ? "100%" : "auto" }}>
              {isAdmin && (
                <div style={{
                  background: "rgba(255,255,255,0.9)",
                  padding: 4,
                  borderRadius: isMobile ? 12 : 14,
                  display: "flex",
                  gap: isMobile ? 3 : 4,
                  border: "1px solid rgba(16,185,129,0.15)",
                  width: isMobile ? "100%" : "auto",
                  boxShadow: isMobile ? "none" : "0 4px 15px rgba(0,0,0,0.05)"
                }}>
                  <button
                    onClick={() => setViewMode("mine")}
                    style={{
                      flex: isMobile ? 1 : "initial",
                      padding: isMobile ? "7px 12px" : "8px 16px",
                      borderRadius: isMobile ? 9 : 10,
                      border: "none",
                      fontSize: isMobile ? 12 : 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      background: viewMode === "mine" ? "#10b981" : "transparent",
                      color: viewMode === "mine" ? "#fff" : "#64748b",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      whiteSpace: "nowrap"
                    }}
                  >
                    <i className="bi bi-person-circle" /> {isMobile ? "ของฉัน" : "เฉพาะของฉัน"}
                  </button>
                  <button
                    onClick={() => setViewMode("all")}
                    style={{
                      flex: isMobile ? 1 : "initial",
                      padding: isMobile ? "7px 12px" : "8px 16px",
                      borderRadius: isMobile ? 9 : 10,
                      border: "none",
                      fontSize: isMobile ? 12 : 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      background: viewMode === "all" ? "#0f172a" : "transparent",
                      color: viewMode === "all" ? "#fff" : "#64748b",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      whiteSpace: "nowrap"
                    }}
                  >
                    <i className="bi bi-people-fill" /> {isMobile ? "ทั้งหมด" : "ดูทั้งหมด"}
                  </button>
                </div>
              )}
              <Link
                href="/map-draw"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 8 : 10, background: "linear-gradient(135deg,#10b981 0%,#059669 100%)", color: "#fff", padding: isMobile ? "12px 24px" : "14px 28px", borderRadius: isMobile ? 12 : 14, fontWeight: 700, fontSize: isMobile ? 13 : 15, textDecoration: "none", boxShadow: isMobile ? "0 6px 15px rgba(16,185,129,0.25)" : "0 10px 25px rgba(16,185,129,0.3)",
                  width: isMobile ? "100%" : "auto",
                  whiteSpace: "nowrap",
                  transition: "all 0.2s ease"
                }}
              >
                <i className="bi bi-plus-circle" style={{ fontSize: isMobile ? 15 : 17 }} /> วาดแปลงใหม่
              </Link>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        {plots.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(190px, 1fr))", gap: isMobile ? 10 : 14, marginBottom: 24 }}>
            {([
              { label: "แปลงทั้งหมด", val: plots.length.toLocaleString("th-TH"), unit: "แปลง", icon: "bi-map", color: "#16a34a", bg: "rgba(22,163,74,0.08)" },
              { label: "พื้นที่รวม", val: totalArea.toFixed(2), unit: "ไร่", icon: "bi-grid-fill", color: "#0d9488", bg: "rgba(13,148,136,0.08)" },
              { label: "คาร์บอนปัจจุบัน", val: fmtCompact(totalCarbon), unit: "tCO₂", icon: "bi-cloud-arrow-up-fill", color: "#059669", bg: "rgba(5,150,105,0.08)" },
              ...(totalForecast7 > 0 ? [{ label: "พยากรณ์ +7 ปี", val: fmtCompact(totalForecast7), unit: "tCO₂", icon: "bi-graph-up-arrow", color: "#7c3aed", bg: "rgba(124,58,237,0.08)" }] : []),
            ] as { label: string; val: string; unit: string; icon: string; color: string; bg: string }[]).map(({ label, val, unit, icon, color, bg }) => (
              <div key={label} style={{ background: "#fff", borderRadius: 16, padding: isMobile ? "12px 14px" : "16px 18px", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <span style={{ fontSize: isMobile ? 10 : 12, color: "#64748b" }}>{label}</span>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`bi ${icon}`} style={{ color, fontSize: 12 }} />
                  </div>
                </div>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color }}>{val}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{unit}</div>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, padding: "0 2px", gap: 10 }}>
            <h2 style={{ fontSize: isMobile ? 14 : 17, fontWeight: 800, color: "#064e3b", margin: 0, whiteSpace: "nowrap", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {viewMode === "all" ? (isMobile ? "แปลงทั้งหมด" : "รายการแปลงทั้งหมด") : (isMobile ? "แปลงที่บันทึก" : "รายการแปลงที่บันทึกแล้ว")}
              <span style={{ fontSize: isMobile ? 10 : 12, fontWeight: 400, color: "#64748b", marginLeft: isMobile ? 4 : 8 }}>
                {searchTerm ? `พบ ${filteredPlots.length}` : `(${plots.length})`}
              </span>
            </h2>
            <div style={{ display: "flex", gap: isMobile ? 6 : 10, alignItems: "center", flexShrink: 0 }}>
              {plots.length > 0 && (
                <div style={{
                  display: "flex",
                  background: "rgba(255,255,255,0.8)",
                  padding: 4,
                  borderRadius: 12,
                  border: "1px solid rgba(16,185,129,0.15)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
                }}>
                  <button
                    onClick={() => setDisplayMode("list")}
                    style={{
                      padding: isMobile ? "5px 8px" : "6px 12px",
                      borderRadius: 8,
                      border: "none",
                      fontSize: isMobile ? 10.5 : 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: displayMode === "list" ? "#10b981" : "transparent",
                      color: displayMode === "list" ? "#fff" : "#64748b",
                      transition: "all 0.2s"
                    }}
                  >
                    <i className="bi bi-list-ul" style={{ marginRight: isMobile ? 2 : 5 }} /> รายการ
                  </button>
                  <button
                    onClick={() => setDisplayMode("map")}
                    style={{
                      padding: isMobile ? "5px 8px" : "6px 12px",
                      borderRadius: 8,
                      border: "none",
                      fontSize: isMobile ? 10.5 : 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: displayMode === "map" ? "#10b981" : "transparent",
                      color: displayMode === "map" ? "#fff" : "#64748b",
                      transition: "all 0.2s"
                    }}
                  >
                    <i className="bi bi-map-fill" style={{ marginRight: isMobile ? 2 : 5 }} /> แผนที่
                  </button>
                </div>
              )}
              {plots.length > 0 && (
                <div>
                  {confirmDeleteAll ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "#ef4444", fontWeight: 700 }}>ลบทั้งหมด?</span>
                      <button
                        onClick={handleDeleteAll}
                        style={{ padding: "6px 14px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}
                      >
                        ยืนยัน
                      </button>
                      <button
                        onClick={() => setConfirmDeleteAll(false)}
                        style={{ padding: "6px 14px", background: "rgba(0,0,0,0.06)", color: "#64748b", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteAll(true)}
                      style={{ padding: isMobile ? "6px 10px" : "8px 12px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, cursor: "pointer", fontSize: isMobile ? 13 : 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}
                    >
                      <i className="bi bi-trash3-fill" style={{ fontSize: isMobile ? 14 : 12 }} /> {isMobile ? "" : "ลบทั้งหมด"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {displayMode === "map" && filteredPlots.length > 0 ? (
            <PlotsMapView plots={filteredPlots} isMobile={isMobile} />
          ) : filteredPlots.length === 0 ? (
            <div style={{ textAlign: "center", padding: "44px 24px", background: "#fff", borderRadius: 20, color: "#94a3b8", fontSize: 13 }}>
              <i className="bi bi-search" style={{ fontSize: 30, display: "block", marginBottom: 8 }} />
              ไม่พบแปลงที่ตรงกับ &ldquo;<strong style={{ color: "#64748b" }}>{searchTerm}</strong>&rdquo;
              <br />
              <button onClick={() => setSearchTerm("")} style={{ marginTop: 12, padding: "5px 16px", background: "rgba(16,185,129,0.08)", color: "#059669", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                ล้างการค้นหา
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 24 : 32 }}>
              {editingPlot && <EditPlotModal plot={editingPlot} onClose={() => setEditingPlot(null)} onSave={handleUpdatePlot} isMobile={isMobile} />}
              {projectGroups.map((group, gIdx) => (
                <div key={`${group.projectName}-${gIdx}`} style={{ background: "#fff", borderRadius: 24, border: "1px solid rgba(16,185,129,0.2)", overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.03)" }}>
                  {/* Project Header */}
                  <div style={{ padding: isMobile ? "16px 20px" : "20px 28px", background: "linear-gradient(135deg,rgba(16,185,129,0.05),rgba(5,150,105,0.02))", display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: 16 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: "#10b981", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                          <i className="bi bi-folder-fill" />
                        </div>
                        <h3 style={{ margin: 0, fontSize: isMobile ? 18 : 20, fontWeight: 800, color: "#064e3b" }}>{group.projectName}</h3>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, color: "#64748b", fontSize: 13, fontWeight: 500 }}>
                        <span><i className="bi bi-map-fill me-1" style={{color:"#0ea5e9"}}/> {group.plots.length} แปลง</span>
                        <span><i className="bi bi-grid-fill me-1" style={{color:"#10b981"}}/> {group.totalArea.toFixed(2)} ไร่</span>
                        <span><i className="bi bi-cloud-arrow-up-fill me-1" style={{color:"#8b5cf6"}}/> {fmtCompact(group.totalCarbon)} tCO₂</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, width: isMobile ? "100%" : "auto" }}>
                      <Link href={`/map-draw?project=${encodeURIComponent(group.projectName)}`} style={{ flex: isMobile ? 1 : "auto", textAlign: "center", padding: "8px 16px", borderRadius: 12, background: "rgba(16,185,129,0.1)", color: "#059669", fontWeight: 700, fontSize: 13, textDecoration: "none", border: "1px solid rgba(16,185,129,0.2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                        <i className="bi bi-plus-lg" /> เพิ่มแปลง
                      </Link>
                      <button onClick={() => toggleProject(group.projectName)} style={{ flex: isMobile ? 1 : "auto", padding: "8px 16px", borderRadius: 12, background: expandedProjects[group.projectName] ? "rgba(0,0,0,0.05)" : "#0f172a", color: expandedProjects[group.projectName] ? "#475569" : "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                        {expandedProjects[group.projectName] ? "ซ่อนแปลง" : "ดูแปลงทั้งหมด"} <i className={`bi bi-chevron-${expandedProjects[group.projectName] ? "up" : "down"}`} />
                      </button>
                    </div>
                  </div>

                  {/* Project Plots */}
                  {expandedProjects[group.projectName] && (
                    <div style={{ padding: isMobile ? "16px" : "24px", background: "#f8fafc", borderTop: "1px solid rgba(16,185,129,0.1)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        {group.plots.map((plot, i) => (
                          <PlotCard
                            key={`${plot.id}-${i}`}
                            plot={plot}
                            index={i + 1}
                            onDelete={() => handleDelete(plot.id)}
                            onEdit={setEditingPlot}
                            expanded={expandedPlotId === plot.id}
                            onToggle={() => setExpandedPlotId(prev => prev === plot.id ? null : plot.id)}
                            isMobile={isMobile}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
