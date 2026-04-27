import type { RefObject } from "react";
import { InfoKPI } from "@/app/components/atoms";
import { ParcelActionButtons } from "@/app/components/molecules";

type NdviStatus = number | null | "loading" | "error";

type InfographicData = {
    bracketCounts: number[];
    avgAge: number;
    topProvinces: Array<[string, number]>;
};

type Props = {
    searchRunning: boolean;
    searchErr: string | null;
    searchCount: number | null;
    searchTruncated: boolean;
    parcelFeatures: GeoJSON.Feature[];
    selectedParcelIdx: number[];
    tableOpen: boolean;
    ndviMap: Record<number, NdviStatus>;
    ndviFetching: boolean;
    ndviProgress: { done: number; total: number };
    infographic: InfographicData | null;
    ageCanvasRef: RefObject<HTMLCanvasElement | null>;
    onFetchAllNdvi: () => void;
    onToggleTable: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onToggleSelection: (index: number) => void;
    onFlyTo: (feature: GeoJSON.Feature) => void;
    onFetchNdvi: (index: number) => void;
};

const COL_HEADS = ["ชื่อ", "เลขทะเบียน", "อำเภอ", "จังหวัด", "ปีปลูก(DB)", "พื้นที่"];

function fmt(v: unknown) {
    return v == null || v === "" ? "—" : String(v);
}

export function ParcelResultsPanel({
    searchRunning,
    searchErr,
    searchCount,
    searchTruncated,
    parcelFeatures,
    selectedParcelIdx,
    tableOpen,
    ndviMap,
    ndviFetching,
    ndviProgress,
    infographic,
    ageCanvasRef,
    onFetchAllNdvi,
    onToggleTable,
    onSelectAll,
    onClearSelection,
    onToggleSelection,
    onFlyTo,
    onFetchNdvi,
}: Props) {
    if (!(searchRunning || searchErr || searchCount !== null)) return null;

    return (
        <div className="s1-results">
            {searchRunning && (
                <div className="s1-results-loading">
                    <div className="s1-spin" />
                    <span>กำลังค้นหาแปลงที่ทับซ้อน...</span>
                </div>
            )}

            {!searchRunning && searchErr && (
                <div className="s1-results-error">
                    <i className="bi bi-exclamation-triangle me-2"></i>{searchErr}
                </div>
            )}

            {!searchRunning && !searchErr && searchCount !== null && (
                <>
                    <div className={`s1-count-hero${searchCount === 0 ? " empty" : ""}`}>
                        <div className="s1-count-number">{searchCount > 0 ? searchCount.toLocaleString() : "—"}</div>
                        <div className="s1-count-label">{searchCount > 0 ? "แปลงยางในขอบเขต" : "ไม่พบแปลงในขอบเขต"}</div>
                        {parcelFeatures.length > 0 && (
                            <div className="s1-count-sub">
                                เลือกไว้ {selectedParcelIdx.length.toLocaleString()} แปลง
                                {searchTruncated && <span className="s1-truncated-badge"> · สูงสุด 2,000</span>}
                            </div>
                        )}
                    </div>

                    {parcelFeatures.length > 0 && (
                        <ParcelActionButtons
                            ndviFetching={ndviFetching}
                            ndviDone={ndviProgress.done}
                            ndviTotal={ndviProgress.total}
                            tableOpen={tableOpen}
                            onFetchNdvi={onFetchAllNdvi}
                            onToggleTable={onToggleTable}
                            onSelectAll={onSelectAll}
                        />
                    )}

                    {tableOpen && parcelFeatures.length > 0 && (
                        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid rgba(45,158,95,0.18)", marginBottom: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderBottom: "1px solid rgba(45,158,95,0.15)", background: "rgba(45,158,95,0.04)" }}>
                                <div style={{ fontSize: 11, color: "var(--text-mid)" }}>
                                    Step 3 ใช้: <strong>{selectedParcelIdx.length.toLocaleString()}</strong> / {parcelFeatures.length.toLocaleString()} แปลง
                                </div>
                                <button
                                    onClick={onClearSelection}
                                    style={{ background: "rgba(255,99,71,0.08)", border: "1px solid rgba(255,99,71,0.25)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, color: "rgba(176,43,43,0.95)", cursor: "pointer" }}
                                >
                                    ล้างเลือก
                                </button>
                            </div>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                <thead>
                                    <tr style={{ background: "rgba(45,158,95,0.10)" }}>
                                        <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 700, color: "var(--kc-green-d, #1e7a47)", whiteSpace: "nowrap", borderBottom: "1px solid rgba(45,158,95,0.15)" }}>เลือก</th>
                                        {COL_HEADS.map((h) => (
                                            <th key={h} style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, color: "var(--kc-green-d, #1e7a47)", whiteSpace: "nowrap", borderBottom: "1px solid rgba(45,158,95,0.15)" }}>{h}</th>
                                        ))}
                                        <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 700, color: "var(--kc-green-d, #1e7a47)", whiteSpace: "nowrap", borderBottom: "1px solid rgba(45,158,95,0.15)" }}>
                                            <span title="Normalized Difference Vegetation Index — Google Earth Engine Sentinel-2/Landsat-9">
                                                NDVI <i className="bi bi-globe2" style={{ fontSize: 9, opacity: 0.7 }} />
                                            </span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parcelFeatures.slice(0, 200).map((feat, i) => {
                                        const p = (feat.properties ?? {}) as Record<string, unknown>;
                                        const selected = selectedParcelIdx.includes(i);

                                        return (
                                            <tr
                                                key={i}
                                                onClick={() => onFlyTo(feat)}
                                                style={{ cursor: "pointer", borderBottom: "1px solid rgba(45,158,95,0.08)", background: i % 2 === 0 ? "transparent" : "rgba(45,158,95,0.03)", transition: "background 0.15s" }}
                                                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(45,158,95,0.10)")}
                                                onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(45,158,95,0.03)")}
                                            >
                                                <td style={{ padding: "6px 8px", textAlign: "center" }} onClick={(e) => { e.stopPropagation(); onToggleSelection(i); }}>
                                                    <input type="checkbox" checked={selected} readOnly />
                                                </td>
                                                <td style={{ padding: "6px 8px", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fmt(p.farm_name)}>{fmt(p.farm_name)}</td>
                                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.farm_idc)}</td>
                                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.amphur)}</td>
                                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.province)}</td>
                                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.grow_year)}</td>
                                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.grow_area)}</td>
                                                <td style={{ padding: "6px 8px", whiteSpace: "nowrap", textAlign: "center" }} onClick={(e) => { e.stopPropagation(); onFetchNdvi(i); }}>
                                                    {ndviMap[i] === undefined && <span style={{ cursor: "pointer", color: "rgba(45,158,95,0.55)", fontSize: 10, textDecoration: "underline dotted" }}>ดึง</span>}
                                                    {ndviMap[i] === "loading" && <span className="spinner-border spinner-border-sm" style={{ width: 10, height: 10 }} />}
                                                    {ndviMap[i] === "error" && <span style={{ color: "rgba(220,53,69,0.8)", fontSize: 10, cursor: "pointer" }} title="เกิดข้อผิดพลาด — คลิกลองใหม่">✗</span>}
                                                    {ndviMap[i] === null && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>N/A</span>}
                                                    {typeof ndviMap[i] === "number" && (
                                                        <span style={{ fontWeight: 700, fontSize: 11, color: (ndviMap[i] as number) < 0.1 ? "#c0392b" : (ndviMap[i] as number) < 0.3 ? "#e67e22" : (ndviMap[i] as number) < 0.5 ? "#d4ac0d" : "#2d9e5f" }}>
                                                            {(ndviMap[i] as number).toFixed(3)}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {parcelFeatures.length > 200 && (
                                <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-dim)", textAlign: "center", borderTop: "1px solid rgba(45,158,95,0.1)" }}>
                                    แสดง 200 แถวแรก จาก {parcelFeatures.length.toLocaleString()} รายการ
                                </div>
                            )}
                        </div>
                    )}

                    {infographic && (
                        <div className="s1-infographic">
                            <div className="s1-infographic-header">
                                <i className="bi bi-bar-chart-line"></i> ข้อมูลอายุต้นยางในพื้นที่
                            </div>

                            <div className="s1-kpi-row">
                                <InfoKPI value={parcelFeatures.length.toLocaleString()} label="แปลงทั้งหมด" />
                                <InfoKPI value={infographic.avgAge.toFixed(1)} label="อายุเฉลี่ย (ปี)" />
                                <InfoKPI value={infographic.topProvinces.length.toString()} label="จังหวัด" />
                            </div>

                            <div className="s1-chart-wrap">
                                <div className="s1-chart-title">การกระจายอายุต้นยาง</div>
                                <canvas ref={ageCanvasRef} height={140} />
                            </div>

                            {infographic.topProvinces.length > 0 && (
                                <div className="s1-province-list">
                                    <div className="s1-chart-title">จังหวัดที่พบมากสุด</div>
                                    {infographic.topProvinces.map(([prov, count]) => {
                                        const pct = Math.round((count / parcelFeatures.length) * 100);
                                        return (
                                            <div key={prov} className="s1-prov-row">
                                                <span className="s1-prov-name">{prov}</span>
                                                <div className="s1-prov-bar-wrap">
                                                    <div className="s1-prov-bar" style={{ width: `${pct}%` }} />
                                                </div>
                                                <span className="s1-prov-count">{count.toLocaleString()}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
