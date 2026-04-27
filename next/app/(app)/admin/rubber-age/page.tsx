"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Alert, Card, Eyebrow } from "@/app/components";
import {
    Chart,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    type ChartItem,
} from "chart.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

// ─── Types ──────────────────────────────────────────────────────────────────

type ParcelRow = {
    id: number;
    farm_name: string;
    farm_idc: string;
    app_no: string;
    land_seq: number;
    tambon: string;
    amphur: string;
    province: string;
    grow_year: number | null;
    rip_type: string;
    grow_area: string;
    geometry: GeoJSON.Geometry;
};

type BfastResult = {
    state: "idle" | "loading" | "done" | "error";
    plantingYear?: number | null;
    age?: number | null;
    confidence?: number;
    method?: "bfast" | "raster";
    reason?: string | null;
};

type FilterState = {
    province: string;
    amphur: string;
    tambon: string;
    growYearMin: string;
    growYearMax: string;
    limit: string;
};

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_LIMIT = "200";
const DEFAULT_FILTERS: FilterState = {
    province: "",
    amphur: "",
    tambon: "",
    growYearMin: "",
    growYearMax: "",
    limit: DEFAULT_LIMIT,
};

function bboxFromGeometry(g: GeoJSON.Geometry): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const push = (x: number, y: number) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        has = true;
    };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let has = false;

    const walk = (coords: any) => {
        if (!coords) return;
        if (typeof coords[0] === "number" && typeof coords[1] === "number") {
            push(coords[0], coords[1]);
            return;
        }
        if (Array.isArray(coords)) {
            for (const c of coords) walk(c);
        }
    };

    if (g.type === "Polygon" || g.type === "MultiPolygon" || g.type === "LineString" || g.type === "MultiLineString") {
        // @ts-expect-error coordinates shape varies; we walk generically
        walk(g.coordinates);
    } else if (g.type === "Point") {
        // @ts-expect-error Point coordinates
        const [x, y] = g.coordinates;
        push(x, y);
    } else if (g.type === "MultiPoint") {
        // @ts-expect-error MultiPoint coordinates
        walk(g.coordinates);
    } else if (g.type === "GeometryCollection") {
        for (const gg of g.geometries ?? []) {
            const b = bboxFromGeometry(gg);
            if (b) {
                push(b.minX, b.minY);
                push(b.maxX, b.maxY);
            }
        }
    }

    return has ? { minX, minY, maxX, maxY } : null;
}

function bboxPolygon(b: { minX: number; minY: number; maxX: number; maxY: number }): GeoJSON.Polygon {
    return {
        type: "Polygon",
        coordinates: [[
            [b.minX, b.minY],
            [b.maxX, b.minY],
            [b.maxX, b.maxY],
            [b.minX, b.maxY],
            [b.minX, b.minY],
        ]],
    };
}

function fmt(v: unknown) {
    return v == null || v === "" ? "—" : String(v);
}

function formatThaiYear(year: number | null | undefined) {
    if (year == null) return "—";
    return year >= 2400 ? String(year) : String(year + 543);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminRubberAgePage() {
    const router = useRouter();
    const { ready, user } = useAuth();

    // Guard: admin only
    useEffect(() => {
        if (ready && (!user || user.role !== "admin")) {
            router.replace("/dashboard");
        }
    }, [ready, user, router]);

    // ── Parcel list state ──
    const [parcels, setParcels] = useState<ParcelRow[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [fetchingParcels, setFetchingParcels] = useState(false);
    const [parcelErr, setParcelErr] = useState<string | null>(null);
    const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

    // ── Selection state ──
    const [selected, setSelected] = useState<Set<number>>(new Set()); // Set of parcel `id`

    // ── BFAST state ──
    const [bfastMap, setBfastMap] = useState<Record<number, BfastResult>>({}); // keyed by parcel id
    const [bfastRunning, setBfastRunning] = useState(false);
    const [bfastProgress, setBfastProgress] = useState({ done: 0, total: 0 });

    // ── Method ──
    const [calcMethod, setCalcMethod] = useState<"raster" | "bfast">("raster");

    // ── DB update state ──
    const [updating, setUpdating] = useState(false);
    const [updateMsg, setUpdateMsg] = useState<{ text: string; ok: boolean } | null>(null);

    // ── Raster generation state ──
    const [rasterGenerating, setRasterGenerating] = useState(false);
    const [rasterMsg, setRasterMsg] = useState<{ text: string; ok: boolean } | null>(null);
    const [rasterReady, setRasterReady] = useState(false);
    const [rasterFilename, setRasterFilename] = useState("rubber_age_selected_area.tif");

    // ── Chart ──
    const chartRef = useRef<Chart | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // ── Derive BFAST-done rows ──
    const bfastDoneCount = Object.values(bfastMap).filter((r) => r.state === "done").length;

    // ── Fetch parcels ──
    const fetchParcels = useCallback(async (override?: Partial<FilterState>) => {
        const active = { ...filters, ...(override ?? {}) };
        setFetchingParcels(true);
        setParcelErr(null);
        setParcels([]);
        setTotal(null);
        setSelected(new Set());
        setBfastMap({});
        setUpdateMsg(null);
        setRasterMsg(null);
        setRasterReady(false);

        const sp = new URLSearchParams();
        if (active.province.trim()) sp.set("province", active.province.trim());
        if (active.amphur.trim()) sp.set("amphur", active.amphur.trim());
        if (active.tambon.trim()) sp.set("tambon", active.tambon.trim());
        if (active.growYearMin.trim()) sp.set("grow_year_min", active.growYearMin.trim());
        if (active.growYearMax.trim()) sp.set("grow_year_max", active.growYearMax.trim());
        sp.set("limit", String(Math.min(Number(active.limit) || 200, 2000)));

        try {
            const res = await fetch(`/api/admin/parcels?${sp.toString()}`, {
                credentials: "include",
            });
            const data = await res.json() as {
                features?: Array<{ properties: ParcelRow; geometry: GeoJSON.Geometry }>;
                total?: number;
                error?: string;
            };
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            const rows = (data.features ?? []).map((f) => ({
                ...f.properties,
                geometry: f.geometry,
            }));
            setParcels(rows);
            setTotal(data.total ?? rows.length);
        } catch (err) {
            setParcelErr(err instanceof Error ? err.message : String(err));
        } finally {
            setFetchingParcels(false);
        }
    }, [filters]);

    useEffect(() => {
        if (!ready || !user || user.role !== "admin") return;
        if (fetchingParcels || total !== null) return;
        fetchParcels();
    }, [ready, user, fetchParcels, fetchingParcels, total]);

    // ── Chart: age distribution from GEE+BFAST results ──
    useEffect(() => {
        if (!canvasRef.current) return;
        chartRef.current?.destroy();

        const ages = Object.values(bfastMap)
            .filter((r) => r.state === "done" && r.age != null)
            .map((r) => Number(r.age))
            .filter((a) => a > 0);
        if (ages.length === 0) return;

        const brackets = [0, 0, 0, 0, 0];
        for (const a of ages) {
            if (a <= 5) brackets[0]++;
            else if (a <= 10) brackets[1]++;
            else if (a <= 15) brackets[2]++;
            else if (a <= 20) brackets[3]++;
            else brackets[4]++;
        }

        chartRef.current = new Chart(canvasRef.current as unknown as ChartItem, {
            type: "bar",
            data: {
                labels: ["0–5 ปี", "6–10 ปี", "11–15 ปี", "16–20 ปี", "20+ ปี"],
                datasets: [{
                    data: brackets,
                    backgroundColor: [
                        "rgba(16,185,129,0.8)",
                        "rgba(5,150,105,0.8)",
                        "rgba(4,120,87,0.8)",
                        "rgba(217,119,6,0.8)",
                        "rgba(180,83,9,0.8)",
                    ],
                    borderRadius: 5,
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { font: { size: 11 } }, grid: { display: false } },
                    y: { ticks: { font: { size: 10 } }, grid: { color: "rgba(0,0,0,0.05)" } },
                },
            },
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [bfastMap]);

    // ── GEE+BFAST calculation ──
    const runBfast = useCallback(async (ids: Set<number>) => {
        const targets = parcels.filter((p) => ids.has(p.id));
        if (targets.length === 0 || bfastRunning) return;

        setBfastRunning(true);
        setBfastProgress({ done: 0, total: targets.length });

        // Mark all loading
        setBfastMap((prev) => {
            const next = { ...prev };
            for (const p of targets) next[p.id] = { state: "loading", method: "bfast" };
            return next;
        });

        // Chunk into groups of 10 to avoid huge requests
        const CHUNK = 10;
        let done = 0;
        for (let i = 0; i < targets.length; i += CHUNK) {
            const chunk = targets.slice(i, i + CHUNK);
            const features = chunk.map((p) => ({
                plot_id: String(p.farm_idc ?? p.id),
                geometry: p.geometry,
            }));

            try {
                const res = await fetch("/api/rubber-age/bfast", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                        features,
                        startDate: "2017-01-01",
                        endDate: new Date().toISOString().slice(0, 10),
                        currentYear: CURRENT_YEAR,
                        maxPlots: features.length,
                    }),
                });
                const data = await res.json() as {
                    rows?: Array<Record<string, unknown>>;
                    error?: string;
                };

                if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

                const byPlot = new Map<string, Record<string, unknown>>();
                for (const row of data.rows ?? []) {
                    byPlot.set(String(row.plot_id ?? ""), row);
                }

                setBfastMap((prev) => {
                    const next = { ...prev };
                    for (const p of chunk) {
                        const pid = String(p.farm_idc ?? p.id);
                        const row = byPlot.get(pid);
                        if (!row) {
                            next[p.id] = { state: "error" };
                        } else {
                            next[p.id] = {
                                state: "done",
                                method: "bfast",
                                plantingYear: row.planting_year == null ? null : Number(row.planting_year),
                                age: row.age == null ? null : Number(row.age),
                                confidence: Number(row.confidence ?? 0),
                            };
                        }
                    }
                    return next;
                });
            } catch {
                setBfastMap((prev) => {
                    const next = { ...prev };
                    for (const p of chunk) next[p.id] = { state: "error" };
                    return next;
                });
            }

            done += chunk.length;
            setBfastProgress({ done, total: targets.length });
        }

        setBfastRunning(false);
    }, [parcels, bfastRunning]);

    // ── Raster sampling calculation (raster-first → reduce per parcel) ──
    const runRasterSample = useCallback(async (ids: Set<number>) => {
        const targets = parcels.filter((p) => ids.has(p.id));
        if (targets.length === 0 || bfastRunning) return;

        setBfastRunning(true);
        setBfastProgress({ done: 0, total: targets.length });

        setBfastMap((prev) => {
            const next = { ...prev };
            for (const p of targets) next[p.id] = { state: "loading", method: "raster" };
            return next;
        });

        const CHUNK = 20;
        let done = 0;
        for (let i = 0; i < targets.length; i += CHUNK) {
            const chunk = targets.slice(i, i + CHUNK);

            await Promise.all(chunk.map(async (p) => {
                try {
                    const res = await fetch("/api/rubber-age/from-raster", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({
                            geometry: p.geometry,
                            rasterFilename,
                        }),
                    });
                    const data = await res.json() as {
                        planting_year?: number | null;
                        rubber_age?: number | null;
                        confidence?: number | null;
                        reason?: string | null;
                        error?: string;
                    };
                    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

                    setBfastMap((prev) => ({
                        ...prev,
                        [p.id]: {
                            state: "done",
                            method: "raster",
                            plantingYear: data.planting_year == null ? null : Number(data.planting_year),
                            age: data.rubber_age == null ? null : Number(data.rubber_age),
                            confidence: data.confidence == null ? 0 : Math.max(0, Math.min(1, Number(data.confidence) / 100)),
                            reason: data.reason ?? null,
                        },
                    }));
                } catch {
                    setBfastMap((prev) => ({ ...prev, [p.id]: { state: "error", method: "raster" } }));
                }
            }));

            done += chunk.length;
            setBfastProgress({ done, total: targets.length });
        }

        setBfastRunning(false);
    }, [parcels, bfastRunning, rasterFilename]);

    const generateRasterInGee = useCallback(async () => {
        if (rasterGenerating || bfastRunning || updating) return;
        setRasterGenerating(true);
        setRasterMsg(null);
        setRasterReady(false);
        try {
            // Build bbox region from selected parcels (or all loaded if none selected)
            const targets = parcels.filter((p) => selected.has(p.id));
            const use = targets.length > 0 ? targets : parcels;
            let bbox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
            for (const p of use) {
                const b = bboxFromGeometry(p.geometry);
                if (!b) continue;
                if (!bbox) bbox = { ...b };
                else {
                    bbox.minX = Math.min(bbox.minX, b.minX);
                    bbox.minY = Math.min(bbox.minY, b.minY);
                    bbox.maxX = Math.max(bbox.maxX, b.maxX);
                    bbox.maxY = Math.max(bbox.maxY, b.maxY);
                }
            }
            if (!bbox) throw new Error("ไม่พบ geometry สำหรับสร้าง Raster");

            // Add small padding to bbox (degrees) to avoid edge clipping.
            const pad = 0.02;
            bbox = { minX: bbox.minX - pad, minY: bbox.minY - pad, maxX: bbox.maxX + pad, maxY: bbox.maxY + pad };
            const regionGeojson = bboxPolygon(bbox);

            const res = await fetch("/api/rubber-age/bfast-raster/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    // defaults: endYear/currentYear = now
                    regionGeojson,
                    filename: "rubber_age_selected_area",
                    exportMode: "download",
                    scale: 250,
                }),
            });
            const data = await res.json() as { saved_filename?: string; saved_path?: string; error?: string };
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            setRasterMsg({
                ok: true,
                text: `สร้าง Raster สำเร็จ: ${data.saved_filename ?? "rubber_age_selected_area.tif"}`,
            });
            setRasterFilename(data.saved_filename ?? "rubber_age_selected_area.tif");
            setRasterReady(true);
        } catch (err) {
            setRasterMsg({
                ok: false,
                text: err instanceof Error ? err.message : "สร้าง Raster ไม่สำเร็จ",
            });
        } finally {
            setRasterGenerating(false);
        }
    }, [rasterGenerating, bfastRunning, updating, parcels, selected]);

    // ── DB update ──
    const saveToDb = useCallback(async () => {
        const updates = parcels
            .filter((p) => {
                const r = bfastMap[p.id];
                return selected.has(p.id) && r?.state === "done" && r.age != null;
            })
            .map((p) => {
                const r = bfastMap[p.id]!;
                return {
                    id: p.id,
                    rubber_age: r.age as number,
                    grow_year: r.plantingYear != null ? r.plantingYear : undefined,
                };
            });

        if (updates.length === 0) return;
        setUpdating(true);
        setUpdateMsg(null);

        try {
            const res = await fetch("/api/admin/rubber-age", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ updates }),
            });
            const data = await res.json() as { updated?: number; error?: string };
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            // Update local parcels array with new values
            setParcels((prev) =>
                prev.map((p) => {
                    const u = updates.find((x) => x.id === p.id);
                    if (!u) return p;
                    return {
                        ...p,
                        grow_year: u.grow_year ?? p.grow_year,
                    };
                }),
            );
            setUpdateMsg({ text: `อัปเดตสำเร็จ ${data.updated} แปลง`, ok: true });
        } catch (err) {
            setUpdateMsg({ text: err instanceof Error ? err.message : "เกิดข้อผิดพลาด", ok: false });
        } finally {
            setUpdating(false);
        }
    }, [parcels, bfastMap, selected]);

    // ── Selection helpers ──
    const toggleOne = (id: number) =>
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const toggleAll = () =>
        setSelected((prev) =>
            prev.size === parcels.length ? new Set() : new Set(parcels.map((p) => p.id)),
        );

    // ── Guard render ──
    if (!ready || !user) {
        return (
            <div className="container py-5 text-center">
                <div className="spinner-border text-success" role="status" />
            </div>
        );
    }

    if (user.role !== "admin") return null;

    // ── Helpers for stats ──
    const computedAges = Object.values(bfastMap)
        .filter((r) => r.state === "done" && r.age != null)
        .map((r) => Number(r.age));

    const avgAge = computedAges.length > 0
        ? (computedAges.reduce((sum, age) => sum + age, 0) / computedAges.length).toFixed(1)
        : "—";

    const readyToSaveCount = parcels.filter(
        (p) => selected.has(p.id) && bfastMap[p.id]?.state === "done" && bfastMap[p.id]?.age != null,
    ).length;

    const selectedCount = selected.size;
    const selectedIds = new Set(Array.from(selected));
    const selectedDone = parcels.filter((p) => selectedIds.has(p.id) && bfastMap[p.id]?.state === "done").length;
    const selectedError = parcels.filter((p) => selectedIds.has(p.id) && bfastMap[p.id]?.state === "error").length;
    const selectedPending = Math.max(selectedCount - selectedDone - selectedError, 0);

    // ─── JSX ────────────────────────────────────────────────────────────────
    return (
        <div className="container py-5" style={{ marginTop: "60px" }}>

            {/* Header */}
            <Card className="border-0 shadow-sm mb-4 overflow-hidden">
                <div
                    className="p-4 p-md-5"
                    style={{
                        background:
                            "radial-gradient(1200px 500px at -10% -10%, rgba(16,185,129,0.20) 0%, rgba(16,185,129,0) 60%)," +
                            "radial-gradient(900px 450px at 110% 0%, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0) 58%)," +
                            "radial-gradient(700px 360px at 30% 120%, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0) 55%)," +
                            "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.86) 100%)",
                        borderBottom: "1px solid rgba(0,0,0,0.06)",
                    }}
                >
                    <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
                        <div style={{ maxWidth: 760 }}>
                            <Eyebrow icon="bi-shield-check" className="mb-2">
                                แผงควบคุมผู้ดูแลระบบ
                            </Eyebrow>
                            <h1 className="fw-bold mb-2" style={{ letterSpacing: "-0.02em" }}>
                                คำนวณอายุต้นยาง
                            </h1>
                            <div className="text-muted">
                                โหมดแนะนำ: <span className="fw-semibold">Raster</span> → สร้างอายุใน GEE ครั้งเดียว → ลดผลลงแต่ละแปลง → บันทึกลงฐานข้อมูล
                            </div>
                        </div>

                        <div className="d-flex flex-column gap-2 align-items-start align-items-md-end">
                            <div className="small text-muted">ปีปัจจุบัน</div>
                            <div className="d-flex align-items-center gap-2">
                                <span className="badge rounded-pill text-bg-dark">{CURRENT_YEAR}</span>
                                <span className="badge rounded-pill text-bg-light border">เลือกสูงสุด 200 แปลง/รอบ (แนะนำ)</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-3 d-flex flex-wrap gap-2">
                        <span className="badge rounded-pill text-bg-light border">
                            <span className="fw-semibold">1)</span> โหลด/กรองแปลง
                        </span>
                        <span className="badge rounded-pill text-bg-light border">
                            <span className="fw-semibold">2)</span> สร้าง Raster ใน GEE (ปีล่าสุด)
                        </span>
                        <span className="badge rounded-pill text-bg-light border">
                            <span className="fw-semibold">3)</span> ลดผลลงแปลงที่เลือก
                        </span>
                        <span className="badge rounded-pill text-bg-light border">
                            <span className="fw-semibold">4)</span> บันทึกลงฐานข้อมูล
                        </span>
                    </div>
                </div>
            </Card>

            {/* Filters (collapsible) */}
            <Card className="border-0 shadow-sm mb-4">
                <details open className="p-3 p-md-4">
                    <summary
                        className="d-flex align-items-center justify-content-between"
                        style={{ cursor: "pointer", listStyle: "none" }}
                    >
                        <div className="d-flex align-items-center gap-2">
                            <i className="bi bi-funnel text-success" />
                            <div className="fw-bold">ตัวกรองแปลง</div>
                            <div className="small text-muted d-none d-md-inline">กรองก่อนคำนวณเพื่อลดเวลา</div>
                        </div>
                        <span className="small text-muted">คลิกเพื่อยุบ/ขยาย</span>
                    </summary>

                    <div className="mt-3 row g-2 align-items-end">
                        <div className="col-md-2">
                            <label className="form-label small mb-1">จังหวัด</label>
                            <input
                                className="form-control form-control-sm"
                                placeholder="เช่น จันทบุรี"
                                value={filters.province}
                                onChange={(e) => setFilters((prev) => ({ ...prev, province: e.target.value }))}
                            />
                        </div>
                        <div className="col-md-2">
                            <label className="form-label small mb-1">อำเภอ</label>
                            <input
                                className="form-control form-control-sm"
                                placeholder="เช่น แก่งหางแมว"
                                value={filters.amphur}
                                onChange={(e) => setFilters((prev) => ({ ...prev, amphur: e.target.value }))}
                            />
                        </div>
                        <div className="col-md-2">
                            <label className="form-label small mb-1">ตำบล</label>
                            <input
                                className="form-control form-control-sm"
                                placeholder="เช่น เขาวงกต"
                                value={filters.tambon}
                                onChange={(e) => setFilters((prev) => ({ ...prev, tambon: e.target.value }))}
                            />
                        </div>
                        <div className="col-md-2">
                            <label className="form-label small mb-1">ปีปลูก (จาก–ถึง)</label>
                            <div className="d-flex gap-2">
                                <input
                                    className="form-control form-control-sm"
                                    placeholder="2550"
                                    value={filters.growYearMin}
                                    onChange={(e) => setFilters((prev) => ({ ...prev, growYearMin: e.target.value }))}
                                />
                                <input
                                    className="form-control form-control-sm"
                                    placeholder="2568"
                                    value={filters.growYearMax}
                                    onChange={(e) => setFilters((prev) => ({ ...prev, growYearMax: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="col-md-2">
                            <label className="form-label small mb-1">จำนวนที่โหลด</label>
                            <input
                                className="form-control form-control-sm"
                                type="number"
                                min={1}
                                max={2000}
                                value={filters.limit}
                                onChange={(e) => setFilters((prev) => ({ ...prev, limit: e.target.value }))}
                            />
                        </div>
                        <div className="col-md-2 d-flex gap-2">
                            <button
                                className="btn btn-success btn-sm rounded-pill px-3 flex-grow-1"
                                onClick={() => fetchParcels()}
                                disabled={fetchingParcels || bfastRunning || updating}
                                title="โหลดรายการแปลงตามตัวกรอง"
                            >
                                {fetchingParcels
                                    ? <span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} />
                                    : <><i className="bi bi-search me-1" />โหลดแปลง</>}
                            </button>
                            <button
                                className="btn btn-outline-secondary btn-sm rounded-pill px-3"
                                disabled={fetchingParcels || bfastRunning || updating}
                                onClick={() => {
                                    setFilters(DEFAULT_FILTERS);
                                    fetchParcels(DEFAULT_FILTERS);
                                }}
                                title="ล้างตัวกรองและโหลดใหม่"
                            >
                                <i className="bi bi-x-circle" />
                            </button>
                        </div>
                    </div>
                </details>
            </Card>

            {/* ── Messages ── */}
            {parcelErr && (
                <Alert type="error" className="mb-3">
                    <div className="d-flex align-items-start justify-content-between gap-3 w-100">
                        <div>{parcelErr}</div>
                        <button className="btn btn-sm btn-light border" onClick={() => setParcelErr(null)}>
                            ปิด
                        </button>
                    </div>
                </Alert>
            )}
            {updateMsg && (
                <Alert type={updateMsg.ok ? "success" : "error"} className="mb-3">
                    <div className="d-flex align-items-start justify-content-between gap-3 w-100">
                        <div>{updateMsg.text}</div>
                        <button className="btn btn-sm btn-light border" onClick={() => setUpdateMsg(null)}>
                            ปิด
                        </button>
                    </div>
                </Alert>
            )}

            {/* ── Results ── */}
            {total !== null && (
                <>
                    {/* Stats row */}
                    <div className="row g-3 mb-4">
                        <div className="col-sm-3">
                            <Card className="border-0 shadow-sm h-100">
                                <div className="p-3 text-center">
                                    <div className="fs-3 fw-bold text-success">{total.toLocaleString()}</div>
                                    <div className="small text-muted">แปลงทั้งหมดในฐานข้อมูล</div>
                                </div>
                            </Card>
                        </div>
                        <div className="col-sm-3">
                            <Card className="border-0 shadow-sm h-100">
                                <div className="p-3 text-center">
                                    <div className="fs-3 fw-bold text-primary">{parcels.length.toLocaleString()}</div>
                                    <div className="small text-muted">แปลงที่โหลดมา</div>
                                </div>
                            </Card>
                        </div>
                        <div className="col-sm-3">
                            <Card className="border-0 shadow-sm h-100">
                                <div className="p-3 text-center">
                                    <div className="fs-3 fw-bold text-warning">{avgAge}</div>
                                    <div className="small text-muted">อายุเฉลี่ย (ปี, GEE+BFAST)</div>
                                </div>
                            </Card>
                        </div>
                        <div className="col-sm-3">
                            <Card className="border-0 shadow-sm h-100">
                                <div className="p-3 text-center">
                                    <div className="fs-3 fw-bold text-danger">{bfastDoneCount.toLocaleString()}</div>
                                    <div className="small text-muted">แปลงที่คำนวณแล้ว (GEE+BFAST)</div>
                                </div>
                            </Card>
                        </div>
                    </div>

                    {/* Chart */}
                    {parcels.length > 0 && (
                        <Card className="border-0 shadow-sm mb-4">
                            <div className="p-4">
                                <h6 className="fw-bold mb-3">
                                    <i className="bi bi-bar-chart-line me-2 text-success"></i>การกระจายอายุต้นยาง (GEE+BFAST)
                                </h6>
                                <canvas ref={canvasRef} height={80} />
                            </div>
                        </Card>
                    )}

                    {/* Guided steps */}
                    {total !== null && (
                        <div className="mb-3">
                            <Card className="border-0 shadow-sm">
                                <div className="p-3 p-md-4">
                                    <div className="row g-3">
                                        {/* Step 1 */}
                                        <div className="col-12 col-lg-3">
                                            <div className="p-3 rounded-4 border h-100" style={{ background: "rgba(255,255,255,0.75)" }}>
                                                <div className="d-flex align-items-center justify-content-between mb-2">
                                                    <div className="d-flex align-items-center gap-2">
                                                        <span className="badge rounded-pill text-bg-dark">Step 1</span>
                                                        <span className="fw-semibold">เลือกแปลง</span>
                                                    </div>
                                                    <span className="small text-muted">{selectedCount.toLocaleString()} เลือก</span>
                                                </div>

                                                <div className="d-grid gap-2">
                                                    <button
                                                        className="btn btn-outline-secondary btn-sm rounded-pill"
                                                        onClick={toggleAll}
                                                        disabled={parcels.length === 0}
                                                    >
                                                        <i className="bi bi-check2-square me-1" />
                                                        {selected.size === parcels.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
                                                    </button>
                                                    <button
                                                        className="btn btn-light btn-sm rounded-pill border"
                                                        onClick={() => fetchParcels()}
                                                        disabled={fetchingParcels || bfastRunning || updating}
                                                    >
                                                        {fetchingParcels
                                                            ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />กำลังโหลด…</>
                                                            : <><i className="bi bi-arrow-clockwise me-1" />โหลดใหม่ตามตัวกรอง</>}
                                                    </button>
                                                </div>

                                                <div className="small text-muted mt-2">
                                                    แนะนำ: กรองให้เหลือ ~200 แปลงก่อนคำนวณ
                                                </div>
                                            </div>
                                        </div>

                                        {/* Step 2 */}
                                        <div className="col-12 col-lg-3">
                                            <div className="p-3 rounded-4 border h-100" style={{ background: "rgba(240,253,244,0.55)" }}>
                                                <div className="d-flex align-items-center justify-content-between mb-2">
                                                    <div className="d-flex align-items-center gap-2">
                                                        <span className="badge rounded-pill text-bg-dark">Step 2</span>
                                                        <span className="fw-semibold">สร้าง Raster ใน GEE</span>
                                                    </div>
                                                    <span className={`badge rounded-pill ${rasterReady ? "text-bg-success" : "text-bg-light border"}`}>
                                                        {rasterReady ? "พร้อมใช้" : "ยังไม่พร้อม"}
                                                    </span>
                                                </div>

                                                <div className="d-grid gap-2">
                                                    <button
                                                        className="btn btn-success btn-sm rounded-pill"
                                                        disabled={rasterGenerating || bfastRunning || updating}
                                                        onClick={generateRasterInGee}
                                                    >
                                                        {rasterGenerating
                                                            ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />กำลังสร้าง…</>
                                                            : <><i className="bi bi-globe2 me-1" />สร้าง Raster (ปีล่าสุด)</>}
                                                    </button>

                                                    <details className="small">
                                                        <summary className="text-muted" style={{ cursor: "pointer" }}>
                                                            ขั้นสูง (BFAST)
                                                        </summary>
                                                        <div className="mt-2 d-flex gap-2">
                                                            <button
                                                                className={`btn btn-sm rounded-pill ${calcMethod === "raster" ? "btn-outline-success" : "btn-outline-secondary"}`}
                                                                onClick={() => setCalcMethod("raster")}
                                                                disabled={bfastRunning || updating}
                                                            >
                                                                Raster
                                                            </button>
                                                            <button
                                                                className={`btn btn-sm rounded-pill ${calcMethod === "bfast" ? "btn-outline-success" : "btn-outline-secondary"}`}
                                                                onClick={() => setCalcMethod("bfast")}
                                                                disabled={bfastRunning || updating}
                                                            >
                                                                BFAST
                                                            </button>
                                                        </div>
                                                        <div className="text-muted mt-2">
                                                            BFAST จะคำนวณจาก GEE รายแปลง (ช้ากว่า)
                                                        </div>
                                                    </details>
                                                </div>

                                                {rasterMsg && (
                                                    <div className="small mt-2 text-muted">{rasterMsg.text}</div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Step 3 */}
                                        <div className="col-12 col-lg-3">
                                            <div className="p-3 rounded-4 border h-100" style={{ background: "rgba(239,246,255,0.55)" }}>
                                                <div className="d-flex align-items-center justify-content-between mb-2">
                                                    <div className="d-flex align-items-center gap-2">
                                                        <span className="badge rounded-pill text-bg-dark">Step 3</span>
                                                        <span className="fw-semibold">คำนวณลงแปลงที่เลือก</span>
                                                    </div>
                                                    <span className="small text-muted">{selectedDone}/{selectedCount}</span>
                                                </div>

                                                <div className="d-grid gap-2">
                                                    <button
                                                        className="btn btn-primary btn-sm rounded-pill"
                                                        disabled={
                                                            selected.size === 0 ||
                                                            bfastRunning ||
                                                            parcels.length === 0 ||
                                                            (calcMethod === "raster" && !rasterReady && rasterGenerating)
                                                        }
                                                        onClick={async () => {
                                                            if (calcMethod === "raster" && !rasterReady) {
                                                                await generateRasterInGee();
                                                            }
                                                            if (calcMethod === "raster") {
                                                                await runRasterSample(selected);
                                                            } else {
                                                                await runBfast(selected);
                                                            }
                                                        }}
                                                    >
                                                        {bfastRunning
                                                            ? <>
                                                                <span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />
                                                                กำลังทำงาน… ({bfastProgress.done}/{bfastProgress.total})
                                                            </>
                                                            : <>
                                                                <i className="bi bi-cpu me-1" />
                                                                {selected.size === 0 ? "เลือกแปลงก่อน" : "คำนวณอายุให้แปลงที่เลือก"}
                                                            </>}
                                                    </button>
                                                    <div className="d-flex flex-wrap gap-2">
                                                        <span className="badge rounded-pill text-bg-success">สำเร็จ {selectedDone}</span>
                                                        <span className="badge rounded-pill text-bg-danger">ผิดพลาด {selectedError}</span>
                                                        <span className="badge rounded-pill text-bg-secondary">รอ {selectedPending}</span>
                                                    </div>
                                                </div>

                                                {bfastRunning && bfastProgress.total > 0 && (
                                                    <div className="progress mt-2" role="progressbar" aria-valuenow={Math.round((bfastProgress.done / bfastProgress.total) * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 8 }}>
                                                        <div
                                                            className="progress-bar progress-bar-striped progress-bar-animated bg-success"
                                                            style={{ width: `${Math.round((bfastProgress.done / bfastProgress.total) * 100)}%` }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Step 4 */}
                                        <div className="col-12 col-lg-3">
                                            <div className="p-3 rounded-4 border h-100" style={{ background: "rgba(255,247,237,0.55)" }}>
                                                <div className="d-flex align-items-center justify-content-between mb-2">
                                                    <div className="d-flex align-items-center gap-2">
                                                        <span className="badge rounded-pill text-bg-dark">Step 4</span>
                                                        <span className="fw-semibold">บันทึกลงฐานข้อมูล</span>
                                                    </div>
                                                    <span className="badge rounded-pill text-bg-light border">{readyToSaveCount} พร้อมบันทึก</span>
                                                </div>

                                                <div className="d-grid gap-2">
                                                    <button
                                                        className="btn btn-dark btn-sm rounded-pill"
                                                        disabled={readyToSaveCount === 0 || updating || parcels.length === 0}
                                                        onClick={saveToDb}
                                                    >
                                                        {updating
                                                            ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />กำลังบันทึก…</>
                                                            : <><i className="bi bi-cloud-upload me-1" />บันทึกผล ({readyToSaveCount} แปลง)</>}
                                                    </button>
                                                    <div className="small text-muted">
                                                        แสดง {parcels.length.toLocaleString()} / {total.toLocaleString()} รายการ
                                                        {total > parcels.length && " · ตอนนี้โหลดชุดแรก"}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    )}

                    {/* Table */}
                    {parcels.length > 0 && (
                        <Card className="border-0 shadow-sm overflow-hidden">
                            <div className="table-responsive">
                                <table className="table table-hover align-middle mb-0" style={{ fontSize: 13 }}>
                                    <thead className="table-light">
                                        <tr>
                                            <th className="px-3 py-2" style={{ width: 36 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected.size === parcels.length && parcels.length > 0}
                                                    onChange={toggleAll}
                                                />
                                            </th>
                                            <th className="py-2">ชื่อ / เลขทะเบียน</th>
                                            <th className="py-2">พื้นที่</th>
                                            <th className="py-2">จังหวัด / อำเภอ</th>
                                            <th className="py-2 text-center">สถานะ</th>
                                            <th className="py-2 text-center">ปีปลูก (DB)</th>
                                            <th className="py-2 text-center">ปีปลูก (GEE)</th>
                                            <th className="py-2 text-center">อายุ (GEE) ปี</th>
                                            <th className="py-2 text-center">ความเชื่อมั่น</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parcels.map((p) => {
                                            const bfast = bfastMap[p.id];
                                            const isSelected = selected.has(p.id);

                                            return (
                                                <tr
                                                    key={p.id}
                                                    className={isSelected ? "table-success" : ""}
                                                    style={{ cursor: "default" }}
                                                >
                                                    <td className="px-3" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleOne(p.id)}
                                                        />
                                                    </td>

                                                    {/* Name / ID */}
                                                    <td>
                                                        <div className="fw-medium text-truncate" style={{ maxWidth: 180 }}>
                                                            {fmt(p.farm_name)}
                                                        </div>
                                                        <div className="text-muted" style={{ fontSize: 11 }}>
                                                            {fmt(p.farm_idc)} · แปลงที่ {fmt(p.land_seq)}
                                                        </div>
                                                    </td>

                                                    {/* Area */}
                                                    <td className="text-muted">{fmt(p.grow_area)}</td>

                                                    {/* Province / Amphur */}
                                                    <td>
                                                        <div>{fmt(p.province)}</div>
                                                        <div className="text-muted" style={{ fontSize: 11 }}>{fmt(p.amphur)}</div>
                                                    </td>

                                                    {/* Row status */}
                                                    <td className="text-center">
                                                        {bfast?.state === "loading" && (
                                                            <span className="badge rounded-pill text-bg-warning text-dark">กำลังคำนวณ</span>
                                                        )}
                                                        {bfast?.state === "done" && (
                                                            bfast.age == null
                                                                ? <span className="badge rounded-pill text-bg-warning text-dark" title={bfast.reason ?? undefined}>ไม่มีข้อมูล</span>
                                                                : <span className="badge rounded-pill text-bg-success">สำเร็จ</span>
                                                        )}
                                                        {bfast?.state === "error" && (
                                                            <span className="badge rounded-pill text-bg-danger">ผิดพลาด</span>
                                                        )}
                                                        {(!bfast || bfast.state === "idle") && (
                                                            <span className="badge rounded-pill text-bg-light border">รอคำนวณ</span>
                                                        )}
                                                    </td>

                                                    {/* DB grow year */}
                                                    <td className="text-center">
                                                        {formatThaiYear(p.grow_year)}
                                                    </td>

                                                    {/* GEE planting year */}
                                                    <td className="text-center">
                                                        {bfast?.state === "loading" && (
                                                            <span className="spinner-border spinner-border-sm text-success" style={{ width: 12, height: 12 }} />
                                                        )}
                                                        {bfast?.state === "error" && <span className="text-danger">✗</span>}
                                                        {bfast?.state === "done" && bfast.plantingYear != null
                                                            ? formatThaiYear(bfast.plantingYear)
                                                            : bfast?.state === "done" ? "—" : ""}
                                                    </td>

                                                    {/* GEE age */}
                                                    <td className="text-center fw-bold">
                                                        {bfast?.state === "loading" && (
                                                            <span className="spinner-border spinner-border-sm text-success" style={{ width: 12, height: 12 }} />
                                                        )}
                                                        {bfast?.state === "error" && <span className="text-danger small">ผิดพลาด</span>}
                                                        {bfast?.state === "done" && bfast.age != null ? bfast.age : "—"}
                                                    </td>

                                                    {/* Confidence */}
                                                    <td className="text-center">
                                                        {bfast?.state === "done" && bfast.confidence != null && (
                                                            <span
                                                                className={`badge rounded-pill ${bfast.confidence >= 0.7
                                                                    ? "bg-success"
                                                                    : bfast.confidence >= 0.4
                                                                        ? "bg-warning text-dark"
                                                                        : "bg-danger"
                                                                    }`}
                                                                style={{ fontSize: 10 }}
                                                            >
                                                                {(bfast.confidence * 100).toFixed(0)}%
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {total > parcels.length && (
                                <div className="px-4 py-2 bg-light border-top text-muted small text-center">
                                    แสดง {parcels.length.toLocaleString()} แถวแรก จาก {total.toLocaleString()} รายการ · ปรับตัวกรองเพื่อโหลดแปลงอื่น
                                </div>
                            )}
                        </Card>
                    )}

                    {parcels.length === 0 && !fetchingParcels && (
                        <div className="text-center py-5 text-muted">
                            <i className="bi bi-inbox fs-2 d-block mb-2"></i>
                            ไม่พบแปลงที่ตรงกับเงื่อนไข
                        </div>
                    )}
                </>
            )}

            {total === null && !fetchingParcels && (
                <div className="text-center py-5 text-muted">
                    <i className="bi bi-inbox fs-2 d-block mb-2 opacity-40"></i>
                    ไม่มีข้อมูลแปลงให้แสดง
                </div>
            )}
        </div>
    );
}
