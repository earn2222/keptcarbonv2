"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardMap from "./DashboardMap";
import CarbonAgeChart from "./CarbonAgeChart";

/* ── Types ── */
type DashStats = {
  totalPlots: number;
  totalAreaRai: number;
  totalCarbon: number;
  ageData: { age: number; carbon: number; plotCount: number }[];
  mapPlots: {
    id: string;
    name: string;
    areaRai: number;
    carbonTotal: number;
    geojson: GeoJSON.GeoJSON;
  }[];
};

/* Animated counter hook */
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

/* ── Stat Card — matches screenshot 2 design ── */
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
      {/* Top row: label + icon */}
      <div className="dv2-stat-top">
        <span className="dv2-stat-toplabel">{topLabel}</span>
        <div className="dv2-stat-icon-box" style={{ background: iconBg, color: iconColor }}>
          <i className={`bi ${iconClass}`} />
        </div>
      </div>
      {/* Big value */}
      <div className="dv2-stat-bigval" style={{ color: accentColor }}>
        {display}
        <span className="dv2-stat-unit">{unit}</span>
      </div>
      {/* Sub-label with icon */}
      <div className="dv2-stat-sublabel">
        <i className={`bi ${sublabelIcon}`} />
        {sublabel}
      </div>
      {/* Bottom accent bar */}
      <div className="dv2-stat-bar" style={{ background: accentColor }} />
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DashStats>;
      })
      .then((data) => setStats(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="dv2-root dv2-loading">
        <div className="dv2-spinner" />
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dv2-root dv2-loading">
        <i className="bi bi-exclamation-circle" style={{ fontSize: 40, color: "#ef4444" }} />
        <p style={{ color: "#ef4444" }}>เกิดข้อผิดพลาด: {error}</p>
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="dv2-root">
      <div className="dv2-container">

        {/* ══ Stat Cards Row ══ */}
        <div className="dv2-stats-row">

          {/* Card 1: จำนวนแปลงสวนยาง */}
          <StatCard
            topLabel="จำนวนแปลงสวนยาง"
            sublabel="แปลงที่ลงทะเบียนในระบบแล้ว"
            sublabelIcon="bi-layers"
            unit="แปลง"
            rawValue={s.totalPlots}
            iconClass="bi-layers-fill"
            iconBg="rgba(22,163,74,0.1)"
            iconColor="#16a34a"
            accentColor="#16a34a"
          />

          {/* Card 2: พื้นที่สวนยางรวม */}
          <StatCard
            topLabel="พื้นที่สวนยางรวม"
            sublabel="พื้นที่รวมของทุกแปลงในระบบ"
            sublabelIcon="bi-grid"
            unit="ไร่"
            rawValue={s.totalAreaRai}
            iconClass="bi-grid-fill"
            iconBg="rgba(13,148,136,0.1)"
            iconColor="#0d9488"
            accentColor="#0d9488"
          />

          {/* Card 3: คาร์บอนที่กักเก็บได้รวม */}
          <StatCard
            topLabel="คาร์บอนที่กักเก็บได้รวม"
            sublabel="คิดจากทุกแปลงที่ประเมินแล้ว"
            sublabelIcon="bi-cloud-arrow-up"
            unit="tCO₂"
            rawValue={s.totalCarbon}
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
              <span className="dv2-section-title">แผนที่ภาพรวมแปลงสวนยางในระบบ</span>
            </div>
            <Link href="/my-plots" className="dv2-section-link">
              <i className="bi bi-geo-alt-fill" />
              ตำแหน่งแปลงในระบบ
            </Link>
          </div>
          <div className="dv2-map-wrap">
            <DashboardMap plots={s.mapPlots} />
            {s.mapPlots.length === 0 && (
              <div className="dv2-map-empty-overlay">
                <div className="dv2-map-empty-box">
                  <i className="bi bi-map" />
                  <p>ยังไม่มีข้อมูลแปลงในระบบ</p>
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
              <span className="dv2-section-title">ต้นยางแต่ละอายุกักเก็บคาร์บอนได้เท่าไร?</span>
            </div>
            <span className="dv2-chart-hint">
              <i className="bi bi-info-circle" />
              ดันคาร์บอน CO₂ ต่อไร่ · รวมประมาณ 80 ตัน/ไร่ (ค่าประมาณ)
            </span>
          </div>
          <div className="dv2-chart-body">
            <CarbonAgeChart ageData={s.ageData} />
          </div>
        </div>

      </div>
    </div>
  );
}
