"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const HERO_BG =
  "radial-gradient(1200px 500px at -10% -10%, rgba(16,185,129,0.15) 0%, rgba(16,185,129,0) 60%)," +
  "radial-gradient(900px 450px at 110% 0%, rgba(13,148,136,0.12) 0%, rgba(13,148,136,0) 58%)," +
  "radial-gradient(700px 360px at 30% 120%, rgba(22,163,74,0.1) 0%, rgba(22,163,74,0) 55%)," +
  "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.9) 100%)";

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

/* Mini sparkline for forecast progression */
function ForecastBar({ now, yr3, yr5, yr7 }: { now: number; yr3: number; yr5: number; yr7: number }) {
  const max = Math.max(now, yr3, yr5, yr7, 1);
  const pct = (v: number) => Math.round((v / max) * 100);
  const fmt = (v: number) => v > 0 ? v.toLocaleString("th-TH", { maximumFractionDigits: 0 }) : "—";

  const points = [
    { label: "ปัจจุบัน", val: now, color: "#059669" },
    { label: "+3 ปี", val: yr3, color: "#10b981" },
    { label: "+5 ปี", val: yr5, color: "#34d399" },
    { label: "+7 ปี", val: yr7, color: "#6ee7b7" },
  ];

  return (
    <div style={{ marginTop: 16, padding: "14px 16px", background: "rgba(16,185,129,0.04)", borderRadius: 12, border: "1px solid rgba(16,185,129,0.12)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <i className="bi bi-graph-up-arrow" /> พยากรณ์การกักเก็บคาร์บอน (tCO₂)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {points.map(({ label, val, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 52, fontSize: 11, color: "#64748b", textAlign: "right", flexShrink: 0 }}>{label}</div>
            <div style={{ flex: 1, height: 8, background: "rgba(0,0,0,0.05)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${pct(val)}%`,
                background: color,
                borderRadius: 4,
                transition: "width 0.6s ease",
              }} />
            </div>
            <div style={{ width: 72, fontSize: 11, fontWeight: 700, color, textAlign: "right", flexShrink: 0 }}>
              {fmt(val)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlotCard({ plot, onDelete }: { plot: SavedPlot; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fc = plot.forecast;
  const hasForecast = fc && (fc.yr3 > 0 || fc.yr5 > 0 || fc.yr7 > 0);

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 20,
        border: "1px solid rgba(16,185,129,0.12)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
        overflow: "hidden",
        transition: "box-shadow 0.2s ease",
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 8px 32px rgba(16,185,129,0.1)")}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.04)")}
    >
      {/* Card header */}
      <div style={{ padding: "20px 24px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "linear-gradient(135deg,rgba(16,185,129,0.15),rgba(5,150,105,0.1))",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <i className="bi bi-geo-alt-fill" style={{ color: "#059669", fontSize: 18 }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", lineHeight: 1.3 }}>{plot.name}</div>
              {(plot.ownerName || plot.province) && (
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  {plot.ownerName && <span><i className="bi bi-person me-1" />{plot.ownerName}</span>}
                  {plot.ownerName && plot.province && <span> · </span>}
                  {plot.province && <span><i className="bi bi-geo me-1" />{plot.province}</span>}
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0, marginTop: 4 }}>
            {new Date(plot.date).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ padding: "16px 24px 0", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {[
          { label: "พื้นที่", val: `${plot.areaRai > 0 ? plot.areaRai.toFixed(2) : "—"}`, unit: "ไร่", color: "#0d9488" },
          { label: "อายุยาง", val: plot.rubberAge > 0 ? String(plot.rubberAge) : "—", unit: "ปี", color: "#0891b2" },
          { label: "จำนวนต้น", val: plot.trees && plot.trees > 0 ? plot.trees.toLocaleString("th-TH") : "—", unit: "ต้น", color: "#7c3aed" },
          { label: "คาร์บอน", val: plot.carbonTotal > 0 ? plot.carbonTotal.toLocaleString("th-TH", { maximumFractionDigits: 1 }) : "—", unit: "tCO₂", color: "#059669" },
        ].map(({ label, val, unit, color }) => (
          <div key={label} style={{ background: "rgba(0,0,0,0.02)", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color }}>{val}</div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{unit}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Extra info row */}
      {(plot.plantYearBE || plot.confidence) && (
        <div style={{ padding: "10px 24px 0", display: "flex", gap: 16 }}>
          {plot.plantYearBE && plot.plantYearBE > 0 && (
            <div style={{ fontSize: 12, color: "#64748b" }}>
              <i className="bi bi-calendar-event me-1" style={{ color: "#0891b2" }} />
              ปีปลูก <strong style={{ color: "#0f172a" }}>พ.ศ. {plot.plantYearBE}</strong>
            </div>
          )}
          {plot.confidence && plot.confidence > 0 && (
            <div style={{ fontSize: 12, color: "#64748b" }}>
              <i className="bi bi-shield-check me-1" style={{ color: "#7c3aed" }} />
              ความมั่นใจ <strong style={{ color: "#0f172a" }}>{Math.round(plot.confidence * 100)}%</strong>
            </div>
          )}
        </div>
      )}

      {/* Forecast section */}
      <div style={{ padding: "0 24px 0" }}>
        {hasForecast ? (
          <ForecastBar
            now={plot.carbonTotal}
            yr3={fc!.yr3}
            yr5={fc!.yr5}
            yr7={fc!.yr7}
          />
        ) : (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(148,163,184,0.06)", borderRadius: 10, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
            <i className="bi bi-graph-up me-1" /> ไม่มีข้อมูลพยากรณ์ (บันทึกใหม่เพื่อรับข้อมูลนี้)
          </div>
        )}
      </div>

      {/* Accordion: raw details */}
      <div style={{ padding: "0 24px" }}>
        <button
          onClick={() => setExpanded(p => !p)}
          style={{
            width: "100%", marginTop: 14, padding: "8px 0",
            background: "none", border: "none", borderTop: "1px dashed rgba(0,0,0,0.07)",
            cursor: "pointer", fontSize: 12, color: "#64748b", display: "flex",
            alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <i className={`bi bi-chevron-${expanded ? "up" : "down"}`} />
          {expanded ? "ซ่อนรายละเอียด" : "ดูรายละเอียดเพิ่มเติม"}
        </button>

        {expanded && (
          <div style={{ paddingBottom: 16, paddingTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
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
                <div key={k} style={{ padding: "6px 10px", background: "rgba(0,0,0,0.02)", borderRadius: 8 }}>
                  <div style={{ color: "#94a3b8", fontSize: 10 }}>{k}</div>
                  <div style={{ color: "#0f172a", fontWeight: 600, marginTop: 1, wordBreak: "break-all" }}>{v}</div>
                </div>
              ))}
            </div>
            {hasForecast && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(16,185,129,0.05)", borderRadius: 8, fontSize: 12 }}>
                <div style={{ color: "#059669", fontWeight: 700, marginBottom: 4 }}>พยากรณ์ละเอียด (tCO₂)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {[
                    { label: "+3 ปี", val: fc!.yr3 },
                    { label: "+5 ปี", val: fc!.yr5 },
                    { label: "+7 ปี", val: fc!.yr7 },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ color: "#64748b", fontSize: 10 }}>{label}</div>
                      <div style={{ color: "#059669", fontWeight: 800, fontSize: 13 }}>
                        {val.toLocaleString("th-TH", { maximumFractionDigits: 1 })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete action */}
      <div style={{ padding: "0 24px 20px", marginTop: 4 }}>
        {confirmDelete ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "#ef4444", flex: 1 }}>ยืนยันลบแปลงนี้?</span>
            <button
              onClick={onDelete}
              style={{ padding: "6px 16px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}
            >
              ลบ
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ padding: "6px 16px", background: "rgba(0,0,0,0.06)", color: "#64748b", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
            >
              ยกเลิก
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            style={{ fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}
          >
            <i className="bi bi-trash3" /> ลบแปลงนี้
          </button>
        )}
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
    <div style={{ minHeight: "100vh", background: "#f4fcf8", paddingTop: "80px", paddingBottom: "60px", fontFamily: "'Inter', 'Noto Sans Thai', sans-serif" }}>
      <div className="container" style={{ maxWidth: "1040px" }}>

        {/* ── Hero Section ── */}
        <div
          style={{
            background: HERO_BG,
            borderRadius: "24px",
            padding: "40px 48px",
            marginBottom: "24px",
            border: "1px solid rgba(16, 185, 129, 0.15)",
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.03)",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "24px",
          }}
        >
          <div style={{ position: "absolute", top: "-50px", left: "-50px", width: "200px", height: "200px", background: "rgba(16, 185, 129, 0.2)", filter: "blur(60px)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", bottom: "-50px", right: "-50px", width: "250px", height: "250px", background: "rgba(13, 148, 136, 0.15)", filter: "blur(70px)", borderRadius: "50%" }} />

          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              padding: "6px 14px", background: "rgba(16, 185, 129, 0.1)",
              color: "#059669", borderRadius: "50px", fontSize: "13px",
              fontWeight: 700, marginBottom: "12px", border: "1px solid rgba(16, 185, 129, 0.2)",
            }}>
              <i className="bi bi-folder-fill" /> ข้อมูลของฉัน
            </div>
            <h1 style={{ fontSize: "32px", fontWeight: 800, color: "#064e3b", marginBottom: "10px", lineHeight: 1.2 }}>
              แปลงยางพาราของฉัน
            </h1>
            <p style={{ fontSize: "14px", color: "#475569", lineHeight: 1.6, margin: "0 0 20px" }}>
              จัดการและติดตามข้อมูลแปลงยาง รวมการพยากรณ์คาร์บอนในอนาคต
            </p>
            {/* Search bar */}
            <div style={{ position: "relative", maxWidth: 480 }}>
              <i className="bi bi-search" style={{
                position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                color: searchFocused ? "#059669" : "#94a3b8", fontSize: 15, pointerEvents: "none",
                transition: "color 0.15s",
              }} />
              <input
                type="text"
                placeholder="ค้นหาแปลง ชื่อเจ้าของ หรือจังหวัด..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  width: "100%", padding: "12px 40px 12px 42px",
                  borderRadius: 14, fontSize: 14, color: "#0f172a",
                  border: `2px solid ${searchFocused ? "#10b981" : "rgba(16,185,129,0.25)"}`,
                  background: "rgba(255,255,255,0.95)", outline: "none",
                  boxShadow: searchFocused ? "0 0 0 4px rgba(16,185,129,0.1)" : "0 4px 14px rgba(0,0,0,0.05)",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: "#94a3b8", fontSize: 17, padding: 2, lineHeight: 1,
                  }}
                >
                  <i className="bi bi-x-circle-fill" />
                </button>
              )}
            </div>
          </div>

          <div style={{ position: "relative", zIndex: 1 }}>
            <Link
              href="/map-draw"
              style={{
                display: "inline-flex", alignItems: "center", gap: "10px",
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "#ffffff", padding: "14px 28px", borderRadius: "14px",
                fontWeight: 700, fontSize: "15px", textDecoration: "none",
                boxShadow: "0 8px 20px rgba(16, 185, 129, 0.3)",
              }}
            >
              <i className="bi bi-plus-circle" style={{ fontSize: "18px" }} /> วาดแปลงใหม่
            </Link>
          </div>
        </div>

        {/* ── Summary KPIs ── */}
        {plots.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24,
          }}>
            {[
              { label: "แปลงทั้งหมด", val: plots.length.toLocaleString("th-TH"), unit: "แปลง", icon: "bi-map", color: "#16a34a", bg: "rgba(22,163,74,0.08)" },
              { label: "พื้นที่รวม", val: totalArea.toFixed(2), unit: "ไร่", icon: "bi-grid-fill", color: "#0d9488", bg: "rgba(13,148,136,0.08)" },
              { label: "คาร์บอนรวม", val: totalCarbon.toLocaleString("th-TH", { maximumFractionDigits: 1 }), unit: "tCO₂", icon: "bi-cloud-arrow-up-fill", color: "#059669", bg: "rgba(5,150,105,0.08)" },
            ].map(({ label, val, unit, icon, color, bg }) => (
              <div key={label} style={{ background: "#fff", borderRadius: 16, padding: "18px 20px", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`bi ${icon}`} style={{ color, fontSize: 15 }} />
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color }}>{val}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{unit}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Content Area ── */}
        {plots.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.8)", backdropFilter: "blur(20px)",
            borderRadius: "24px", padding: "60px 40px", textAlign: "center",
            border: "1px solid rgba(45,158,95,0.1)", boxShadow: "0 10px 30px rgba(0,0,0,0.02)",
            display: "flex", flexDirection: "column", alignItems: "center", minHeight: "360px", justifyContent: "center",
          }}>
            <div style={{
              width: "90px", height: "90px", borderRadius: "50%",
              background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(13,148,136,0.1))",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: "20px", position: "relative", border: "1px solid rgba(16,185,129,0.2)",
            }}>
              <div style={{ position: "absolute", inset: "-10px", border: "1px dashed rgba(16,185,129,0.3)", borderRadius: "50%" }} />
              <i className="bi bi-map" style={{ fontSize: "38px", color: "#059669" }} />
            </div>
            <h3 style={{ fontSize: "22px", fontWeight: 800, color: "#064e3b", marginBottom: "10px" }}>
              ยังไม่มีข้อมูลแปลงยาง
            </h3>
            <p style={{ fontSize: "14px", color: "#64748b", maxWidth: "440px", lineHeight: 1.6, marginBottom: "28px" }}>
              เริ่มวาดแปลงบนแผนที่เพื่อตรวจจับและบันทึกข้อมูลแปลงยางพาราพร้อมการพยากรณ์คาร์บอน
            </p>
            <Link href="/map-draw" style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              background: "#fff", color: "#059669", padding: "12px 24px",
              borderRadius: "12px", fontWeight: 700, fontSize: "14px",
              textDecoration: "none", border: "2px solid #10b981",
              boxShadow: "0 4px 12px rgba(16,185,129,0.1)",
            }}>
              <i className="bi bi-pencil-square" /> ไปหน้าวาดแปลงยาง
            </Link>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", padding: "0 4px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#064e3b", margin: 0 }}>
                รายการแปลงที่บันทึกแล้ว
                {searchTerm ? (
                  <span style={{ fontSize: 13, fontWeight: 400, color: "#64748b", marginLeft: 8 }}>
                    พบ {filteredPlots.length} จาก {plots.length} แปลง
                  </span>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 400, color: "#64748b", marginLeft: 8 }}>
                    ({plots.length})
                  </span>
                )}
              </h2>
            </div>

            {filteredPlots.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 20, color: "#94a3b8", fontSize: 14 }}>
                <i className="bi bi-search" style={{ fontSize: 32, display: "block", marginBottom: 10 }} />
                ไม่พบแปลงที่ตรงกับ &ldquo;<strong style={{ color: "#64748b" }}>{searchTerm}</strong>&rdquo;
                <br />
                <button
                  onClick={() => setSearchTerm("")}
                  style={{ marginTop: 14, padding: "6px 16px", background: "rgba(16,185,129,0.08)", color: "#059669", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                >
                  ล้างการค้นหา
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {filteredPlots.map((plot) => (
                  <PlotCard
                    key={plot.id}
                    plot={plot}
                    onDelete={() => handleDelete(plot.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
