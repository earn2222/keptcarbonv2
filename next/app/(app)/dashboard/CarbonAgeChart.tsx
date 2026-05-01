"use client";

import { useEffect, useRef } from "react";
import {
  Chart,
  BarController,
  LineController,
  BarElement,
  PointElement,
  LineElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartItem,
} from "chart.js";

Chart.register(
  BarController, LineController,
  BarElement, PointElement, LineElement,
  CategoryScale, LinearScale,
  Tooltip, Legend,
);

/* Age bucket color config */
const BUCKETS = [
  { label: "1-5 ปี",   minAge: 1,  maxAge: 5,  color: "#a7f3d0", border: "#34d399" },
  { label: "6-12 ปี",  minAge: 6,  maxAge: 12, color: "#6ee7b7", border: "#10b981" },
  { label: "13-18 ปี", minAge: 13, maxAge: 18, color: "#34d399", border: "#059669" },
  { label: "19-25 ปี", minAge: 19, maxAge: 25, color: "#10b981", border: "#047857" },
];

/* Reference carbon curve per year (tCO₂/ไร่ ประมาณ) */
const REF_CARBON: Record<number, number> = {
  1: 40, 2: 100, 3: 170, 4: 240, 5: 320,
  6: 420, 7: 540, 8: 670, 9: 790, 10: 920,
  11: 1050, 12: 1180, 13: 1500, 14: 1850, 15: 2000,
  16: 2150, 17: 2200, 18: 2250, 19: 2200, 20: 2200,
  21: 2250, 22: 2200, 23: 2200, 24: 2200, 25: 2250,
};

type AgeDataItem = { age: number; carbon: number; plotCount: number };

function getBucketForAge(age: number) {
  return BUCKETS.find((b) => age >= b.minAge && age <= b.maxAge);
}

export default function CarbonAgeChart({ ageData }: { ageData: AgeDataItem[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  /* Build per-year carbon totals from ageData */
  const perYear: Record<number, number> = {};
  for (let y = 1; y <= 25; y++) perYear[y] = 0;
  ageData.forEach(({ age, carbon }) => {
    const clamped = Math.max(1, Math.min(25, Math.round(age)));
    if (clamped >= 1 && clamped <= 25) perYear[clamped] += carbon;
  });

  const years = Array.from({ length: 25 }, (_, i) => i + 1);
  const barData = years.map((y) => parseFloat(perYear[y].toFixed(2)));
  const barColors = years.map((y) => getBucketForAge(y)?.color ?? "#a7f3d0");
  const barBorders = years.map((y) => getBucketForAge(y)?.border ?? "#34d399");
  const refCurve = years.map((y) => REF_CARBON[y] ?? 0);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();

    const ctx = canvasRef.current.getContext("2d") as ChartItem;

    chartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: years.map((y) => `${y} ปี`),
        datasets: [
          {
            type: "bar",
            label: "คาร์บอนสะสม (tCO₂)",
            data: barData,
            backgroundColor: barColors,
            borderColor: barBorders,
            borderWidth: 1.5,
            borderRadius: 6,
            borderSkipped: false,
            order: 2,
          },
          {
            type: "line",
            label: "เส้นอ้างอิง",
            data: refCurve,
            borderColor: "#f97316",
            borderWidth: 2,
            borderDash: [6, 4],
            pointBackgroundColor: "#f97316",
            pointRadius: (ctx: any) => (ctx.dataIndex % 2 === 0 ? 4 : 0),
            pointHoverRadius: 6,
            tension: 0.4,
            fill: false,
            order: 1,
          } as never,
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 45, 28, 0.92)",
            titleColor: "#4ade80",
            bodyColor: "#d1fae5",
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (ctx) =>
                (ctx.dataset.type as string) === "line"
                  ? ` เส้นอ้างอิง: ${(ctx.parsed.y as number).toLocaleString()} tCO₂`
                  : ` ${(ctx.parsed.y as number).toLocaleString("th-TH", { minimumFractionDigits: 2 })} tCO₂`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: "#6b7280",
              font: { size: 11, weight: "bold" },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: "rgba(0,0,0,0.05)", drawTicks: false },
            border: { display: false },
            ticks: {
              color: "#6b7280",
              font: { size: 11 },
              padding: 8,
              callback: (v) => Number(v) >= 1000 ? `${Number(v) / 1000}k` : String(v),
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageData]);

  /* Bucket summary: count plots per bucket from ageData */
  const bucketSummary = BUCKETS.map((b) => {
    const count = ageData
      .filter(({ age }) => age >= b.minAge && age <= b.maxAge)
      .reduce((s, { plotCount }) => s + plotCount, 0);
    return { ...b, count };
  });

  const hasData = ageData.some((d) => d.carbon > 0);

  if (!hasData) {
    return (
      <div className="dv2-chart-empty">
        <i className="bi bi-bar-chart-line" />
        <p>ยังไม่มีข้อมูลคาร์บอนในระบบ</p>
      </div>
    );
  }

  return (
    <div className="dv2-chart-inner">
      {/* Legend chips */}
      <div className="dv2-chart-legend-row">
        {BUCKETS.map((b) => (
          <span key={b.label} className="dv2-chart-chip" style={{ background: b.color, borderColor: b.border }}>
            <span className="dv2-chip-dot" style={{ background: b.border }} />
            {b.label}
          </span>
        ))}
        <span className="dv2-chart-chip dv2-chip-ref">
          <span className="dv2-chip-dash" />
          ค่าอ้างอิงจากแปลงในระบบ
        </span>
      </div>

      {/* Bar chart */}
      <div className="dv2-chart-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>

      {/* Bucket summary pills */}
      <div className="dv2-bucket-pills">
        <span className="dv2-bucket-label">แปลงตามช่วงอายุ:</span>
        {bucketSummary.map((b) => (
          <span key={b.label} className="dv2-bucket-pill" style={{ background: b.color, borderColor: b.border }}>
            <span className="dv2-chip-dot" style={{ background: b.border }} />
            {b.label} · {b.count.toLocaleString("th-TH")} แปลง
          </span>
        ))}
      </div>
    </div>
  );
}
