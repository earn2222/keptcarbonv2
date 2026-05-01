"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardMap from "./DashboardMap";
import CarbonAgeChart from "./CarbonAgeChart";

type SavedPlot = {
  id: string;
  name: string;
  areaRai: number;
  carbonTotal: number;
  rubberAge: number;
  plantYearBE?: number;
  trees?: number;
  ownerName?: string;
  province?: string;
  date?: string;
  geojson?: GeoJSON.GeoJSON | null;
  forecast?: { yr3: number; yr5: number; yr7: number };
};

function useCounter(target: number, duration = 1400) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(start);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

function StatCard({
  topLabel, sublabel, sublabelIcon, unit, rawValue, iconClass, iconBg, iconColor, accentColor,
}: {
  topLabel: string; sublabel: string; sublabelIcon: string;
  unit: string; rawValue: number;
  iconClass: string; iconBg: string; iconColor: string; accentColor: string;
}) {
  const animated = useCounter(rawValue);
  const isInt = Number.isInteger(rawValue);
  const display = isInt
    ? Math.round(animated).toLocaleString("th-TH")
    : animated.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="dv2-stat-card">
      <div className="dv2-stat-top">
        <span className="dv2-stat-toplabel">{topLabel}</span>
        <div className="dv2-stat-icon-box" style={{ background: iconBg, color: iconColor }}>
          <i className={`bi ${iconClass}`} />
        </div>
      </div>
      <div className="dv2-stat-bigval" style={{ color: accentColor }}>
        {display}
        <span className="dv2-stat-unit">{unit}</span>
      </div>
      <div className="dv2-stat-sublabel">
        <i className={`bi ${sublabelIcon}`} />
        {sublabel}
      </div>
      <div className="dv2-stat-bar" style={{ background: accentColor }} />
    </div>
  );
}

export default function DashboardPage() {
  const [plots, setPlots] = useState<SavedPlot[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("user_saved_plots");
      if (stored) setPlots(JSON.parse(stored));
    } catch {}
    setMounted(true);
  }, []);

  const totalPlots = plots.length;
  const totalAreaRai = useMemo(
    () => plots.reduce((s, p) => s + (p.areaRai || 0), 0),
    [plots],
  );
  const totalCarbon = useMemo(
    () => plots.reduce((s, p) => s + (p.carbonTotal || 0), 0),
    [plots],
  );

  const ageData = useMemo(() => {
    const grouped: Record<number, { carbon: number; plotCount: number }> = {};
    plots.forEach(p => {
      const age = p.rubberAge || 0;
      if (age > 0) {
        if (!grouped[age]) grouped[age] = { carbon: 0, plotCount: 0 };
        grouped[age].carbon += p.carbonTotal || 0;
        grouped[age].plotCount += 1;
      }
    });
    return Object.entries(grouped)
      .map(([age, v]) => ({ age: Number(age), ...v }))
      .sort((a, b) => a.age - b.age);
  }, [plots]);

  const mapPlots = useMemo(
    () =>
      plots
        .filter(p => p.geojson)
        .map(p => ({
          id: p.id,
          name: p.name,
          areaRai: p.areaRai,
          carbonTotal: p.carbonTotal,
          geojson: p.geojson as GeoJSON.GeoJSON,
        })),
    [plots],
  );

  if (!mounted) {
    return (
      <div className="dv2-root dv2-loading">
        <div className="dv2-spinner" />
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  return (
    <div className="dv2-root">
      <div className="dv2-container">

        {/* ══ Stat Cards Row ══ */}
        <div className="dv2-stats-row">
          <StatCard
            topLabel="จำนวนแปลงของฉัน"
            sublabel="แปลงที่วาดและตรวจจับแล้ว"
            sublabelIcon="bi-layers"
            unit="แปลง"
            rawValue={totalPlots}
            iconClass="bi-layers-fill"
            iconBg="rgba(22,163,74,0.1)"
            iconColor="#16a34a"
            accentColor="#16a34a"
          />
          <StatCard
            topLabel="พื้นที่สวนยางรวม"
            sublabel="พื้นที่รวมของแปลงที่บันทึก"
            sublabelIcon="bi-grid"
            unit="ไร่"
            rawValue={totalAreaRai}
            iconClass="bi-grid-fill"
            iconBg="rgba(13,148,136,0.1)"
            iconColor="#0d9488"
            accentColor="#0d9488"
          />
          <StatCard
            topLabel="คาร์บอนที่กักเก็บได้รวม"
            sublabel="คิดจากแปลงที่วาดและบันทึก"
            sublabelIcon="bi-cloud-arrow-up"
            unit="tCO₂"
            rawValue={totalCarbon}
            iconClass="bi-cloud-arrow-up-fill"
            iconBg="rgba(5,150,105,0.1)"
            iconColor="#059669"
            accentColor="#059669"
          />
        </div>

        {/* ══ Map Section ══ */}
        <div className="dv2-section-card">
          <div className="dv2-section-hd">
            <div className="dv2-section-hd-left">
              <span className="dv2-section-dot" />
              <span className="dv2-section-title">แผนที่แปลงยางที่วาดและตรวจจับ</span>
            </div>
            <Link href="/my-plots" className="dv2-section-link">
              <i className="bi bi-geo-alt-fill" />
              ดูแปลงของฉัน
            </Link>
          </div>
          <div className="dv2-map-wrap">
            <DashboardMap plots={mapPlots} />
            {mapPlots.length === 0 && (
              <div className="dv2-map-empty-overlay">
                <div className="dv2-map-empty-box">
                  <i className="bi bi-map" />
                  <p>ยังไม่มีแปลงที่วาดและบันทึก</p>
                  <Link href="/map-draw" className="dv2-btn-primary">
                    <i className="bi bi-plus-circle" />วาดแปลง
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ══ Chart Section ══ */}
        <div className="dv2-section-card">
          <div className="dv2-section-hd">
            <div className="dv2-section-hd-left">
              <i className="bi bi-bar-chart-line-fill dv2-chart-hd-icon" />
              <span className="dv2-section-title">คาร์บอนสะสมตามอายุยางในแปลงของฉัน</span>
            </div>
            <span className="dv2-chart-hint">
              <i className="bi bi-info-circle" />
              คาร์บอน CO₂ สะสมต่อช่วงอายุ จากแปลงที่บันทึก
            </span>
          </div>
          <div className="dv2-chart-body">
            <CarbonAgeChart ageData={ageData} />
          </div>
        </div>

        {/* ══ Empty CTA ══ */}
        {plots.length === 0 && (
          <div style={{
            textAlign: "center",
            padding: "40px 20px",
            background: "#fff",
            borderRadius: "20px",
            border: "1px dashed rgba(16,185,129,0.3)",
            marginTop: 8,
          }}>
            <i className="bi bi-pencil-square" style={{ fontSize: 40, color: "#10b981", display: "block", marginBottom: 12 }} />
            <p style={{ color: "#64748b", marginBottom: 20, fontSize: 15 }}>
              ยังไม่มีข้อมูลแปลง — เริ่มวาดขอบเขตบนแผนที่เพื่อตรวจจับแปลงยางพารา
            </p>
            <Link href="/map-draw" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "linear-gradient(135deg,#10b981,#059669)",
              color: "#fff", padding: "12px 28px", borderRadius: 12,
              fontWeight: 700, fontSize: 15, textDecoration: "none",
            }}>
              <i className="bi bi-plus-circle" /> วาดแปลงใหม่
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}
