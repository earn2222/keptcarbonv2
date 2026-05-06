"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DashboardMap from "./DashboardMap";
import {
  Chart, DoughnutController,
  ArcElement,
  Tooltip, Legend,
  type ChartItem,
} from "chart.js";

Chart.register(
  DoughnutController,
  ArcElement,
  Tooltip, Legend,
);

/* ── Site hero background (matches my-plots page) ── */
const HERO_BG =
    "radial-gradient(1200px 500px at -10% -10%, rgba(16,185,129,0.20) 0%, rgba(16,185,129,0) 60%)," +
    "radial-gradient(900px 450px at 110% 0%, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0) 58%)," +
    "radial-gradient(700px 360px at 30% 120%, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0) 55%)," +
    "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.86) 100%)";

type SavedPlot = {
  id: string; name: string;
  areaRai: number; carbonTotal: number; rubberAge: number;
  geojson?: GeoJSON.GeoJSON | null;
  boundaryGeojson?: GeoJSON.GeoJSON | null;
};

const BUCKETS = [
  { key: "1-5",   label: "1–5 ปี",   min: 1,  max: 5,  color: "#4ade80", dark: "#15803d" },
  { key: "6-12",  label: "6–12 ปี",  min: 6,  max: 12, color: "#22c55e", dark: "#166534" },
  { key: "13-18", label: "13–18 ปี", min: 13, max: 18, color: "#2d9e5f", dark: "#1a5c38" },
  { key: "19+",   label: "19+ ปี",   min: 19, max: 99, color: "#1e7a47", dark: "#14532d" },
];

/* ── animated counter ── */
function useCounter(target: number, ms = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === 0) { setV(0); return; }
    let cur = 0;
    const step = target / (ms / 16);
    const t = setInterval(() => {
      cur += step;
      if (cur >= target) { setV(target); clearInterval(t); }
      else setV(cur);
    }, 16);
    return () => clearInterval(t);
  }, [target, ms]);
  return v;
}

/* ── Stat card ── */
function StatCard({ label, value, unit, color }: {
  label: string; value: number; unit: string; color: string;
}) {
  const a = useCounter(value);
  const disp = value >= 10
    ? Math.round(a).toLocaleString("th-TH")
    : a.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      border: "1px solid rgba(0,0,0,0.06)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
      padding: "20px 24px",
      display: "flex", flexDirection: "column", gap: 4,
      position: "relative", overflow: "hidden",
      borderLeft: `4px solid ${color}`,
    }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#1a3d2b", letterSpacing: -0.5, lineHeight: 1 }}>
          {disp}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>{unit}</div>
      </div>
    </div>
  );
}

/* ── Donut chart (age distribution) ── */
function DonutChart({ bucketData, total }: {
  bucketData: { key: string; label: string; color: string; plotCount: number }[];
  total: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const nonEmpty = bucketData.filter(b => b.plotCount > 0);

  useEffect(() => {
    if (!ref.current || !nonEmpty.length) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(ref.current.getContext("2d") as ChartItem, {
      type: "doughnut",
      data: {
        labels: nonEmpty.map(b => b.label),
        datasets: [{
          data: nonEmpty.map(b => b.plotCount),
          backgroundColor: nonEmpty.map(b => b.color),
          borderWidth: 3, borderColor: "#fff", hoverOffset: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(26,61,43,0.92)",
            titleColor: "#4ade80", bodyColor: "#d1fae5",
            padding: 12, cornerRadius: 10,
            callbacks: {
              label: ctx => {
                const v = ctx.parsed as number;
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
                return ` ${v.toLocaleString("th-TH")} แปลง (${pct}%)`;
              },
            },
          },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketData, total]);

  if (!nonEmpty.length) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "#94a3b8" }}>
      <i className="bi bi-pie-chart" style={{ fontSize: 36 }} />
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>ยังไม่มีข้อมูล</p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ position: "relative", height: 180, flexShrink: 0 }}>
        <canvas ref={ref} />
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: "#1a3d2b", letterSpacing: -1, lineHeight: 1 }}>
            {total.toLocaleString("th-TH")}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginTop: 3 }}>แปลงทั้งหมด</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {nonEmpty.map(b => (
          <div key={b.key} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 12px", background: "#f8fdf9",
            borderRadius: 10, border: "1px solid rgba(45,158,95,0.08)",
          }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: b.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#374151", flex: 1 }}>{b.label}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "#1a3d2b" }}>
              {b.plotCount.toLocaleString("th-TH")}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#6b7280",
              background: "#f0f0f0", padding: "2px 7px", borderRadius: 50,
            }}>
              {total > 0 ? ((b.plotCount / total) * 100).toFixed(0) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════ PAGE ══════════════════════ */
export default function DashboardPage() {
  const [plots, setPlots] = useState<SavedPlot[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("user_saved_plots");
      if (raw) setPlots(JSON.parse(raw) as SavedPlot[]);
    } catch { /* ignore */ }
    setMounted(true);
  }, []);

  const totalAreaRai = useMemo(() => plots.reduce((s, p) => s + (p.areaRai || 0), 0), [plots]);
  const totalCarbon  = useMemo(() => plots.reduce((s, p) => s + (p.carbonTotal || 0), 0), [plots]);

  const bucketData = useMemo(() =>
    BUCKETS.map(b => {
      const grp = plots.filter(p => { const a = p.rubberAge || 0; return a >= b.min && a <= b.max; });
      return { ...b, plotCount: grp.length, carbon: grp.reduce((s, p) => s + (p.carbonTotal || 0), 0), areaRai: grp.reduce((s, p) => s + (p.areaRai || 0), 0) };
    }), [plots]);

  const maxCarbon = useMemo(() => Math.max(...bucketData.map(b => b.carbon), 1), [bucketData]);

  const mapPlots = useMemo(() =>
    plots.filter(p => p.geojson || p.boundaryGeojson).map(p => ({
      id: p.id, name: p.name,
      areaRai: p.areaRai, carbonTotal: p.carbonTotal, age: p.rubberAge,
      geojson: p.geojson as GeoJSON.GeoJSON,
      boundaryGeojson: (p.boundaryGeojson as GeoJSON.GeoJSON) ?? null,
    })), [plots]);

  if (!mounted) return (
    <div className="dv2-root dv2-loading">
      <div className="dv2-spinner" /><p>กำลังโหลดข้อมูล...</p>
    </div>
  );

  const S = { /* shared card style */
    background: "#fff",
    borderRadius: 18,
    border: "1px solid rgba(45,158,95,0.13)",
    boxShadow: "0 2px 12px rgba(45,158,95,0.07)",
    overflow: "hidden" as const,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f3faf6", paddingTop: 140, fontFamily: "'Noto Sans Thai','Inter',sans-serif", paddingBottom: 60 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }} className="db-container">

        {/* ══ Hero header ══ */}
        <div className="db-hero" style={{
          background: HERO_BG,
          border: "1px solid rgba(0,0,0,0.06)",
          borderRadius: 16,
          marginBottom: 24,
          display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 24, flexWrap: "wrap",
        }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a3d2b", margin: "0 0 6px", letterSpacing: -0.5, lineHeight: 1.2 }}>
              รายงานภาพรวมแปลงยางพารา
            </h1>
            <p style={{ fontSize: 14, color: "#64748b", margin: 0, fontWeight: 500 }}>
              ข้อมูลสรุปพื้นที่ขอบเขตที่วาด นำเข้าไฟล์ SHP และแปลงที่ตรวจจับด้วยระบบอัตโนมัติ
            </p>
          </div>
          <Link href="/map-draw" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#1a3d2b",
            color: "#fff", padding: "12px 24px", borderRadius: 8,
            fontWeight: 700, fontSize: 14, textDecoration: "none",
            transition: "all .2s", flexShrink: 0,
            fontFamily: "'Noto Sans Thai','Inter',sans-serif",
          }}>
            วาดแปลงใหม่
          </Link>
        </div>

        {/* ══ 3 Stat cards ══ */}
        <div className="db-stat-grid" style={{ gap: 16, marginBottom: 20 }}>
          <StatCard label="แปลงที่บันทึกทั้งหมด" value={plots.length}  unit="แปลง"  color="#2d9e5f" />
          <StatCard label="พื้นที่ยางพารารวม"   value={totalAreaRai}  unit="ไร่"    color="#0d9488" />
          <StatCard label="คาร์บอนที่กักเก็บ"  value={totalCarbon}   unit="tCO₂"  color="#059669" />
        </div>

        {/* ══ Map ══ */}
        <div style={{ ...S, marginBottom: 20 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px", borderBottom: "1px solid rgba(45,158,95,0.08)",
            flexWrap: "wrap", gap: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{
                width: 9, height: 9, borderRadius: "50%",
                background: "#2d9e5f", boxShadow: "0 0 0 3px rgba(45,158,95,0.2)",
              }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: "#1a3d2b" }}>แผนที่แปลงยางพารา</span>
              {mapPlots.length > 0 && (
                <span style={{
                  padding: "2px 10px", background: "rgba(45,158,95,0.10)",
                  border: "1px solid rgba(45,158,95,0.2)", borderRadius: 50,
                  fontSize: 11, fontWeight: 700, color: "#2d9e5f",
                }}>
                  {mapPlots.length} แปลง
                </span>
              )}
            </div>
            <div className="db-map-legend" style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {[
                { el: <span style={{ display:"inline-block", width:24, height:3, background:"#ea580c", borderRadius:2 }} />, text: "ขอบเขตที่วาด / SHP" },
                { el: <span style={{ display:"inline-block", width:16, height:11, borderRadius:3, background:"rgba(34,197,94,0.5)", border:"2px solid #2d9e5f" }} />, text: "แปลงที่ตรวจจับ" },
              ].map(({ el, text }) => (
                <span key={text} style={{ display:"inline-flex", alignItems:"center", gap:7, fontSize:12, fontWeight:700, color:"#374151" }}>
                  {el}{text}
                </span>
              ))}
            </div>
          </div>
          <div className="db-map-box" style={{ position: "relative", height: 600 }}>
            <DashboardMap plots={mapPlots} bbox={null} />
          </div>
        </div>

        {/* ══ Charts row ══ */}
        <div className="db-charts-row" style={{ gap:16, marginBottom:20 }}>

          {/* Donut */}
          <div style={S}>
            <div style={{ padding:"14px 20px", borderBottom:"1px solid rgba(45,158,95,0.08)", display:"flex", alignItems:"center", gap:8 }}>
              <i className="bi bi-pie-chart-fill" style={{ color:"#2d9e5f", fontSize:15 }} />
              <span style={{ fontSize:14, fontWeight:800, color:"#1a3d2b" }}>สัดส่วนแปลงตามช่วงอายุ</span>
            </div>
            <div style={{ padding:"20px 20px 22px", height:340 }}>
              <DonutChart bucketData={bucketData} total={plots.length} />
            </div>
          </div>

          {/* Age info cards (replaces Area chart to balance layout) */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:12 }}>
              <div>
                <h2 style={{ fontSize:17, fontWeight:900, color:"#1a3d2b", margin:"0 0 4px", display:"flex", alignItems:"center", gap:8 }}>
                  <i className="bi bi-tree-fill" style={{ color:"#2d9e5f" }} />
                  คาร์บอนแต่ละช่วงอายุยาง
                </h2>
                <p style={{ fontSize:13, color:"#64748b", margin:0 }}>ข้อมูลแสดงแยกตามกลุ่มอายุยางพารา</p>
              </div>
              {totalCarbon > 0 && (
                <div style={{
                  display:"inline-flex", alignItems:"center", gap:7,
                  background:"linear-gradient(135deg,#f0fdf4,#dcfce7)",
                  border:"1px solid rgba(45,158,95,0.2)",
                  color:"#166534", padding:"9px 16px", borderRadius:50,
                  fontSize:13, fontWeight:800,
                  boxShadow:"0 2px 8px rgba(45,158,95,0.10)",
                }}>
                  <i className="bi bi-cloud-arrow-up-fill" />
                  รวม {totalCarbon.toLocaleString("th-TH",{maximumFractionDigits:1})} tCO₂
                </div>
              )}
            </div>

            <div className="db-age-grid" style={{ gap:14, flex: 1 }}>
              {bucketData.map(b => {
                const pct = maxCarbon > 0 ? Math.round((b.carbon / maxCarbon) * 100) : 0;
                return (
                  <div key={b.key} style={{
                    background:"#fff",
                    borderRadius:18,
                    border:`1px solid rgba(45,158,95,0.12)`,
                    borderTop:`4px solid ${b.color}`,
                    boxShadow:"0 2px 12px rgba(45,158,95,0.07)",
                    overflow:"hidden",
                    display: "flex", flexDirection: "column",
                    transition:"transform .25s, box-shadow .25s",
                  }}
                    onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform="translateY(-3px)";(e.currentTarget as HTMLDivElement).style.boxShadow="0 10px 28px rgba(45,158,95,0.13)";}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform="";(e.currentTarget as HTMLDivElement).style.boxShadow="0 2px 12px rgba(45,158,95,0.07)";}}
                  >
                    {/* Card top */}
                    <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, fontWeight:800, color:"#1a3d2b" }}>{b.label}</div>
                        <div style={{ fontSize:11, color:"#64748b", fontWeight:500, marginTop:1 }}>
                          {b.key === "1-5" ? "ระยะเริ่มต้น" : b.key === "6-12" ? "ระยะเปิดกรีด" : b.key === "13-18" ? "ระยะสูงสุด" : "ระยะคงที่"}
                        </div>
                      </div>
                      <span style={{
                        fontSize:11, fontWeight:700, padding:"3px 10px",
                        background:"#f8fafc", color:"#64748b", borderRadius:4,
                        border:`1px solid #e2e8f0`,
                      }}>
                        {pct}%
                      </span>
                    </div>

                    {/* Carbon number */}
                    <div style={{ padding:"4px 18px 8px" }}>
                      <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                        <span style={{ fontSize:28, fontWeight:900, color:b.dark, letterSpacing:-1.5, lineHeight:1 }}>
                          {b.carbon.toLocaleString("th-TH",{maximumFractionDigits:1})}
                        </span>
                        <span style={{ fontSize:12, fontWeight:700, color:"#6b7280" }}>tCO₂</span>
                      </div>
                      <div style={{ fontSize:10.5, color:"#9ca3af", fontWeight:600, marginTop:2 }}>ปริมาณคาร์บอน</div>
                    </div>

                    {/* Progress */}
                    <div style={{ padding:"4px 18px 12px", display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ flex:1, height:6, background:"#f0f0f0", borderRadius:4, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${b.color}99,${b.color})`, borderRadius:4, minWidth:4, transition:"width 1.2s cubic-bezier(.16,1,.3,1)" }} />
                      </div>
                    </div>

                    {/* Footer */}
                    <div style={{
                      marginTop: "auto",
                      padding:"12px 18px",
                      borderTop:"1px solid rgba(0,0,0,0.04)",
                      background:"#f8fafc",
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                    }}>
                      {[
                        { label:"จำนวนแปลง", val:b.plotCount.toLocaleString("th-TH"), unit:"แปลง" },
                        { label:"พื้นที่", val:b.areaRai.toLocaleString("th-TH",{maximumFractionDigits:1}), unit:"ไร่" },
                      ].map(({ label, val, unit }) => (
                        <div key={unit} style={{ display:"flex", flexDirection:"column", gap:1 }}>
                          <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600 }}>{label}</div>
                          <div style={{ fontSize:13, fontWeight:700, color:"#1a3d2b" }}>
                            {val} <span style={{ fontSize:11, color:"#64748b", fontWeight:500 }}>{unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      <style>{`
        .db-container { padding: 28px 24px; }
        .db-hero { padding: 32px 36px; }
        .db-stat-grid { display: grid; grid-template-columns: repeat(3,1fr); }
        .db-charts-row { display: grid; grid-template-columns: 1fr 1.6fr; }
        .db-age-grid { display: grid; grid-template-columns: repeat(2,1fr); }

        @media (max-width: 1024px) {
          .db-charts-row { grid-template-columns: 1fr; }
          .db-age-grid { grid-template-columns: repeat(2,1fr); }
        }
        @media (max-width: 768px) {
          .db-container { padding: 16px 14px; }
          .db-hero { padding: 22px 18px; }
          .db-stat-grid { grid-template-columns: repeat(3,1fr); }
          .db-charts-row { grid-template-columns: 1fr; }
          .db-age-grid { grid-template-columns: repeat(2,1fr); }
        }
        @media (max-width: 640px) {
          .db-container { padding: 12px 10px; }
          .db-hero { padding: 18px 14px; border-radius: 16px; }
          .db-hero h1 { font-size: 18px !important; }
          .db-hero p { font-size: 12px !important; }
          .db-stat-grid { grid-template-columns: 1fr 1fr; }
          .db-stat-grid > div:last-child { grid-column: 1 / -1; }
          .db-charts-row { grid-template-columns: 1fr; }
          .db-age-grid { grid-template-columns: 1fr 1fr; }
          .db-map-legend { display: none !important; }
          .db-map-box { height: 400px !important; }
        }
        @media (max-width: 400px) {
          .db-stat-grid { grid-template-columns: 1fr; }
          .db-stat-grid > div:last-child { grid-column: auto; }
          .db-age-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
