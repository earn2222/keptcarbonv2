"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { carbonForAge } from "@/lib/map-utils";
import { useAuth } from "@/lib/auth-context";


// ── Types ─────────────────────────────────────────────────────────────────
type Props = {
    searchRunning: boolean;
    searchErr: string | null;
    searchCount: number | null;
    searchTruncated: boolean;
    parcelFeatures: GeoJSON.Feature[];
    userDisplayName?: string;
    drawnGeometry?: GeoJSON.Geometry | null;
    onFlyTo: (feature: GeoJSON.Feature) => void;
    onReset?: () => void;
    onBack?: () => void;
    onCancel?: () => void;
    currentStep: 1 | 2 | 3;
    onStepChange: (step: 1 | 2 | 3) => void;
};

type PlotTab = "analyze" | "forecast";
type ForecastYr = 3 | 5 | 7;

interface PlotInfo {
    age: number;
    plantYearBE: number;
    areaRai: number;
    trees: number;
    co2: number;
    confidence: number;
    province: string;
}

// ── Constants ─────────────────────────────────────────────────────────────
const CURRENT_CE = new Date().getFullYear();
const CURRENT_BE = CURRENT_CE + 543;

const THAI_PROVINCES = [
    "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร", "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา",
    "ชลบุรี", "ชัยนาท", "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง", "ตราด", "ตาก",
    "นครนายก", "นครปฐม", "นครพนม", "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี",
    "นราธิวาส", "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์", "ปราจีนบุรี",
    "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา", "พังงา", "พัทลุง", "พิจิตร", "พิษณุโลก",
    "เพชรบุรี", "เพชรบูรณ์", "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน",
    "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง", "ราชบุรี", "ลพบุรี", "ลำปาง", "ลำพูน",
    "เลย", "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ", "สมุทรสงคราม",
    "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี", "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี",
    "สุรินทร์", "หนองคาย", "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์",
    "อุทัยธานี", "อุบลราชธานี",
];

// ── Helpers ───────────────────────────────────────────────────────────────
function parseRai(v: unknown): number {
    if (!v) return 0;
    const s = String(v).trim();
    const m = s.match(/^(\d+)-(\d+)-(\d+)/);
    if (m) return +m[1] + +m[2] * 0.25 + +m[3] / 400;
    return parseFloat(s) || 0;
}

function computePlot(feat: GeoJSON.Feature): PlotInfo {
    const p = (feat.properties ?? {}) as Record<string, unknown>;
    const age = Number(
        p.rubber_age ?? p.gee_age ??
        (p.grow_year ? CURRENT_BE - Number(p.grow_year) : 0)
    );
    const rawPlantYear = p.gee_plant_year
        ? Number(p.gee_plant_year) + 543
        : Number(p.grow_year ?? 0);
    const areaRai = parseRai(p.grow_area);
    const trees = Math.max(Math.round(areaRai * 80), 0);
    const co2 = age > 0 && trees > 0 ? carbonForAge(age, trees).co2 : 0;
    return {
        age,
        plantYearBE: rawPlantYear,
        areaRai,
        trees,
        co2,
        confidence: Number(p.gee_confidence ?? 0.65),
        province: String(p.province ?? ""),
    };
}

function ageDistribution(age: number, conf: number) {
    const c = Math.min(Math.max(conf || 0.65, 0.1), 0.9);
    const rest = 1 - c;
    const raw = [rest * 0.18, rest * 0.32, c, rest * 0.35, rest * 0.15];
    const total = raw.reduce((a, b) => a + b, 0);
    return [age - 2, age - 1, age, age + 1, age + 2]
        .map((a, i) => ({ a, pct: Math.round((raw[i] / total) * 1000) / 10 }))
        .filter(({ a }) => a > 0);
}

function forecastPts(age: number, trees: number, years: ForecastYr) {
    return Array.from({ length: years + 1 }, (_, i) => ({
        yearBE: CURRENT_BE + i,
        co2: trees > 0 ? carbonForAge(age + i, trees).co2 : 0,
    }));
}

function summaryForecast(plots: PlotInfo[], years: ForecastYr) {
    return Array.from({ length: years + 1 }, (_, i) => ({
        yearBE: CURRENT_BE + i,
        co2: plots.reduce((s, pl) => s + (pl.trees > 0 ? carbonForAge(pl.age + i, pl.trees).co2 : 0), 0),
    }));
}

// ── SVG: Age distribution bar chart with hover tooltip ────────────────────
function AgeBarChart({ age, conf, trees }: { age: number; conf: number; trees: number }) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const dist = ageDistribution(age, conf);
    const maxPct = Math.max(...dist.map(d => d.pct));

    const W = 500, BAR_W = 60, GAP = 18;
    const totalW = dist.length * BAR_W + (dist.length - 1) * GAP;
    const sx = (W - totalW) / 2;
    const BASE_Y = 160, MAX_BH = 110, H = 220;

    return (
        <div style={{ background: "linear-gradient(135deg,#f0fdf4,#ecfdf5)", borderRadius: 14, padding: "12px 8px 8px", marginBottom: 12 }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block", overflow: "visible" }}>
                <defs>
                    <linearGradient id="barGradMain" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#047857" />
                    </linearGradient>
                    <filter id="barShadow">
                        <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#059669" floodOpacity="0.3" />
                    </filter>
                </defs>

                {/* background grid */}
                {[0.25, 0.5, 0.75, 1].map(t => (
                    <line key={t}
                        x1={sx} y1={BASE_Y - t * MAX_BH} x2={sx + totalW} y2={BASE_Y - t * MAX_BH}
                        stroke="rgba(16,185,129,0.1)" strokeWidth={t === 1 ? 1.2 : 0.6}
                        strokeDasharray={t < 1 ? "4,4" : undefined} />
                ))}

                {dist.map(({ a, pct }, i) => {
                    const bh = Math.max((pct / maxPct) * MAX_BH, 5);
                    const x = sx + i * (BAR_W + GAP);
                    const cx = x + BAR_W / 2;
                    const isMain = a === age;
                    const isHov = hoverIdx === i;
                    const co2Val = trees > 0 ? carbonForAge(a, trees).co2 : 0;

                    const ttW = 102, ttH = 46;
                    const ttLeft = Math.min(Math.max(cx - ttW / 2, 2), W - ttW - 2);
                    const ttTop = BASE_Y - bh - ttH - 16;

                    return (
                        <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: "pointer" }}>
                            {/* hover glow bg */}
                            {(isMain || isHov) && (
                                <rect x={x - 4} y={BASE_Y - bh - 4} width={BAR_W + 8} height={bh + 4}
                                    rx={10} fill={isHov ? "rgba(16,185,129,0.12)" : "rgba(45,158,95,0.07)"} />
                            )}
                            {/* bar */}
                            <rect x={x} y={BASE_Y - bh} width={BAR_W} height={bh} rx={8}
                                fill={isMain ? "url(#barGradMain)" : isHov ? "rgba(16,185,129,0.45)" : "rgba(16,185,129,0.18)"}
                                filter={isMain ? "url(#barShadow)" : undefined}
                                style={{ transition: "fill 0.15s" }} />
                            {/* % label above bar */}
                            <text x={cx} y={BASE_Y - bh - 10} textAnchor="middle"
                                fontSize={isMain ? 15 : isHov ? 14 : 13}
                                fontWeight={isMain ? "900" : isHov ? "700" : "500"}
                                fill={isMain ? "#065f46" : isHov ? "#059669" : "#94a3b8"}>
                                {pct}%
                            </text>
                            {/* age label below */}
                            <text x={cx} y={BASE_Y + 22} textAnchor="middle" fontSize={13}
                                fontWeight={isMain ? "800" : "500"}
                                fill={isMain ? "#059669" : isHov ? "#10b981" : "#94a3b8"}>
                                {a}.0
                            </text>
                            {/* age unit */}
                            <text x={cx} y={BASE_Y + 36} textAnchor="middle" fontSize={10} fill="#cbd5e1" fontWeight="400">ปี</text>

                            {/* tooltip */}
                            {isHov && (
                                <g pointerEvents="none">
                                    <rect x={ttLeft} y={ttTop} width={ttW} height={ttH + 10} rx={9} fill="#064e3b" opacity={0.95} />
                                    <text x={ttLeft + ttW / 2} y={ttTop + 18} textAnchor="middle" fontSize={12} fill="#6ee7b7" fontWeight="600">
                                        อายุ {a} ปี · {pct}%
                                    </text>
                                    <text x={ttLeft + ttW / 2} y={ttTop + 38} textAnchor="middle" fontSize={15} fill="#fff" fontWeight="800">
                                        {co2Val > 0 ? `${co2Val.toLocaleString("th-TH", { maximumFractionDigits: 0 })} tCO₂` : "—"}
                                    </text>
                                    <polygon points={`${cx - 5},${ttTop + ttH} ${cx + 5},${ttTop + ttH} ${cx},${ttTop + ttH + 6}`} fill="#064e3b" opacity={0.95} />
                                </g>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

// ── SVG: Carbon forecast line chart with hover ────────────────────────────
function ForecastChart({ pts }: { pts: Array<{ yearBE: number; co2: number }> }) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const W = 500, H = 220, PL = 12, PR = 60, PT = 24, PB = 34;
    const iW = W - PL - PR, iH = H - PT - PB;
    const vals = pts.map(p => p.co2);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const rng = maxV - minV || 1;

    const svgPts = pts.map((d, i) => ({
        x: PL + (i / Math.max(pts.length - 1, 1)) * iW,
        y: PT + (1 - (d.co2 - minV) / rng) * iH,
        ...d,
    }));
    const line = svgPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const fillPath = `${PL},${PT + iH} ${line} ${(PL + iW).toFixed(1)},${PT + iH}`;
    const hp = hoverIdx !== null ? svgPts[hoverIdx] : null;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block", overflow: "visible" }}>
            <defs>
                <linearGradient id="fcAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                </linearGradient>
                <filter id="ptShadow">
                    <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#059669" floodOpacity="0.4" />
                </filter>
            </defs>

            {/* Grid */}
            {[0, 0.5, 1].map(t => (
                <line key={t} x1={PL} y1={PT + t * iH} x2={PL + iW} y2={PT + t * iH}
                    stroke="rgba(45,158,95,0.1)" strokeWidth={t === 0 || t === 1 ? 1 : 0.5}
                    strokeDasharray={t === 0.5 ? "4,4" : undefined} />
            ))}

            {/* Hover vertical guide */}
            {hp && (
                <line x1={hp.x} y1={PT} x2={hp.x} y2={PT + iH}
                    stroke="rgba(16,185,129,0.35)" strokeWidth={1.5} strokeDasharray="3,3" />
            )}

            {/* Area */}
            <polygon points={fillPath} fill="url(#fcAreaGrad)" />

            {/* Line */}
            <polyline points={line} fill="none" stroke="#059669" strokeWidth={2.2}
                strokeLinejoin="round" strokeLinecap="round" />

            {/* Invisible wide hit targets per segment */}
            {svgPts.map((p, i) => (
                <rect key={i}
                    x={i === 0 ? PL : (svgPts[i - 1].x + p.x) / 2}
                    y={PT}
                    width={i === 0
                        ? (svgPts[1] ? (svgPts[1].x + p.x) / 2 - PL : iW)
                        : i === svgPts.length - 1
                            ? (PL + iW) - (svgPts[i - 1].x + p.x) / 2
                            : (p.x - svgPts[i - 1].x)}
                    height={iH}
                    fill="transparent"
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                    style={{ cursor: "crosshair" }}
                />
            ))}

            {/* Data points */}
            {svgPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hoverIdx === i ? 5.5 : 3.5}
                    fill={hoverIdx === i ? "#10b981" : "#ffffff"}
                    stroke="#059669" strokeWidth={2}
                    filter={hoverIdx === i ? "url(#ptShadow)" : undefined}
                    style={{ transition: "r 0.15s ease" }} />
            ))}

            {/* Year labels */}
            {svgPts.map(p => (
                <text key={p.yearBE} x={p.x} y={H - 8} textAnchor="middle" fontSize={11} fill="#94a3b8">
                    {p.yearBE}
                </text>
            ))}

            {/* Y axis labels */}
            <text x={PL + iW + 8} y={PT + 4} fontSize={10} fill="#6b9e7e" textAnchor="start">
                {Math.round(maxV).toLocaleString()}
            </text>
            <text x={PL + iW + 8} y={PT + iH + 4} fontSize={10} fill="#6b9e7e" textAnchor="start">
                {Math.round(minV).toLocaleString()}
            </text>

            {/* Hover tooltip */}
            {hp && (() => {
                const ttW = 96, ttH = 42;
                const ttX = Math.min(Math.max(hp.x - ttW / 2, PL), PL + iW - ttW);
                const ttY = hp.y - ttH - 10;
                return (
                    <g pointerEvents="none">
                        <rect x={ttX} y={ttY} width={ttW + 10} height={ttH + 10} rx={7} fill="#0f1f17" opacity={0.93} />
                        <text x={ttX + (ttW + 10) / 2} y={ttY + 16} textAnchor="middle" fontSize={11} fill="#6ee7b7" fontWeight="600">
                            พ.ศ. {hp.yearBE}
                        </text>
                        <text x={ttX + (ttW + 10) / 2} y={ttY + 34} textAnchor="middle" fontSize={13} fill="#ffffff" fontWeight="700">
                            {hp.co2.toLocaleString("th-TH", { maximumFractionDigits: 0 })} tCO₂
                        </text>
                        <polygon
                            points={`${hp.x - 5},${ttY + ttH} ${hp.x + 5},${ttY + ttH} ${hp.x},${ttY + ttH + 6}`}
                            fill="#0f1f17" opacity={0.93}
                        />
                    </g>
                );
            })()}
        </svg>
    );
}

// ── Main component ─────────────────────────────────────────────────────────
export function ParcelResultsPanel({
    searchRunning,
    searchErr,
    searchCount,
    searchTruncated,
    parcelFeatures,
    userDisplayName = "",
    drawnGeometry = null,
    onFlyTo,
    onReset,
    onBack,
    onCancel,
    currentStep,
    onStepChange,
}: Props) {
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const [plotTabs, setPlotTabs] = useState<Record<number, PlotTab>>({});
    const [forecastYrs, setForecastYrs] = useState<Record<number, ForecastYr>>({});
    const [summaryFcYrs, setSummaryFcYrs] = useState<ForecastYr>(7);
    const { user } = useAuth();


    // Step 3 form
    const [projectName, setProjectName] = useState("");
    const [ownerName, setOwnerName] = useState(userDisplayName);
    const [province, setProvince] = useState("");
    const [saveState, setSaveState] = useState<"idle" | "saving" | "done">("idle");

    const plots = useMemo(() => parcelFeatures.map(computePlot), [parcelFeatures]);
    const totalArea = useMemo(() => plots.reduce((s, p) => s + p.areaRai, 0), [plots]);
    const totalCO2 = useMemo(() => plots.reduce((s, p) => s + p.co2, 0), [plots]);
    const summaryPts = useMemo(() => summaryForecast(plots, summaryFcYrs), [plots, summaryFcYrs]);
    const dominantProvince = useMemo(() => {
        const freq: Record<string, number> = {};
        plots.forEach(p => { if (p.province) freq[p.province] = (freq[p.province] ?? 0) + 1; });
        return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    }, [plots]);

    if (!(searchRunning || searchErr || searchCount !== null)) return null;

    const toggleExpand = (i: number) => setExpandedIdx(prev => prev === i ? null : i);
    const tabFor = (i: number): PlotTab => plotTabs[i] ?? "analyze";
    const fcYrFor = (i: number): ForecastYr => forecastYrs[i] ?? 3;

    const router = useRouter();

    const handleSave = async () => {
        setSaveState("saving");
        await new Promise(r => setTimeout(r, 900));

        try {
            if (!user) {
                console.error("No user found, cannot save plots");
                return;
            }
            const key = `user_saved_plots_${user.id}`;
            const existingStr = localStorage.getItem(key);
            const existing = existingStr ? JSON.parse(existingStr) : [];
            const newPlots = plots.map((p, i) => {
                const feat = parcelFeatures[i];
                const props = (feat?.properties || {}) as any;
                return {
                    id: props.id || Math.random().toString(36).substring(7),
                    userId: user.id, // Add userId to the plot record
                    name: projectName || props.farm_name || "แปลงยางใหม่",
                    areaRai: p.areaRai,
                    carbonTotal: p.co2,
                    rubberAge: p.age,
                    plantYearBE: p.plantYearBE,
                    trees: p.trees,
                    confidence: p.confidence,
                    ownerName: ownerName || props.owner_name || "",
                    province: province || dominantProvince,
                    date: new Date().toISOString(),
                    geojson: feat?.geometry || null,
                    boundaryGeojson: drawnGeometry || null,
                    forecast: {
                        yr3: p.trees > 0 ? carbonForAge(p.age + 3, p.trees).co2 : 0,
                        yr5: p.trees > 0 ? carbonForAge(p.age + 5, p.trees).co2 : 0,
                        yr7: p.trees > 0 ? carbonForAge(p.age + 7, p.trees).co2 : 0,
                    },
                };
            });
            localStorage.setItem(key, JSON.stringify([...newPlots, ...existing]));

            // Save to global anonymous list for dashboard
            const globalKey = 'global_saved_plots';
            const globalExistingStr = localStorage.getItem(globalKey);
            const globalExisting = globalExistingStr ? JSON.parse(globalExistingStr) : [];
            const anonymousPlots = newPlots.map(p => ({
                ...p,
                name: "แปลงยางพารา (นิรนาม)", // Generic name
                ownerName: "",               // Remove personal info
            }));
            localStorage.setItem(globalKey, JSON.stringify([...anonymousPlots, ...globalExisting]));

        } catch (e) {
            console.error("Failed to save plots to localStorage", e);
        }

        setSaveState("done");
        
        // Redirect to dashboard page after a short delay
        setTimeout(() => {
            router.push("/dashboard");
        }, 1500);
    };

    // ── Loading ────────────────────────────────────────────────────────────
    if (searchRunning) {
        return (
            <div className="prp-shell">
                <div className="s1-results-loading">
                    <div className="s1-spin" />
                    <span>กำลังค้นหาแปลงที่ทับซ้อน...</span>
                </div>
                {onCancel && (
                    <button onClick={onCancel} style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 8, border: "1px solid #dc3545", background: "transparent", color: "#dc3545", fontSize: 13, cursor: "pointer", fontWeight: 500, margin: "16px auto 0" }}>
                        <i className="bi bi-x-circle" /> ยกเลิกการประมวลผล
                    </button>
                )}
            </div>
        );
    }

    // ── Error ──────────────────────────────────────────────────────────────
    if (searchErr) {
        return (
            <div className="prp-shell">
                <div className="s1-results-error">
                    <i className="bi bi-exclamation-triangle me-2" />{searchErr}
                </div>
                {onBack && (
                    <button className="mds-btn mds-btn-soft" style={{ marginTop: 12 }} onClick={onBack}>
                        <i className="bi bi-arrow-left me-1" /> กลับขั้นตอนที่ 1
                    </button>
                )}
            </div>
        );
    }

    if (searchCount === null) return null;

    // ── Step 3: Save form ──────────────────────────────────────────────────
    if (currentStep === 3) {
        return (
            <div className="prp-shell">
                <div className="prp-section-title" style={{ marginTop: 16 }}>
                    <i className="bi bi-pencil-square me-2" />บันทึกแปลง
                </div>
                <div className="prp-warn-banner">
                    <i className="bi bi-info-circle me-2" />
                    ขั้นตอนนี้ไม่บังคับ — กด &ldquo;เสร็จสิ้น ไม่บันทึก&rdquo; หากไม่ต้องการบันทึก
                </div>
                <div className="prp-save-summary">
                    สรุปแปลงที่จะบันทึก: <strong>{plots.length} แปลง</strong> · รวม <strong>{totalArea.toFixed(1)} ไร่</strong>
                </div>
                {saveState === "done" ? (
                    <div className="prp-save-success">
                        <i className="bi bi-check-circle-fill me-2" />บันทึกแปลงสำเร็จ!
                    </div>
                ) : (
                    <div className="prp-form">
                        <label className="prp-label">ชื่อโครงการ / แปลง <span className="prp-required">*</span></label>
                        <input className="prp-input" placeholder="เช่น สวนยางบ้านนาดี" value={projectName} onChange={e => setProjectName(e.target.value)} />
                        <label className="prp-label">เจ้าของแปลง</label>
                        <input className="prp-input" placeholder="ชื่อเจ้าของ" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
                        <label className="prp-label">จังหวัดหลัก</label>
                        <select className="prp-input" value={province || dominantProvince} onChange={e => setProvince(e.target.value)}>
                            <option value="">— เลือกจังหวัด —</option>
                            {THAI_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <button className="prp-btn-primary" onClick={handleSave} disabled={!projectName.trim() || saveState === "saving"}>
                            {saveState === "saving"
                                ? <><span className="s1-spin" style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> กำลังบันทึก...</>
                                : <><i className="bi bi-pencil-square me-2" />บันทึกแปลงในระบบ</>}
                        </button>
                    </div>
                )}
                <button className="prp-btn-ghost" onClick={() => { setSaveState("idle"); setSummaryFcYrs(7); onStepChange(2); }}>← กลับ</button>
                <button className="prp-btn-text" onClick={onReset}><i className="bi bi-check2-circle me-1" />เสร็จสิ้น ไม่บันทึก</button>
            </div>
        );
    }

    // ── Step 2: Analysis ───────────────────────────────────────────────────
    return (
        <div className="prp-shell">
            {/* Header */}
            <div className="prp-header-block">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div className="prp-main-title">ผลการตรวจจับแปลง</div>
                    {onBack && (
                        <button onClick={onBack} title="กลับขั้นตอนที่ 1"
                            style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 8, border: "1px solid #2d9e5f", background: "transparent", color: "#2d9e5f", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
                            <i className="bi bi-arrow-left" /> กลับ
                        </button>
                    )}
                </div>
                <div className="prp-subtitle">วิเคราะห์แปลงยางตามใบขอบเขตที่กำหนดด้วยภาพถ่ายดาวเทียม</div>
            </div>

            {searchCount === 0 ? (
                <div className="prp-empty">
                    <div className="prp-empty-icon"><i className="bi bi-search" /></div>
                    <div className="prp-empty-title">ไม่พบแปลงในขอบเขต</div>
                    <div className="prp-empty-hint">ลองวาดขอบเขตใหม่ในพื้นที่อื่น หรือขยายพื้นที่ให้กว้างขึ้น</div>
                    <button className="prp-btn-primary" style={{ marginTop: 20 }} onClick={onReset}>
                        <i className="bi bi-arrow-left-circle me-2" />กลับไปขั้นตอนที่ 1
                    </button>
                </div>
            ) : (
                <>
                    {/* KPI cards */}
                    <div className="prp-kpi-row">
                        <div className="prp-kpi-card">
                            <div className="prp-kpi-icon"><i className="bi bi-map" /></div>
                            <div className="prp-kpi-num">{searchCount.toLocaleString()}</div>
                            <div className="prp-kpi-label">แปลงที่ตรวจพบ</div>
                            <div className="prp-kpi-unit">แปลง</div>
                            {searchTruncated && <div className="prp-trunc-badge">สูงสุด 2,000</div>}
                        </div>
                        <div className="prp-kpi-card">
                            <div className="prp-kpi-icon"><i className="bi bi-rulers" /></div>
                            <div className="prp-kpi-num">{totalArea.toFixed(1)}</div>
                            <div className="prp-kpi-label">พื้นที่รวม</div>
                            <div className="prp-kpi-unit">ไร่</div>
                        </div>
                    </div>

                    {/* Plot list header */}
                    <div className="prp-list-header">
                        <span>รายแปลงที่พบ</span>
                        <span className="prp-pill">{parcelFeatures.length} แปลง</span>
                    </div>

                    <div className="prp-plot-list">
                        {parcelFeatures.slice(0, 50).map((feat, i) => {
                            const pl = plots[i];
                            if (!pl) return null;
                            const isOpen = expandedIdx === i;
                            const tab = tabFor(i);
                            const fcYr = fcYrFor(i);
                            const fcPts = forecastPts(pl.age, pl.trees, fcYr);

                            return (
                                <div key={i} className={`prp-plot-card${isOpen ? " open" : ""}`}>
                                    {/* Card header */}
                                    <div className="prp-plot-head" onClick={() => { toggleExpand(i); onFlyTo(feat); }}>
                                        <div className="prp-plot-num">{i + 1}</div>
                                        <div className="prp-plot-info">
                                            <div className="prp-plot-name">แปลงที่ {i + 1}</div>
                                            <div className="prp-plot-meta">
                                                {pl.areaRai > 0 ? `${pl.areaRai.toFixed(2)} ไร่` : "—"}
                                                {pl.age > 0 ? ` · อายุ ${pl.age} ปี` : ""}
                                            </div>
                                        </div>
                                        <button className="prp-analyze-btn" onClick={e => { e.stopPropagation(); onFlyTo(feat); }}>
                                            <i className="bi bi-check-circle-fill" /> วิเคราะห์แล้ว
                                        </button>
                                        <i className={`bi bi-chevron-${isOpen ? "up" : "down"} prp-chevron`} />
                                    </div>

                                    {/* Expanded content */}
                                    {isOpen && (
                                        <div className="prp-plot-body">
                                            <div className="prp-tabs">
                                                <button className={`prp-tab${tab === "analyze" ? " active" : ""}`}
                                                    onClick={() => setPlotTabs(prev => ({ ...prev, [i]: "analyze" }))}>
                                                    <i className="bi bi-bar-chart me-1" />วิเคราะห์
                                                </button>
                                                <button className={`prp-tab${tab === "forecast" ? " active" : ""}`}
                                                    onClick={() => setPlotTabs(prev => ({ ...prev, [i]: "forecast" }))}>
                                                    <i className="bi bi-graph-up me-1" />พยากรณ์
                                                </button>
                                            </div>

                                            {tab === "analyze" && (
                                                <div className="prp-tab-content">
                                                    <div className="prp-chart-label">
                                                        <i className="bi bi-bar-chart-fill me-1" style={{ color: "#10b981" }} />
                                                        การกระจายอายุยาง
                                                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 6 }}>(hover เพื่อดูคาร์บอน)</span>
                                                    </div>
                                                    <AgeBarChart age={pl.age} conf={pl.confidence} trees={pl.trees} />

                                                    <div className="prp-stat-row">
                                                        <div className="prp-stat">
                                                            <div className="prp-stat-val">{pl.plantYearBE || "—"}</div>
                                                            <div className="prp-stat-key">ปีปลูก</div>
                                                            <div className="prp-stat-unit">พ.ศ.</div>
                                                        </div>
                                                        <div className="prp-stat">
                                                            <div className="prp-stat-val">{pl.age || "—"}</div>
                                                            <div className="prp-stat-key">อายุ</div>
                                                            <div className="prp-stat-unit">ปี</div>
                                                        </div>
                                                        <div className="prp-stat">
                                                            <div className="prp-stat-val">{pl.areaRai.toFixed(2)}</div>
                                                            <div className="prp-stat-key">เนื้อที่</div>
                                                            <div className="prp-stat-unit">ไร่</div>
                                                        </div>
                                                    </div>

                                                    {pl.co2 > 0 && (
                                                        <div className="prp-co2-display">
                                                            <div className="prp-co2-display-left">
                                                                <div className="prp-co2-icon-wrap">
                                                                    <i className="bi bi-tree-fill" />
                                                                </div>
                                                                <div>
                                                                    <div className="prp-co2-display-label">คาร์บอนสะสม</div>
                                                                    <div className="prp-co2-display-sub">ณ ปัจจุบัน · tCO₂ eq.</div>
                                                                </div>
                                                            </div>
                                                            <div className="prp-co2-display-right">
                                                                <span className="prp-co2-display-num">
                                                                    {pl.co2.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                </div>
                                            )}

                                            {tab === "forecast" && (
                                                <div className="prp-tab-content">
                                                    <div className="prp-fc-yr-row">
                                                        {([3, 5, 7] as ForecastYr[]).map(yr => (
                                                            <button key={yr}
                                                                className={`prp-fc-yr-btn${fcYr === yr ? " active" : ""}`}
                                                                onClick={() => setForecastYrs(prev => ({ ...prev, [i]: yr }))}>
                                                                {yr} ปี
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="prp-chart-label">
                                                        <i className="bi bi-graph-up-arrow me-1" style={{ color: "#10b981" }} />
                                                        พยากรณ์คาร์บอน — แปลงที่ {i + 1}
                                                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 6 }}>(hover เพื่อดูค่า)</span>
                                                    </div>
                                                    <ForecastChart pts={fcPts} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {parcelFeatures.length > 50 && (
                            <div className="prp-more-note">
                                แสดง 50 แปลงแรก จาก {parcelFeatures.length.toLocaleString()} แปลง
                            </div>
                        )}
                    </div>

                    {/* Summary section */}
                    <div className="prp-summary-box">
                        <div className="prp-summary-title">
                            <i className="bi bi-bar-chart-line-fill me-2" />ภาพรวมของเขตที่พบ
                        </div>
                        <div className="prp-summary-sub">คาร์บอนรวมสะสมที่ขอบเขต</div>
                        <div className="prp-summary-num">
                            {totalCO2.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="prp-summary-unit">tCO₂ eq.</div>
                        <div className="prp-fc-yr-row" style={{ marginTop: 10 }}>
                            {([3, 5, 7] as ForecastYr[]).map(yr => (
                                <button key={yr} className={`prp-fc-yr-btn${summaryFcYrs === yr ? " active" : ""}`}
                                    onClick={() => setSummaryFcYrs(yr)}>
                                    {yr} ปี
                                </button>
                            ))}
                        </div>
                        <div className="prp-chart-label" style={{ marginTop: 8 }}>
                            <span style={{ fontSize: 10, color: "#94a3b8" }}>(hover บนกราฟเพื่อดูค่าคาร์บอนรายปี)</span>
                        </div>
                        <ForecastChart pts={summaryPts} />
                        <div className="prp-summary-note">พยากรณ์รวมทั้งหมด ({plots.length} แปลง)</div>
                    </div>

                    {/* Actions */}
                    <button className="prp-btn-primary" onClick={() => onStepChange(3)}>
                        <i className="bi bi-pencil-square me-2" />บันทึกแปลงในระบบ
                    </button>
                    <button className="prp-btn-ghost" onClick={onReset}>
                        <i className="bi bi-check2-circle me-1" />เสร็จสิ้น (ไม่บันทึก)
                    </button>
                </>
            )}
        </div>
    );
}
