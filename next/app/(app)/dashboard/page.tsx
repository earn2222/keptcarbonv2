"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlotDB, type Plot } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { Card, Eyebrow } from "@/app/components";
import DashboardMap from "./DashboardMap";
import CarbonChart from "./CarbonChart";

const HERO_BG =
    "radial-gradient(1200px 500px at -10% -10%, rgba(16,185,129,0.20) 0%, rgba(16,185,129,0) 60%)," +
    "radial-gradient(900px 450px at 110% 0%, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0) 58%)," +
    "radial-gradient(700px 360px at 30% 120%, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0) 55%)," +
    "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.86) 100%)";

function formatDate(iso: string | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

const statCards = [
  { icon: "bi-collection", label: "จำนวนแปลงทั้งหมด", unit: "แปลง", key: "count" as const },
  { icon: "bi-wind", label: "คาร์บอนรวม", unit: "tCO₂", key: "carbon" as const },
  { icon: "bi-rulers", label: "พื้นที่รวม", unit: "ไร่", key: "area" as const },
  { icon: "bi-tree-fill", label: "ต้นยางโดยประมาณ", unit: "ต้น", key: "trees" as const },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [plots, setPlots] = useState<Plot[]>([]);

  useEffect(() => {
    if (user) setPlots(PlotDB.getPlots(user.id));
  }, [user]);

  const totalCarbon = plots.reduce((s, p) => s + num(p.carbonTotal), 0);
  const totalArea = plots.reduce((s, p) => s + num(p.areaRai), 0);
  const totalTrees = plots.reduce((s, p) => s + num(p.treeCount), 0);

  const values: Record<"count" | "carbon" | "area" | "trees", string> = {
    count: plots.length.toString(),
    carbon: totalCarbon.toFixed(1),
    area: totalArea.toFixed(2),
    trees: totalTrees.toLocaleString(),
  };

  return (
    <>
      {/* === Welcome hero === */}
      <section style={{ paddingTop: 8, paddingBottom: 0 }}>
        <div className="container">
          <Card className="border-0 shadow-sm mb-2 overflow-hidden">
            <div className="p-4 p-md-5" style={{ background: HERO_BG, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
                <div style={{ maxWidth: 640 }}>
                  <Eyebrow icon="bi-stars" className="mb-2">ภาพรวมประจำวัน</Eyebrow>
                  <h1 className="fw-bold mb-2" style={{ letterSpacing: "-0.02em" }}>
                    {user ? user.fullname : "ยินดีต้อนรับ"}
                    {", "}
                    <span className="kc-grad-text">เริ่มต้นวันที่ดี</span>
                  </h1>
                  <p className="text-muted mb-0">
                    ติดตามแปลงยางพารา การกักเก็บคาร์บอน และความเปลี่ยนแปลงในระบบนิเวศของคุณในมุมมองเดียว
                  </p>
                </div>
                <Link
                  href="/map-draw"
                  className="btn"
                  style={{
                    background: "linear-gradient(135deg, #065f46 0%, #059669 100%)",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 20px",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    boxShadow: "none",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  <i className="bi bi-plus-circle me-2"></i>วาดแปลงใหม่
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* === Stats === */}
      <section className="kc-section" style={{ paddingTop: 36, paddingBottom: 12 }}>
        <div className="container">
          <div className="kc-section-head">
            <h2 className="kc-section-title">
              <i className="bi bi-bar-chart-fill"></i> ตัวเลขสำคัญ
            </h2>
            <span className="kc-section-aside">อัปเดตจากแปลงทั้งหมด</span>
          </div>
          <div className="row g-3">
            {statCards.map((c) => (
              <div className="col-6 col-lg-3" key={c.key}>
                <div className="kc-stat">
                  <div className="kc-stat-icon">
                    <i className={`bi ${c.icon}`}></i>
                  </div>
                  <div className="kc-stat-value">
                    <span>{values[c.key]}</span>
                    <span className="unit">{c.unit}</span>
                  </div>
                  <div className="kc-stat-label">{c.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === Map + Chart === */}
      <section className="kc-section" style={{ paddingTop: 24 }}>
        <div className="container">
          <div className="row g-4">
            <div className="col-lg-8">
              <div className="kc-panel">
                <div className="kc-panel-header">
                  <div className="title">
                    <i className="bi bi-geo-alt-fill"></i>
                    <span>แผนที่ภาพรวมแปลง</span>
                  </div>
                  <span className="meta">{plots.length} แปลง · ภาคตะวันออก</span>
                </div>
                <div className="kc-panel-body no-pad">
                  <DashboardMap plots={plots} />
                </div>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="kc-panel">
                <div className="kc-panel-header">
                  <div className="title">
                    <i className="bi bi-pie-chart-fill"></i>
                    <span>การกระจายคาร์บอน</span>
                  </div>
                  <span className="meta">tCO₂</span>
                </div>
                <div className="kc-panel-body">
                  <div className="kc-chart-wrap">
                    {plots.length === 0 ? (
                      <div className="kc-chart-empty">
                        <i className="bi bi-pie-chart"></i>
                        ยังไม่มีข้อมูลแปลง
                      </div>
                    ) : (
                      <CarbonChart plots={plots} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* === Recent plots === */}
      <section className="kc-section" style={{ paddingTop: 24, paddingBottom: 80 }}>
        <div className="container">
          <div className="kc-section-head">
            <h2 className="kc-section-title">
              <i className="bi bi-clock-history"></i> แปลงล่าสุด
            </h2>
            {plots.length > 0 && (
              <Link href="/my-plots" className="kc-section-aside" style={{ textDecoration: "none" }}>
                ดูทั้งหมด <i className="bi bi-arrow-right"></i>
              </Link>
            )}
          </div>
          {plots.length === 0 ? (
            <div className="kc-empty">
              <div className="icon-circle">
                <i className="bi bi-map"></i>
              </div>
              <h3>ยังไม่มีแปลงยาง</h3>
              <p>เริ่มต้นด้วยการวาดแปลงแรกของคุณบนแผนที่ดาวเทียม</p>
              <Link href="/map-draw" className="kc-welcome-cta">
                <i className="bi bi-plus-circle"></i> วาดแปลงใหม่
              </Link>
            </div>
          ) : (
            <div className="row g-3">
              {plots.slice(0, 3).map((plot) => (
                <div className="col-md-4" key={plot.id}>
                  <div className="kc-plot">
                    <div className="kc-plot-name">{(plot.name as string) ?? "แปลงไม่มีชื่อ"}</div>
                    <div className="kc-plot-meta">
                      <i className="bi bi-person"></i>
                      <span>{(plot.ownerName as string) ?? "ไม่ระบุ"}</span>
                    </div>
                    <div className="kc-plot-meta">
                      <i className="bi bi-calendar3"></i>
                      <span>{formatDate(plot.createdAt as string | undefined)}</span>
                    </div>
                    <div className="kc-plot-foot">
                      <span className="kc-plot-area">
                        <strong>{num(plot.areaRai).toFixed(2)}</strong>ไร่
                      </span>
                      <span className="kc-plot-badge">
                        <i className="bi bi-wind"></i>
                        {num(plot.carbonTotal).toFixed(1)} tCO₂
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
