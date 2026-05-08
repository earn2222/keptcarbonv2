"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { carbonForAge } from "@/lib/map-utils";
import { useAuth } from "@/lib/auth-context";
import { CarbonBarChart, buildBarPoints, carbonCo2 } from "./CarbonBarChart";


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
type SubStep = "form" | "carbon" | "save";

interface PlotFormData {
    plantYear: string;
    treeCount: string;
    variety: string;
    spacing: string;
}

const VARIETY_OPTIONS = [
    "RRIM 600", "GT1", "BPM 24", "PB 235", "PB 260",
    "RRIT 408", "RRIT 251", "สงขลา 36", "RRIM 712", "อื่นๆ",
];
const SPACING_OPTIONS = ["2.5*8", "3*7", "2.5*7", "3*6"];
const YEAR_OPTIONS = Array.from({ length: 50 }, (_, i) => String(new Date().getFullYear() + 543 - i));

interface CarbonResult {
    plotIdx: number;
    age: number;
    plantYearBE: number;
    trees: number;
    spacing: string;
    variety: string;
    co2Now: number;
    source: "user" | "backend";
}

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
function AgeBarChart({ age, conf, trees, isMobile }: { age: number; conf: number; trees: number; isMobile?: boolean }) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const dist = ageDistribution(age, conf);
    const maxPct = Math.max(...dist.map(d => d.pct));

    const W = isMobile ? 400 : 550, BAR_W = isMobile ? 58 : 64, GAP = isMobile ? 10 : 22;
    const totalW = dist.length * BAR_W + (dist.length - 1) * GAP;
    const sx = (W - totalW) / 2;
    const BASE_Y = isMobile ? 180 : 200, MAX_BH = isMobile ? 120 : 140, H = isMobile ? 240 : 260;

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
                            <text x={cx} y={BASE_Y - bh - 8} textAnchor="middle"
                                fontSize={isMain ? (isMobile ? 22 : 21) : (isMobile ? 18 : 16)}
                                fontWeight={isMain ? "900" : isHov ? "700" : "500"}
                                fill={isMain ? "#065f46" : isHov ? "#059669" : "#94a3b8"}>
                                {pct}%
                            </text>
                            {/* age label below */}
                            <text x={cx} y={BASE_Y + 22} textAnchor="middle" fontSize={isMobile ? 16 : 16}
                                fontWeight={isMain ? "800" : "500"}
                                fill={isMain ? "#059669" : isHov ? "#10b981" : "#94a3b8"}>
                                {a}
                            </text>
                            {/* age unit */}
                            <text x={cx} y={BASE_Y + 40} textAnchor="middle" fontSize={isMobile ? 13 : 12} fill="#cbd5e1" fontWeight="400">ปี</text>

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
function ForecastChart({ pts, isMobile }: { pts: Array<{ yearBE: number; co2: number }>; isMobile?: boolean }) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const W = isMobile ? 360 : 550, H = isMobile ? 230 : 250, PL = 12, PR = isMobile ? 55 : 75, PT = isMobile ? 24 : 30, PB = isMobile ? 38 : 42;
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
                <text key={p.yearBE} x={p.x} y={H - 12} textAnchor="middle" fontSize={isMobile ? 14 : 13} fill="#94a3b8">
                    {p.yearBE}
                </text>
            ))}

            {/* Y axis labels */}
            <text x={PL + iW + 8} y={PT + 4} fontSize={isMobile ? 12 : 11} fill="#6b9e7e" textAnchor="start">
                {Math.round(maxV).toLocaleString()}
            </text>
            <text x={PL + iW + 8} y={PT + iH + 4} fontSize={isMobile ? 12 : 11} fill="#6b9e7e" textAnchor="start">
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

    // Responsive detection
    const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
    useMemo(() => {
        if (typeof window === "undefined") return;
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);


    // Step 3 form
    const [subStep, setSubStep] = useState<SubStep>("form");
    const [projectName, setProjectName] = useState("");
    const [ownerName, setOwnerName] = useState(userDisplayName);
    const [province, setProvince] = useState("");
    const [saveState, setSaveState] = useState<"idle" | "saving" | "done">("idle");
    const [plotForms, setPlotForms] = useState<PlotFormData[]>([]);
    const [carbonResults, setCarbonResults] = useState<CarbonResult[]>([]);
    const [selectedCarbonIdx, setSelectedCarbonIdx] = useState(0);

    // Initialize plotForms when entering step 3
    const initPlotForms = () => {
        setPlotForms(plots.map(p => ({
            plantYear: p.plantYearBE > 0 ? String(p.plantYearBE) : "",
            treeCount: p.trees > 0 ? String(p.trees) : "",
            variety: "",
            spacing: "2.5*8",
        })));
        setSubStep("form");
        setProjectName("");
        onStepChange(3);
    };

    const handleProcessCarbon = () => {
        const CURRENT_BE_NOW = new Date().getFullYear() + 543;
        const results: CarbonResult[] = plots.map((p, i) => {
            const form = plotForms[i];
            const userPlantYear = form?.plantYear ? parseInt(form.plantYear) : 0;
            const userTrees = form?.treeCount ? parseInt(form.treeCount) : 0;
            const userSpacing = form?.spacing || "2.5*8";
            const userVariety = form?.variety || "";
            const userAge = userPlantYear > 0 ? CURRENT_BE_NOW - userPlantYear : 0;
            const backendAge = p.age;
            // Has user data
            const hasUserData = userPlantYear > 0 || userTrees > 0;
            let finalAge = backendAge;
            let finalTrees = userTrees > 0 ? userTrees : p.trees;
            let source: "user" | "backend" = "backend";
            if (hasUserData && userAge > 0) {
                const ageDiff = Math.abs(userAge - backendAge);
                if (ageDiff > 3) {
                    // Use user's data (backend likely wrong)
                    finalAge = userAge;
                    source = "user";
                } else {
                    // Within 3 years - use user data for validation
                    finalAge = userAge;
                    source = "user";
                }
            }
            if (userTrees > 0) finalTrees = userTrees;
            const finalPlantYear = userPlantYear > 0 ? userPlantYear : (CURRENT_BE_NOW - backendAge);
            const co2Now = carbonCo2(Math.max(finalAge, 1), finalTrees, userSpacing);
            return {
                plotIdx: i,
                age: Math.max(finalAge, 1),
                plantYearBE: finalPlantYear,
                trees: finalTrees,
                spacing: userSpacing,
                variety: userVariety,
                co2Now,
                source,
            };
        });
        setCarbonResults(results);
        setSelectedCarbonIdx(0);
        setSubStep("carbon");
    };


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
            if (!user) return;
            const key = `user_saved_plots_${user.id}`;
            const existing = JSON.parse(localStorage.getItem(key) || "[]");
            const CURRENT_BE_NOW = new Date().getFullYear() + 543;
            const newPlots = plots.map((p, i) => {
                const feat = parcelFeatures[i];
                const props = (feat?.properties || {}) as any;
                const cr = carbonResults[i];
                const form = plotForms[i];
                const age = cr?.age ?? p.age;
                const trees = cr?.trees ?? p.trees;
                const spacing = cr?.spacing || "2.5*8";
                const finalPlantYear = cr?.plantYearBE ?? p.plantYearBE;
                const co2 = cr?.co2Now ?? p.co2;
                return {
                    id: props.id || Math.random().toString(36).substring(7),
                    userId: user.id,
                    name: projectName || props.farm_name || "แปลงยางใหม่",
                    areaRai: p.areaRai,
                    carbonTotal: co2,
                    rubberAge: age,
                    plantYearBE: finalPlantYear,
                    trees,
                    variety: form?.variety || cr?.variety || "",
                    spacing,
                    confidence: p.confidence,
                    ownerName: ownerName || props.owner_name || "",
                    province: province || dominantProvince,
                    date: new Date().toISOString(),
                    geojson: feat?.geometry || null,
                    boundaryGeojson: drawnGeometry || null,
                    forecast: {
                        yr3: carbonCo2(age + 3, trees, spacing),
                        yr5: carbonCo2(age + 5, trees, spacing),
                        yr7: carbonCo2(age + 7, trees, spacing),
                    },
                };
            });
            localStorage.setItem(key, JSON.stringify([...newPlots, ...existing]));
            const globalKey = "global_saved_plots";
            const globalExisting = JSON.parse(localStorage.getItem(globalKey) || "[]");
            localStorage.setItem(globalKey, JSON.stringify([...newPlots, ...globalExisting]));
        } catch (e) { console.error(e); }
        setSaveState("done");
        setTimeout(() => router.push("/my-plots"), 1500);
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

    // ── Step 3: Data entry + Carbon + Save ────────────────────────────────
    if (currentStep === 3) {
        // ── sub: form ──
        if (subStep === "form") {
            const updateForm = (idx: number, field: keyof PlotFormData, val: string) => {
                setPlotForms(prev => prev.map((f, i) => i === idx ? { ...f, [field]: val } : f));
            };
            return (
                <div className="prp-shell">
                    <div className="prp-header-block">
                        <div className="prp-main-title" style={{ fontSize: isMobile ? 16 : 18 }}>
                            <i className="bi bi-pencil-square me-2" style={{ color: "#10b981" }} />กรอกข้อมูลแปลง
                        </div>
                        <div className="prp-subtitle">กรอกหรือข้ามได้ — ข้อมูลจะนำไปประมวลผลคาร์บอน</div>
                    </div>

                    {/* Project name — shared */}
                    <div style={{ background: "linear-gradient(135deg,#f0fdf4,#ecfdf5)", borderRadius: 14, padding: isMobile ? "14px 14px" : "16px 20px", marginBottom: 16, border: "1px solid rgba(16,185,129,0.18)" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                            <i className="bi bi-folder2-open" /> ชื่อโครงการ (ใช้ร่วมกันทุกแปลง)
                        </div>
                        <input className="prp-input" style={{ marginBottom: 0 }} placeholder="เช่น สวนยางบ้านนาดี" value={projectName} onChange={e => setProjectName(e.target.value)} />
                    </div>

                    {/* Per-plot fields */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {plots.map((p, i) => {
                            const form = plotForms[i] || { plantYear: "", treeCount: "", variety: "", spacing: "2.5*8" };
                            return (
                                <div key={i} style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(16,185,129,0.15)", overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.04)" }}>
                                    {/* Plot header */}
                                    <div style={{ background: "linear-gradient(135deg,rgba(16,185,129,0.08),rgba(5,150,105,0.04))", padding: "10px 14px", borderBottom: "1px solid rgba(16,185,129,0.1)", display: "flex", alignItems: "center", gap: 10 }}>
                                        <div style={{ width: 28, height: 28, borderRadius: 8, background: "#10b981", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{i + 1}</div>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>แปลงที่ {i + 1}</div>
                                            <div style={{ fontSize: 11, color: "#64748b" }}>{p.areaRai > 0 ? `${p.areaRai.toFixed(2)} ไร่` : "—"}{p.age > 0 ? ` · อายุ ${p.age} ปี (ข้อมูลระบบ)` : ""}</div>
                                        </div>
                                    </div>
                                    {/* Fields grid */}
                                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10, padding: "12px 14px" }}>
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 }}>ปีที่ปลูก (พ.ศ.)</div>
                                            <select className="prp-input" style={{ marginBottom: 0, fontSize: isMobile ? 13 : 12 }} value={form.plantYear} onChange={e => updateForm(i, "plantYear", e.target.value)}>
                                                <option value="">— เลือกปี —</option>
                                                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 }}>จำนวนต้นยาง</div>
                                            <input className="prp-input" style={{ marginBottom: 0, fontSize: isMobile ? 13 : 12 }} type="number" placeholder="เช่น 200" value={form.treeCount} onChange={e => updateForm(i, "treeCount", e.target.value)} />
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 }}>พันธุ์ยาง</div>
                                            <select className="prp-input" style={{ marginBottom: 0, fontSize: isMobile ? 13 : 12 }} value={form.variety} onChange={e => updateForm(i, "variety", e.target.value)}>
                                                <option value="">— เลือกพันธุ์ —</option>
                                                {VARIETY_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 4 }}>ระยะห่างปลูก (ม.)</div>
                                            <select className="prp-input" style={{ marginBottom: 0, fontSize: isMobile ? 13 : 12 }} value={form.spacing} onChange={e => updateForm(i, "spacing", e.target.value)}>
                                                {SPACING_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                        <button className="prp-btn-primary" onClick={handleProcessCarbon} style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}>
                            <i className="bi bi-graph-up-arrow me-2" />ประมวลผลคาร์บอน
                        </button>
                        <button className="prp-btn-primary" onClick={() => { setSubStep("save"); }} style={{ background: "linear-gradient(135deg,#0369a1,#0284c7)" }}>
                            <i className="bi bi-floppy-disk me-2" />บันทึกลงฐานข้อมูล
                        </button>
                        <button className="prp-btn-ghost" onClick={() => { onStepChange(2); }}>← กลับผลการวิเคราะห์</button>
                        <button className="prp-btn-text" onClick={onReset}><i className="bi bi-x-circle me-1" />ยกเลิก</button>
                    </div>
                </div>
            );
        }

        // ── sub: carbon results ──
        if (subStep === "carbon") {
            const cr = carbonResults[selectedCarbonIdx];
            const pts = cr ? buildBarPoints(cr.age, cr.plantYearBE, cr.trees, cr.spacing) : [];
            return (
                <div className="prp-shell">
                    <div className="prp-header-block">
                        <div className="prp-main-title" style={{ fontSize: isMobile ? 16 : 18 }}>
                            <i className="bi bi-bar-chart-fill me-2" style={{ color: "#10b981" }} />ผลการประมวลผลคาร์บอน
                        </div>
                        <div className="prp-subtitle">กราฟแท่งคาร์บอนทุก 7 ปี ถึงอายุ 35 ปี</div>
                    </div>

                    {/* Plot selector */}
                    {carbonResults.length > 1 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                            {carbonResults.map((cr, i) => (
                                <button key={i} onClick={() => setSelectedCarbonIdx(i)} style={{ padding: "5px 12px", borderRadius: 8, border: `1.5px solid ${selectedCarbonIdx === i ? "#10b981" : "rgba(16,185,129,0.25)"}`, background: selectedCarbonIdx === i ? "#10b981" : "transparent", color: selectedCarbonIdx === i ? "#fff" : "#059669", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                                    แปลงที่ {i + 1}
                                </button>
                            ))}
                        </div>
                    )}

                    {cr && (
                        <>
                            {/* Plot info summary */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
                                {[
                                    { label: "อายุปัจจุบัน", val: `${cr.age} ปี`, color: "#059669" },
                                    { label: "จำนวนต้น", val: cr.trees.toLocaleString("th-TH"), color: "#7c3aed" },
                                    { label: "คาร์บอนปัจจุบัน", val: `${cr.co2Now.toFixed(1)} tCO₂`, color: "#0d9488" },
                                ].map(({ label, val, color }) => (
                                    <div key={label} style={{ background: "#fff", borderRadius: 10, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(0,0,0,0.06)" }}>
                                        <div style={{ fontSize: isMobile ? 14 : 13, fontWeight: 800, color }}>{val}</div>
                                        <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 2 }}>{label}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Source badge */}
                            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: cr.source === "user" ? "#059669" : "#0369a1", background: cr.source === "user" ? "rgba(16,185,129,0.08)" : "rgba(3,105,161,0.08)", padding: "5px 12px", borderRadius: 20, border: `1px solid ${cr.source === "user" ? "rgba(16,185,129,0.25)" : "rgba(3,105,161,0.25)"}`, width: "fit-content" }}>
                                <i className={`bi bi-${cr.source === "user" ? "person-check-fill" : "database-fill"}`} />
                                {cr.source === "user" ? "ใช้ข้อมูลที่กรอก" : "ใช้ข้อมูลระบบ"}
                                {cr.variety && <span style={{ marginLeft: 4, opacity: 0.7 }}>· {cr.variety}</span>}
                                <span style={{ marginLeft: 4, opacity: 0.7 }}>· ระยะ {cr.spacing} ม.</span>
                            </div>

                            {/* Bar chart */}
                            <CarbonBarChart pts={pts} isMobile={isMobile} />

                            <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 6 }}>
                                hover บนแท่งเพื่อดูรายละเอียด · แบ่งทุก 7 ปี (โคลนต้นยาง)
                            </div>
                        </>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                        <button className="prp-btn-primary" onClick={() => setSubStep("save")} style={{ background: "linear-gradient(135deg,#0369a1,#0284c7)" }}>
                            <i className="bi bi-floppy-disk me-2" />บันทึกผลลงฐานข้อมูล
                        </button>
                        <button className="prp-btn-ghost" onClick={() => setSubStep("form")}>← กลับแก้ไขข้อมูล</button>
                        <button className="prp-btn-text" onClick={onReset}><i className="bi bi-x-circle me-1" />ไม่บันทึก</button>
                    </div>
                </div>
            );
        }

        // ── sub: save form ──
        return (
            <div className="prp-shell">
                <div className="prp-section-title" style={{ marginTop: 16 }}>
                    <i className="bi bi-floppy-disk me-2" />บันทึกแปลงในระบบ
                </div>
                <div className="prp-save-summary">
                    บันทึก <strong>{plots.length} แปลง</strong> · รวม <strong>{totalArea.toFixed(1)} ไร่</strong>
                </div>
                {saveState === "done" ? (
                    <div className="prp-save-success"><i className="bi bi-check-circle-fill me-2" />บันทึกแปลงสำเร็จ!</div>
                ) : (
                    <div className="prp-form">
                        <label className="prp-label">ชื่อโครงการ <span className="prp-required">*</span></label>
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
                                : <><i className="bi bi-floppy-disk me-2" />บันทึก</>}
                        </button>
                    </div>
                )}
                <button className="prp-btn-ghost" onClick={() => setSubStep(carbonResults.length > 0 ? "carbon" : "form")}>← กลับ</button>
                <button className="prp-btn-text" onClick={onReset}><i className="bi bi-x-circle me-1" />ยกเลิก</button>
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
                            <div className="prp-kpi-num" style={{ fontSize: isMobile ? 22 : 36 }}>{searchCount.toLocaleString()}</div>
                            <div className="prp-kpi-label">แปลงที่ตรวจพบ</div>
                            <div className="prp-kpi-unit">แปลง</div>
                            {searchTruncated && <div className="prp-trunc-badge">สูงสุด 2,000</div>}
                        </div>
                        <div className="prp-kpi-card">
                            <div className="prp-kpi-icon"><i className="bi bi-rulers" /></div>
                            <div className="prp-kpi-num" style={{ fontSize: isMobile ? 22 : 36 }}>{totalArea.toFixed(1)}</div>
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
                                            <i className="bi bi-check-circle-fill" />
                                            <span className="d-none d-md-inline ms-1">วิเคราะห์แล้ว</span>
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
                                                <div className="prp-tab-analyze">
                                                    <div className="prp-chart-label">
                                                        <i className="bi bi-bar-chart-fill me-1" style={{ color: "#10b981" }} />
                                                        การกระจายอายุยาง
                                                        <span style={{ fontSize: isMobile ? 12 : 10, color: "#94a3b8", marginLeft: 6 }}>(hover เพื่อดูคาร์บอน)</span>
                                                    </div>
                                                    <AgeBarChart age={pl.age} conf={pl.confidence} trees={pl.trees} isMobile={isMobile} />

                                                    <div className="prp-stat-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                                                        <div className="prp-stat" style={{ margin: 0, padding: isMobile ? "14px 6px" : "8px 4px 6px" }}>
                                                            <div className="prp-stat-val" style={{ fontSize: isMobile ? 22 : 18 }}>{pl.plantYearBE || "—"}</div>
                                                            <div className="prp-stat-key" style={{ fontSize: isMobile ? 14 : 12, marginTop: 2 }}>ปีปลูก</div>
                                                            <div className="prp-stat-unit" style={{ fontSize: isMobile ? 11 : 10 }}>พ.ศ.</div>
                                                        </div>
                                                        <div className="prp-stat" style={{ margin: 0, padding: isMobile ? "14px 6px" : "8px 4px 6px" }}>
                                                            <div className="prp-stat-val" style={{ fontSize: isMobile ? 22 : 18 }}>{pl.age || "—"}</div>
                                                            <div className="prp-stat-key" style={{ fontSize: isMobile ? 14 : 12, marginTop: 2 }}>อายุ</div>
                                                            <div className="prp-stat-unit" style={{ fontSize: isMobile ? 11 : 10 }}>ปี</div>
                                                        </div>
                                                        <div className="prp-stat" style={{ margin: 0, padding: isMobile ? "14px 6px" : "8px 4px 6px" }}>
                                                            <div className="prp-stat-val" style={{ fontSize: isMobile ? 22 : 18 }}>{pl.areaRai.toFixed(2)}</div>
                                                            <div className="prp-stat-key" style={{ fontSize: isMobile ? 14 : 12, marginTop: 2 }}>เนื้อที่</div>
                                                            <div className="prp-stat-unit" style={{ fontSize: isMobile ? 11 : 10 }}>ไร่</div>
                                                        </div>
                                                        <div className="prp-stat" style={{ margin: 0, padding: isMobile ? "14px 6px" : "8px 4px 6px" }}>
                                                            <div className="prp-stat-val" style={{ fontSize: isMobile ? 22 : 18 }}>{pl.trees.toLocaleString()}</div>
                                                            <div className="prp-stat-key" style={{ fontSize: isMobile ? 14 : 12, marginTop: 2 }}>จำนวนต้น</div>
                                                            <div className="prp-stat-unit" style={{ fontSize: isMobile ? 11 : 10 }}>ต้น</div>
                                                        </div>
                                                    </div>

                                                    {pl.co2 > 0 && (
                                                        <div style={{
                                                            display: "grid",
                                                            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                                                            gap: 12,
                                                            marginTop: 16
                                                        }}>
                                                            {/* Card 1: Per Tree */}
                                                            <div className="prp-co2-display" style={{
                                                                margin: 0,
                                                                padding: isMobile ? "14px 18px" : "10px 14px",
                                                                background: "linear-gradient(135deg, #ffffff 0%, #f0fdfa 100%)",
                                                                borderLeft: "4px solid #0d9488",
                                                                boxShadow: "0 4px 15px rgba(13, 148, 136, 0.08)"
                                                            }}>
                                                                <div className="prp-co2-display-left" style={{ gap: 10 }}>
                                                                    <div className="prp-co2-icon-wrap" style={{
                                                                        width: isMobile ? 40 : 32,
                                                                        height: isMobile ? 40 : 32,
                                                                        background: "#f0fdfa",
                                                                        color: "#0d9488",
                                                                        borderColor: "rgba(13, 148, 136, 0.15)",
                                                                        borderRadius: "10px"
                                                                    }}>
                                                                        <i className="bi bi-tree" style={{ fontSize: isMobile ? 18 : 15 }} />
                                                                    </div>
                                                                    <div>
                                                                        <div className="prp-co2-display-label" style={{ fontSize: isMobile ? 14 : 13, color: "#0f172a" }}>ต่อต้น</div>
                                                                        <div className="prp-co2-display-sub" style={{ fontSize: isMobile ? 11 : 10, color: "#64748b" }}>tCO₂ eq.</div>
                                                                    </div>
                                                                </div>
                                                                <div className="prp-co2-display-right">
                                                                    <span className="prp-co2-display-num" style={{ color: "#0d9488", fontSize: isMobile ? 24 : 18, fontWeight: 900 }}>
                                                                        {(pl.co2 / pl.trees).toFixed(3)}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {/* Card 2: Total Plot */}
                                                            <div className="prp-co2-display" style={{
                                                                margin: 0,
                                                                padding: isMobile ? "14px 18px" : "10px 14px",
                                                                background: "linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%)",
                                                                borderLeft: "4px solid #10b981",
                                                                boxShadow: "0 4px 15px rgba(16, 185, 129, 0.08)"
                                                            }}>
                                                                <div className="prp-co2-display-left" style={{ gap: 10 }}>
                                                                    <div className="prp-co2-icon-wrap" style={{
                                                                        width: isMobile ? 40 : 32,
                                                                        height: isMobile ? 40 : 32,
                                                                        background: "#f0fdf4",
                                                                        color: "#10b981",
                                                                        borderColor: "rgba(16, 185, 129, 0.15)",
                                                                        borderRadius: "10px"
                                                                    }}>
                                                                        <i className="bi bi-tree-fill" style={{ fontSize: isMobile ? 18 : 15 }} />
                                                                    </div>
                                                                    <div>
                                                                        <div className="prp-co2-display-label" style={{ fontSize: isMobile ? 14 : 13, color: "#0f172a" }}>ทั้งแปลง</div>
                                                                        <div className="prp-co2-display-sub" style={{ fontSize: isMobile ? 11 : 10, color: "#64748b" }}>tCO₂ eq.</div>
                                                                    </div>
                                                                </div>
                                                                <div className="prp-co2-display-right">
                                                                    <span className="prp-co2-display-num" style={{ color: "#10b981", fontSize: isMobile ? 24 : 18, fontWeight: 900 }}>
                                                                        {pl.co2.toLocaleString("th-TH", { maximumFractionDigits: 1 })}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {tab === "forecast" && (
                                                <div className="prp-tab-forecast">
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
                                                        <span style={{ fontSize: isMobile ? 12 : 10, color: "#94a3b8", marginLeft: 6 }}>(hover เพื่อดูค่า)</span>
                                                    </div>
                                                    <ForecastChart pts={fcPts} isMobile={isMobile} />
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
                        <div className="prp-summary-num" style={{ fontSize: isMobile ? 28 : 32 }}>
                            {totalCO2.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="prp-summary-unit" style={{ fontSize: isMobile ? 15 : 14 }}>tCO₂ eq.</div>
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
                        <ForecastChart pts={summaryPts} isMobile={isMobile} />
                        <div className="prp-summary-note">พยากรณ์รวมทั้งหมด ({plots.length} แปลง)</div>
                    </div>

                    {/* Actions */}
                    <button className="prp-btn-primary" onClick={initPlotForms}>
                        <i className="bi bi-pencil-square me-2" />กรอกข้อมูล / ประมวลผลคาร์บอน
                    </button>
                    <button className="prp-btn-ghost" onClick={onReset}>
                        <i className="bi bi-check2-circle me-1" />เสร็จสิ้น (ไม่บันทึก)
                    </button>
                </>
            )}
        </div>
    );
}
