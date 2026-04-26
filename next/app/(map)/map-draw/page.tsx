"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
  type ChartItem,
} from "chart.js";
import JSZip from "jszip";
import { useAuth } from "@/lib/auth-context";
import { PlotDB } from "@/lib/auth";
import {
  carbonForAge,
  emptyFC,
  isMobile,
  polygonAreaM2,
  type LngLat,
} from "@/lib/map-utils";

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
);

type Step = 1 | 2 | 3 | 4 | 5;
type Tab = "draw" | "shp";
type NdviStatus = number | null | "loading" | "error";

type PlotData = {
  name: string;
  ownerName: string;
  province: string;
  plantYearInput: string;
  variety: string;
  areaSqm: number;
  areaRai: number;
  treeCount: number;
  plantYear: number;
  treeAge: number;
  H: number;
  D: number;
  bio: number;
  co2: number;
};

const PROVINCES = [
  "ระยอง", "ชุมพร", "สุราษฎร์ธานี", "นครศรีธรรมราช", "ตรัง", "สงขลา",
  "ยะลา", "นราธิวาส", "พัทลุง", "กระบี่", "พังงา", "ภูเก็ต", "ปัตตานี",
  "สตูล", "อื่นๆ",
];
const VARIETIES = ["RRIM 600", "BPM 24", "GT 1", "PR 255", "PB 260", "RRIT 226", "อื่นๆ"];

const STEP_LABELS = ["เลือกวิธี", "ข้อมูล", "ตรวจอายุ", "คาร์บอน", "พยากรณ์"];

const navItems = [
  { href: "/", icon: "bi-house", label: "หน้าหลัก" },
  { href: "/dashboard", icon: "bi-grid-1x2", label: "แดชบอร์ด" },
  { href: "/map-draw", icon: "bi-map", label: "วาดแปลง (Map Draw)", section: "จัดการพื้นที่" },
  { href: "/my-plots", icon: "bi-collection", label: "แปลงของฉัน" },
  { href: "/profile", icon: "bi-person-circle", label: "โปรไฟล์", section: "ตั้งค่าบัญชี" },
] as const;

export default function MapDrawPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();

  // Toggle body class for full-screen layout
  useEffect(() => {
    document.body.classList.add("map-draw-active");
    return () => document.body.classList.remove("map-draw-active");
  }, []);

  // Map refs / state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mapLoadedRef = useRef(false);

  // Draw state
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  const vertsRef = useRef<LngLat[]>([]);
  const finalGJRef = useRef<GeoJSON.Feature | null>(null);
  const [drawDone, setDrawDone] = useState(false);
  const [drawPreview, setDrawPreview] = useState("—");

  // Step + tab + UI
  const [step, setStep] = useState<Step>(1);
  const [tab, setTab] = useState<Tab>("draw");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [basemap, setBasemap] = useState<"sat" | "street" | "topo">("sat");
  const [panelOpen, setPanelOpen] = useState(true);
  const [status, setStatus] = useState("🌍 แผนที่ลูกโลก — กด \"เริ่มวาดแปลง\" เพื่อบินไปยังประเทศไทย");

  // Form
  const [pd, setPd] = useState<PlotData>({
    name: "",
    ownerName: user?.fullname ?? "",
    province: "",
    plantYearInput: "",
    variety: "",
    areaSqm: 0,
    areaRai: 0,
    treeCount: 0,
    plantYear: 0,
    treeAge: 0,
    H: 0,
    D: 0,
    bio: 0,
    co2: 0,
  });
  useEffect(() => {
    if (user?.fullname && !pd.ownerName) {
      setPd((p) => ({ ...p, ownerName: user.fullname }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // SHP state
  const [shpFile, setShpFile] = useState<File | null>(null);
  const [shpStatus, setShpStatus] = useState<{ msg: string; ok?: boolean } | null>(null);

  // Parcel DB search state (auto-runs ST_Intersects after geometry is set)
  const [hasGeom, setHasGeom] = useState(false);
  const [searchRunning, setSearchRunning] = useState(false);
  const [searchCount, setSearchCount] = useState<number | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [parcelFeatures, setParcelFeatures] = useState<GeoJSON.Feature[]>([]);
  const [tableOpen, setTableOpen] = useState(false);
  const [ndviMap, setNdviMap] = useState<Record<number, NdviStatus>>({});
  const [ndviFetching, setNdviFetching] = useState(false);
  const [ndviProgress, setNdviProgress] = useState({ done: 0, total: 0 });

  // Age detection state
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState("กำลังวิเคราะห์ข้อมูลดาวเทียม...");
  const [ageResult, setAgeResult] = useState<{ year: number; age: number; dist: Record<string, number> } | null>(null);
  const yearChartRef = useRef<Chart | null>(null);
  const yearCanvasRef = useRef<HTMLCanvasElement>(null);

  // Carbon
  const [carbonComputing, setCarbonComputing] = useState(false);
  const [carbonReady, setCarbonReady] = useState(false);
  const carbonChartRef = useRef<Chart | null>(null);
  const carbonCanvasRef = useRef<HTMLCanvasElement>(null);

  // Forecast
  const [fcYears, setFcYears] = useState(10);
  const [fcTable, setFcTable] = useState<{ years: number; co2: number }[]>([]);
  const fcChartRef = useRef<Chart | null>(null);
  const fcCanvasRef = useRef<HTMLCanvasElement>(null);

  // Search
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<{ display_name: string; lon: string; lat: string }[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // ===== MAP INIT =====
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          sat: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            attribution: "",
          },
          street: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "",
          },
          topo: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            attribution: "",
          },
        },
        layers: [
          { id: "sat", type: "raster", source: "sat", layout: { visibility: "visible" } },
          { id: "street", type: "raster", source: "street", layout: { visibility: "none" } },
          { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
        ],
      },
      center: [101.258, 15],
      zoom: 1.8,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "bottom-right",
    );

    map.on("load", () => {
      try {
        (map as unknown as { setProjection?: (p: { type: string }) => void }).setProjection?.({ type: "globe" });
      } catch { }
      mapLoadedRef.current = true;

      map.addSource("draw-line", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "draw-line-l",
        type: "line",
        source: "draw-line",
        paint: { "line-color": "#2d9e5f", "line-width": 2, "line-dasharray": [3, 2] },
      });
      map.addSource("draw-fill", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "draw-fill-l",
        type: "fill",
        source: "draw-fill",
        paint: { "fill-color": "#2d9e5f", "fill-opacity": 0.12 },
      });
      map.addSource("draw-verts", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "draw-verts-l",
        type: "circle",
        source: "draw-verts",
        paint: {
          "circle-color": "#2d9e5f",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 14, 6],
          "circle-stroke-color": "rgba(255,255,255,0.95)",
          "circle-stroke-width": 2,
        },
      });
      map.addSource("plot", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "plot-fill",
        type: "fill",
        source: "plot",
        paint: { "fill-color": "#2d9e5f", "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "plot-line",
        type: "line",
        source: "plot",
        paint: { "line-color": "#2d9e5f", "line-width": 2.5 },
      });

      map.addSource("matched-parcels", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "matched-parcels-fill",
        type: "fill",
        source: "matched-parcels",
        paint: { "fill-color": "#ff9100", "fill-opacity": 0.5 },
      });
      map.addLayer({
        id: "matched-parcels-line",
        type: "line",
        source: "matched-parcels",
        paint: { "line-color": "#ff6a00", "line-width": 2.4 },
      });

      const fmt = (v: unknown) => (v == null || v === "" ? "—" : String(v));
      map.on("click", "matched-parcels-fill", (e) => {
        if (drawingRef.current) return;
        if (!e.features?.length) return;
        const p = (e.features[0].properties ?? {}) as Record<string, unknown>;
        const html = `
          <div style="font-family:var(--font,inherit); font-size:12px; line-height:1.55; color:#222; min-width:200px;">
            <div style="font-weight:700; font-size:13px; margin-bottom:5px; color:#1e7a47;">${fmt(p.farm_name)}</div>
            <div><b>เลขประจำตัว:</b> ${fmt(p.farm_idc)}</div>
            <div><b>เลขคำขอ:</b> ${fmt(p.app_no)} (แปลงที่ ${fmt(p.land_seq)})</div>
            <div><b>หมู่ ${fmt(p.land_moo)}</b> ต.${fmt(p.tambon)} อ.${fmt(p.amphur)} จ.${fmt(p.province)}</div>
            <div><b>ปีปลูก:</b> ${fmt(p.grow_year)} · <b>อายุ:</b> ${fmt(p.rubber_age)} ปี</div>
            <div><b>พื้นที่:</b> ${fmt(p.grow_area)}</div>
            <div><b>ประเภท:</b> ${fmt(p.rip_type)}</div>
          </div>`;
        new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      });
      map.on("mouseenter", "matched-parcels-fill", () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "matched-parcels-fill", () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
  }, []);

  // ===== DRAW HELPERS =====
  const previewDraw = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const verts = vertsRef.current;
    const lineSrc = map.getSource("draw-line") as maplibregl.GeoJSONSource | undefined;
    const fillSrc = map.getSource("draw-fill") as maplibregl.GeoJSONSource | undefined;
    const vertsSrc = map.getSource("draw-verts") as maplibregl.GeoJSONSource | undefined;
    if (!lineSrc || !fillSrc || !vertsSrc) return;
    if (verts.length) {
      vertsSrc.setData({
        type: "FeatureCollection",
        features: verts.map((v) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: v },
          properties: {},
        })),
      });
    } else {
      vertsSrc.setData(emptyFC());
    }
    if (verts.length < 2) {
      lineSrc.setData(emptyFC());
      fillSrc.setData(emptyFC());
      return;
    }
    const line = [...verts, verts.length >= 3 ? verts[0] : verts[verts.length - 1]];
    lineSrc.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line },
      properties: {},
    });
    if (verts.length >= 3) {
      fillSrc.setData({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...verts, verts[0]]] },
        properties: {},
      });
    }
  }, []);

  const fitPlot = useCallback(() => {
    const map = mapRef.current;
    const final = finalGJRef.current;
    if (!map || !final || final.geometry.type !== "Polygon") return;
    const c = final.geometry.coordinates[0] as LngLat[];
    const lngs = c.map((p) => p[0]);
    const lats = c.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: { top: 80, bottom: 80, left: isMobile() ? 80 : 400, right: 80 },
        duration: 900,
        pitch: 18,
      },
    );
  }, []);

  const updateAreaFromFeat = useCallback((feat: GeoJSON.Feature) => {
    const coords =
      feat.geometry.type === "MultiPolygon"
        ? (feat.geometry.coordinates[0][0] as LngLat[])
        : feat.geometry.type === "Polygon"
          ? (feat.geometry.coordinates[0] as LngLat[])
          : [];
    const sqm = polygonAreaM2(coords);
    const rai = sqm / 1600;
    setPd((p) => ({
      ...p,
      areaSqm: sqm,
      areaRai: rai,
      treeCount: Math.round(rai * 80),
    }));
  }, []);

  const finishDraw = useCallback(() => {
    const verts = vertsRef.current;
    if (verts.length < 3) return;
    drawingRef.current = false;
    setDrawing(false);
    const ring = [...verts, verts[0]];
    const final: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {},
    };
    finalGJRef.current = final;
    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      (map.getSource("plot") as maplibregl.GeoJSONSource).setData(final);
      (map.getSource("draw-line") as maplibregl.GeoJSONSource).setData(emptyFC());
      (map.getSource("draw-fill") as maplibregl.GeoJSONSource).setData(emptyFC());
    }
    const sqm = polygonAreaM2(ring);
    const rai = sqm / 1600;
    setDrawPreview(`${rai.toFixed(2)} ไร่ · ${verts.length} จุด`);
    setDrawDone(true);
    setHasGeom(true);
    setStatus(`✓ วาดแปลงเสร็จ: ${rai.toFixed(2)} ไร่ — กด "ยืนยันแปลง"`);
    fitPlot();
  }, [fitPlot]);

  // Map click / dblclick / Escape handlers — keep refs in sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!drawingRef.current) return;
      vertsRef.current.push([e.lngLat.lng, e.lngLat.lat]);
      previewDraw();
      setStatus(`จุดที่ ${vertsRef.current.length} — Double-click เพื่อปิดแปลง`);
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      if (!drawingRef.current || vertsRef.current.length < 3) return;
      e.preventDefault();
      finishDraw();
    };
    map.on("click", onClick);
    map.on("dblclick", onDbl);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
    };
  }, [previewDraw, finishDraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawingRef.current) {
        drawingRef.current = false;
        setDrawing(false);
        setStatus("ยกเลิกการวาด");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const startDrawFlow = () => {
    const map = mapRef.current;
    if (!map) return;
    drawingRef.current = true;
    setDrawing(true);
    setStatus("โหมดวาด — คลิกเพื่อเพิ่มจุด | Double-click เพื่อปิดแปลง | Esc ยกเลิก");
    if (map.getZoom() < 8) {
      map.flyTo({ center: [101.258, 12.682], zoom: 10, pitch: 20, bearing: 0, duration: 2000 });
    }
  };

  const clearDraw = () => {
    vertsRef.current = [];
    finalGJRef.current = null;
    drawingRef.current = false;
    setDrawing(false);
    setDrawDone(false);
    setDrawPreview("—");
    setHasGeom(false);
    setSearchCount(null);
    setSearchErr(null);
    setSearchTruncated(false);
    setParcelFeatures([]);
    setTableOpen(false);
    setNdviMap({});
    setNdviFetching(false);
    setNdviProgress({ done: 0, total: 0 });
    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      (map.getSource("draw-line") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("draw-fill") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("draw-verts") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("plot") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("matched-parcels") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
    }
    setStatus("ล้างแปลงเรียบร้อย");
  };

  // ===== PARCEL DB SEARCH =====
  const runParcelSearch = useCallback(async () => {
    const final = finalGJRef.current;
    if (!final?.geometry) {
      setSearchErr("กรุณาวาดแปลงหรืออัปโหลด Shapefile ก่อน");
      return;
    }
    setSearchRunning(true);
    setSearchErr(null);
    setSearchCount(null);
    setSearchTruncated(false);
    try {
      const res = await fetch("/api/parcels/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ geometry: final.geometry, relation: "intersects" }),
      });
      const data: {
        features?: GeoJSON.Feature[];
        count?: number;
        truncated?: boolean;
        error?: string;
      } = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const map = mapRef.current;
      const features = data.features ?? [];
      console.log("[parcel-search]", {
        count: data.count,
        relation: "intersects",
        sample: features[0],
      });
      if (map && mapLoadedRef.current) {
        const src = map.getSource("matched-parcels") as
          | maplibregl.GeoJSONSource
          | undefined;
        src?.setData({ type: "FeatureCollection", features });

        if (features.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          const walk = (coords: unknown): void => {
            if (!Array.isArray(coords)) return;
            if (typeof coords[0] === "number" && typeof coords[1] === "number") {
              const x = coords[0] as number;
              const y = coords[1] as number;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              return;
            }
            for (const c of coords) walk(c);
          };
          features.forEach((f) => walk((f.geometry as { coordinates?: unknown })?.coordinates));
          const finalCoords =
            final.geometry.type === "Polygon"
              ? (final.geometry.coordinates[0] as [number, number][])
              : [];
          finalCoords.forEach(([x, y]) => {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          });
          if (Number.isFinite(minX) && Number.isFinite(minY)) {
            map.fitBounds(
              [
                [minX, minY],
                [maxX, maxY],
              ],
              {
                padding: { top: 80, bottom: 80, left: isMobile() ? 80 : 400, right: 80 },
                duration: 700,
                maxZoom: 16,
              },
            );
          }
        }
      }
      setParcelFeatures(features);
      setTableOpen(features.length > 0);
      setSearchCount(data.count ?? features.length);
      setSearchTruncated(Boolean(data.truncated));
      if ((data.count ?? 0) === 0) {
        setStatus("ไม่พบแปลงในฐานข้อมูลที่ตรงเงื่อนไข");
      } else {
        setStatus(`พบ ${data.count} แปลงในฐานข้อมูล (ตัดกับพื้นที่)`);
      }
    } catch (err) {
      setSearchErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!hasGeom) return;
    runParcelSearch();
  }, [hasGeom, runParcelSearch]);

  const fetchNdviForIndex = useCallback(async (index: number) => {
    const feat = parcelFeatures[index];
    if (!feat?.geometry) return;
    setNdviMap((prev) => ({ ...prev, [index]: "loading" }));
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 90_000);
      try {
        const res = await fetch("/api/ndvi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ geometry: feat.geometry }),
          signal: controller.signal,
        });
        const data = (await res.json()) as { ndvi?: number | null; source?: string; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setNdviMap((prev) => ({ ...prev, [index]: data.ndvi ?? null }));
      } finally {
        clearTimeout(tid);
      }
    } catch {
      setNdviMap((prev) => ({ ...prev, [index]: "error" }));
    }
  }, [parcelFeatures]);

  const fetchAllNdvi = useCallback(async () => {
    if (ndviFetching || parcelFeatures.length === 0) return;
    setNdviFetching(true);
    const MAX = Math.min(parcelFeatures.length, 20);
    setNdviProgress({ done: 0, total: MAX });
    setNdviMap((prev) => {
      const next = { ...prev };
      for (let i = 0; i < MAX; i++) next[i] = "loading";
      return next;
    });
    const CONCURRENCY = 3;
    let done = 0;
    for (let start = 0; start < MAX; start += CONCURRENCY) {
      const chunk = Array.from(
        { length: Math.min(CONCURRENCY, MAX - start) },
        (_, k) => start + k,
      );
      await Promise.all(chunk.map((i) => fetchNdviForIndex(i)));
      done += chunk.length;
      setNdviProgress({ done, total: MAX });
    }
    setNdviFetching(false);
  }, [parcelFeatures, ndviFetching, fetchNdviForIndex]);

  // ===== SHP IMPORT =====
  const onShpSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setShpFile(f);
    setShpStatus({ msg: `✓ เลือกไฟล์: ${f.name}`, ok: true });
  };

  const loadShp = async () => {
    if (!shpFile) return;
    setShpStatus({ msg: "กำลังอ่านไฟล์..." });
    try {
      const zip = await JSZip.loadAsync(shpFile);
      const fns = Object.keys(zip.files);
      const sk = fns.find((f) => f.toLowerCase().endsWith(".shp"));
      const dk = fns.find((f) => f.toLowerCase().endsWith(".dbf"));
      if (!sk) throw new Error("ไม่พบไฟล์ .shp ใน zip");
      const shpBuf = await zip.files[sk].async("arraybuffer");
      const dbfBuf = dk ? await zip.files[dk].async("arraybuffer") : undefined;
      const shapefile = await import("shapefile");
      const src = await shapefile.open(shpBuf, dbfBuf);
      const feats: GeoJSON.Feature[] = [];
      let r;
      while (!(r = await src.read()).done) feats.push(r.value);
      if (!feats.length) throw new Error("ไม่พบ Feature ในไฟล์");
      const poly = feats.find(
        (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
      );
      if (!poly || !poly.geometry) throw new Error("ไม่พบ Polygon");
      const final: GeoJSON.Feature =
        poly.geometry.type === "MultiPolygon"
          ? {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: poly.geometry.coordinates[0] as GeoJSON.Position[][],
            },
            properties: poly.properties ?? {},
          }
          : (poly as GeoJSON.Feature);
      finalGJRef.current = final;
      setHasGeom(true);
      const props = (poly.properties ?? {}) as Record<string, unknown>;
      const nm = (props.PLOT_NAME ?? props.NAME) as string | undefined;
      if (nm) setPd((p) => ({ ...p, name: nm }));
      const map = mapRef.current;
      if (map && mapLoadedRef.current) {
        (map.getSource("plot") as maplibregl.GeoJSONSource).setData(final);
      }
      updateAreaFromFeat(final);
      fitPlot();
      setShpStatus({
        msg: `✓ โหลดสำเร็จ — ${feats.length} feature — สามารถค้นหาแปลงในฐานข้อมูล หรือกด "ดำเนินการต่อ"`,
        ok: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setShpStatus({ msg: "✗ " + msg });
    }
  };

  // ===== STEP NAV =====
  const goStep = (n: Step) => {
    setStep(n);
    if (isMobile()) setPanelOpen(true);
  };

  const goStep3 = () => {
    if (!pd.name.trim()) {
      alert("กรุณากรอกชื่อแปลงยาง");
      return;
    }
    goStep(3);
  };

  const goStep4 = () => {
    goStep(4);
    setCarbonComputing(true);
    setCarbonReady(false);
    setTimeout(() => calcCarbon(), 600);
  };

  const goStep5 = () => {
    goStep(5);
    runForecast(fcYears);
  };

  // ===== AGE DETECTION (mock) =====
  const detectAge = () => {
    setAnalyzing(true);
    setAgeResult(null);
    const msgs = ["วิเคราะห์ NDVI/EVI...", "ประมวลผลดาวเทียม...", "ประมาณอายุพืช..."];
    let mi = 0;
    const iv = setInterval(() => {
      if (mi < msgs.length) setAnalyzeMsg(msgs[mi++]);
    }, 700);
    setTimeout(() => {
      clearInterval(iv);
      setAnalyzing(false);
      const cur = new Date().getFullYear() + 543;
      const main = cur - Math.floor(Math.random() * 14 + 6);
      const dist: Record<string, number> = {};
      [-3, -2, -1, 0, 0, 0, 1, 2, 3].forEach((o) => {
        const y = main + o;
        if (y > 2530 && y <= cur) dist[y] = (dist[y] || 0) + Math.random() * 14 + (o === 0 ? 36 : 5);
      });
      const tot = Object.values(dist).reduce((a, b) => a + b, 0);
      Object.keys(dist).forEach((k) => (dist[k] = +((dist[k] / tot) * 100).toFixed(1)));
      const age = cur - main;
      setPd((p) => ({ ...p, plantYear: main, treeAge: age }));
      setAgeResult({ year: main, age, dist });
    }, 3000);
  };

  // Render year chart when ageResult arrives
  useEffect(() => {
    if (!ageResult || !yearCanvasRef.current) return;
    yearChartRef.current?.destroy();
    const ctx = yearCanvasRef.current.getContext("2d") as ChartItem;
    const labs = Object.keys(ageResult.dist).sort();
    yearChartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labs,
        datasets: [
          {
            data: labs.map((k) => ageResult.dist[k]),
            backgroundColor: labs.map((y) =>
              +y === ageResult.year ? "rgba(132,169,140,0.85)" : "rgba(132,169,140,0.28)",
            ),
            borderRadius: 4,
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: "rgba(200,220,210,0.5)", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
          y: {
            ticks: { color: "rgba(200,220,210,0.5)", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
        },
      },
    });
    return () => {
      yearChartRef.current?.destroy();
      yearChartRef.current = null;
    };
  }, [ageResult]);

  // ===== CARBON =====
  const calcCarbon = () => {
    const { H, D, AGB, BGB, co2 } = carbonForAge(pd.treeAge, pd.treeCount);
    const bio = +(AGB * 1000).toFixed(0);
    setPd((p) => ({ ...p, H, D, bio, co2 }));
    setCarbonComputing(false);
    setCarbonReady(true);

    setTimeout(() => {
      if (!carbonCanvasRef.current) return;
      carbonChartRef.current?.destroy();
      const ctx = carbonCanvasRef.current.getContext("2d") as ChartItem;
      const trees = pd.treeCount;
      carbonChartRef.current = new Chart(ctx, {
        type: "bar",
        data: {
          labels: ["AGB", "BGB", "CO₂ eq."],
          datasets: [
            {
              data: [
                +(AGB * trees * 0.47 * 3.67).toFixed(2),
                +(BGB * trees * 0.47 * 3.67).toFixed(2),
                +co2.toFixed(2),
              ],
              backgroundColor: [
                "rgba(132,169,140,0.75)",
                "rgba(82,121,111,0.7)",
                "rgba(168,201,177,0.7)",
              ],
              borderRadius: 5,
              borderWidth: 0,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: "rgba(200,220,210,0.5)", font: { size: 9 } },
              grid: { color: "rgba(255,255,255,0.04)" },
            },
            y: {
              ticks: { color: "rgba(200,220,210,0.65)", font: { size: 10 } },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      });
    }, 50);
  };

  // ===== FORECAST =====
  const runForecast = (years: number) => {
    const yrs = Math.max(1, Math.min(50, years || 10));
    const base = pd.treeAge;
    const trees = pd.treeCount;
    const labs: string[] = [];
    const vals: number[] = [];
    for (let y = 0; y <= yrs; y++) {
      const a = base + y;
      const { co2 } = carbonForAge(a, trees);
      vals.push(+co2.toFixed(2));
      labs.push(`+${y}ปี`);
    }

    setTimeout(() => {
      if (!fcCanvasRef.current) return;
      fcChartRef.current?.destroy();
      const ctx = fcCanvasRef.current.getContext("2d") as ChartItem;
      fcChartRef.current = new Chart(ctx, {
        type: "line",
        data: {
          labels: labs,
          datasets: [
            {
              data: vals,
              borderColor: "rgba(132,169,140,0.85)",
              backgroundColor: "rgba(132,169,140,0.08)",
              borderWidth: 2.2,
              pointRadius: 1.5,
              fill: true,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: "rgba(200,220,210,0.4)", font: { size: 8.5 }, maxTicksLimit: 9 },
              grid: { color: "rgba(255,255,255,0.04)" },
            },
            y: {
              ticks: { color: "rgba(200,220,210,0.4)", font: { size: 9 } },
              grid: { color: "rgba(255,255,255,0.04)" },
            },
          },
        },
      });
    }, 50);

    const milestones = [1, 5, 10, 20, 30].filter((m) => m <= yrs);
    setFcTable(milestones.map((m) => ({ years: m, co2: vals[m] })));
  };

  // ===== SAVE =====
  const savePlot = () => {
    const final = finalGJRef.current;
    if (!user || !final) return;
    const plot = {
      id: Date.now().toString(),
      name: pd.name || "แปลงไม่มีชื่อ",
      ownerName: pd.ownerName,
      userId: user.id,
      areaRai: pd.areaRai,
      areaSqm: pd.areaSqm,
      treeCount: pd.treeCount,
      plantYear: pd.plantYear,
      treeAge: pd.treeAge,
      treeHeight: pd.H,
      dbh: pd.D,
      biomassPerTree: pd.bio,
      carbonTotal: pd.co2,
      geojson: final,
      createdAt: new Date().toISOString(),
    };
    PlotDB.savePlot(user.id, plot);
    setToast(`บันทึก "${plot.name}" เรียบร้อย!`);
    setTimeout(() => setToast(null), 2200);
    setTimeout(() => router.push("/my-plots"), 2000);
  };

  // ===== BASEMAP SWITCH =====
  const switchBasemap = (mode: "sat" | "street" | "topo") => {
    setBasemap(mode);
    const map = mapRef.current;
    if (!map) return;
    (["sat", "street", "topo"] as const).forEach((m) => {
      if (map.getLayer(m)) {
        map.setLayoutProperty(m, "visibility", m === mode ? "visible" : "none");
      }
    });
  };

  // ===== SEARCH =====
  const searchLocation = async () => {
    const q = searchValue.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=th&limit=5&q=${encodeURIComponent(q)}`,
      );
      const data = (await res.json()) as { display_name: string; lon: string; lat: string }[];
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    }
    setSearchLoading(false);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") searchLocation();
  };

  const pickSearchResult = (item: { display_name: string; lon: string; lat: string }) => {
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        center: [parseFloat(item.lon), parseFloat(item.lat)],
        zoom: 12,
        pitch: 0,
        duration: 2500,
      });
    }
    setSearchValue(item.display_name);
    setSearchResults(null);
  };

  // ===== Outside-click close (sidebar + search) =====
  useEffect(() => {
    if (!sidebarOpen && !searchResults) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const sidebar = document.getElementById("md-sidebar-menu");
      const sidebarBtn = document.getElementById("md-sidebar-btn");
      if (
        sidebarOpen &&
        sidebar &&
        !sidebar.contains(target) &&
        sidebarBtn &&
        !sidebarBtn.contains(target)
      ) {
        setSidebarOpen(false);
      }
      const sc = document.getElementById("search-container");
      if (searchResults && sc && !sc.contains(target)) setSearchResults(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [sidebarOpen, searchResults]);

  const togglePanel = () => setPanelOpen((v) => !v);
  const onLogout = () => {
    logout();
    router.push("/");
  };

  const stepBar = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((i) => {
        const status = i < step ? "done" : i === step ? "current" : "";
        return (
          <div key={i} className={`step-item ${status}`} id={`si-${i}`}>
            <div className={`step-dot ${status}`} id={`sd-${i}`}>
              {i < step ? <i className="bi bi-check" style={{ fontSize: 9 }}></i> : i}
            </div>
            <div className="step-lbl">{STEP_LABELS[i - 1]}</div>
          </div>
        );
      }),
    [step],
  );

  return (
    <div className={`md-shell${drawing ? " drawing" : ""}${panelOpen ? " panel-open" : ""}`}>
      <div id="map" ref={mapContainerRef} />

      {/* Search */}
      <div id="search-container">
        <div id="search-box">
          <input
            type="text"
            id="loc-search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="ค้นหา จังหวัด, อำเภอ, ตำบล..."
          />
          <button id="search-btn" onClick={searchLocation} disabled={searchLoading} title="ค้นหา">
            {searchLoading ? (
              <div className="spinner-border spinner-border-sm text-success" role="status" />
            ) : (
              <i className="bi bi-search"></i>
            )}
          </button>
        </div>
        <div id="search-results" style={{ display: searchResults ? "block" : "none" }}>
          {searchResults?.length === 0 && (
            <div
              className="search-item"
              style={{ textAlign: "center", color: "rgba(220,53,69,0.8)" }}
            >
              ไม่พบสถานที่ที่ค้นหา
            </div>
          )}
          {searchResults?.map((item, i) => (
            <div key={i} className="search-item" onClick={() => pickSearchResult(item)}>
              <i className="bi bi-geo-alt me-2" style={{ color: "var(--green)" }}></i>
              {item.display_name}
            </div>
          ))}
        </div>
      </div>

      {/* Basemap card */}
      <div id="basemap-card" className={basemapOpen ? "open" : ""}>
        <div className="basemap-header">
          <span>
            <i className="bi bi-map" style={{ marginRight: 8 }}></i>แผนที่ (Basemap)
          </span>
          <i
            className="bi bi-x"
            style={{ cursor: "pointer", fontSize: 18 }}
            onClick={() => setBasemapOpen(false)}
          ></i>
        </div>
        <div
          className={`basemap-option${basemap === "sat" ? " active" : ""}`}
          onClick={() => switchBasemap("sat")}
        >
          <i className="bi bi-globe-asia-australia"></i> แผนที่ดาวเทียม
        </div>
        <div
          className={`basemap-option${basemap === "street" ? " active" : ""}`}
          onClick={() => switchBasemap("street")}
        >
          <i className="bi bi-map"></i> แผนที่ถนน (Street)
        </div>
        <div
          className={`basemap-option${basemap === "topo" ? " active" : ""}`}
          onClick={() => switchBasemap("topo")}
        >
          <i className="bi bi-tree"></i> ภูมิประเทศ (Terrain)
        </div>
      </div>

      {/* Floating "open panel" button */}
      <button id="btn-open-panel" onClick={togglePanel} title="กรอกข้อมูลแปลง">
        <i className="bi bi-pencil-square"></i>
      </button>

      {/* Side panel */}
      <div id="panel" className={panelOpen ? "open" : ""}>
        <button id="btn-close-panel" onClick={togglePanel}>
          ✕
        </button>
        <div className="panel-handle" onClick={togglePanel}>
          <div className="panel-handle-bar"></div>
        </div>
        <div className="panel-collapsed-row" onClick={togglePanel}>
          <span className="panel-collapsed-title">🌿 วาดแปลงยาง</span>
          <span className="panel-collapsed-step">ขั้น {step}/5</span>
          <div className="panel-toggle-btn">
            <i className={`bi ${panelOpen ? "bi-chevron-down" : "bi-chevron-up"}`}></i>
          </div>
        </div>

        <div className="steps-bar">{stepBar}</div>

        <div className="panel-inner">
          {/* Step 1 */}
          <div className={`pstep${step === 1 ? " active" : ""}`}>
            <div className="step-title">
              <div className="step-tag">
                <i className="bi bi-map"></i> ขั้นตอนที่ 1 / 5
              </div>
              <h2>กำหนดขอบเขตแปลง</h2>
              <p>วาดแปลงบนแผนที่ หรือนำเข้าไฟล์ Shapefile</p>
            </div>

            <div className="tabs">
              <button
                className={`tab${tab === "draw" ? " active" : ""}`}
                onClick={() => setTab("draw")}
              >
                <i className="bi bi-pencil-square"></i>วาดแปลง
              </button>
              <button
                className={`tab${tab === "shp" ? " active" : ""}`}
                onClick={() => setTab("shp")}
              >
                <i className="bi bi-file-earmark-zip"></i>นำเข้า SHP
              </button>
            </div>

            {tab === "draw" && (
              <div>
                <div className={`draw-done${drawDone ? " show" : ""}`}>
                  <i className="bi bi-check-circle-fill"></i>
                  <div className="draw-done-text">
                    <strong>วาดแปลงเรียบร้อย ✓</strong>
                    <span>{drawPreview}</span>
                  </div>
                </div>

                <button className="btn btn-primary" onClick={drawing ? clearDraw : startDrawFlow}>
                  <i className={`bi ${drawing ? "bi-stop-circle" : "bi-pencil"} me-1`}></i>{" "}
                  {drawing ? "หยุดวาด" : "เริ่มวาดแปลง"}
                </button>
                <button className="btn btn-outline" onClick={clearDraw}>
                  <i className="bi bi-trash me-1"></i> ล้างแปลง
                </button>
              </div>
            )}

            {tab === "shp" && (
              <div>
                <div className="req-box">
                  <div className="req-title">ข้อกำหนดไฟล์</div>
                  <div className="req-item">
                    <i className="bi bi-file-zip"></i> ไฟล์ .zip ที่มี .shp .shx .dbf
                  </div>
                  <div className="req-item">
                    <i className="bi bi-globe2"></i> ระบบพิกัด WGS84 (EPSG:4326)
                  </div>
                  <div className="req-item">
                    <i className="bi bi-table"></i> คอลัมน์ PLOT_NAME ในไฟล์ .dbf
                  </div>
                </div>
                <div className="field">
                  <label>เลือกไฟล์ ZIP</label>
                  <input type="file" accept=".zip" onChange={onShpSelected} />
                </div>
                {shpStatus && (
                  <div
                    style={{
                      color: shpStatus.ok ? "var(--green)" : "rgba(255,100,110,0.7)",
                      fontSize: 12,
                      margin: "8px 0",
                    }}
                  >
                    {shpStatus.msg}
                  </div>
                )}
                <button className="btn btn-primary" onClick={loadShp} disabled={!shpFile}>
                  <i className="bi bi-upload me-1"></i> โหลดและแสดงบนแผนที่
                </button>
              </div>
            )}

            {(searchRunning || searchErr || searchCount !== null) && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed rgba(45,158,95,0.15)" }}>
                {/* Header row */}
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}
                >
                  <div className="info-box-title" style={{ margin: 0 }}>
                    <i className="bi bi-table" style={{ marginRight: 6 }}></i>
                    ผลการค้นหาแปลงในฐานข้อมูล
                  </div>
                  {!searchRunning && !searchErr && parcelFeatures.length > 0 && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {tableOpen && (
                        <button
                          onClick={fetchAllNdvi}
                          disabled={ndviFetching}
                          title="ดึง NDVI จาก Google Earth Engine (สูงสุด 20 แปลงแรก, 3 แปลงพร้อมกัน)"
                          style={{
                            background: ndviFetching ? "rgba(45,158,95,0.06)" : "rgba(45,158,95,0.12)",
                            border: "1px solid rgba(45,158,95,0.25)",
                            borderRadius: 6, padding: "3px 8px",
                            cursor: ndviFetching ? "not-allowed" : "pointer",
                            color: "var(--kc-green-d, #1e7a47)", fontSize: 10, fontWeight: 700,
                            display: "flex", alignItems: "center", gap: 4,
                          }}
                        >
                          {ndviFetching
                            ? <><span className="spinner-border spinner-border-sm" style={{ width: 10, height: 10 }} /> ดึง NDVI {ndviProgress.done}/{ndviProgress.total}...</>
                            : <><i className="bi bi-globe2" /> ดึง NDVI (GEE)</>}
                        </button>
                      )}
                      <button
                        onClick={() => setTableOpen((v) => !v)}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          color: "var(--kc-green-d, #1e7a47)", fontSize: 11, fontWeight: 700,
                          display: "flex", alignItems: "center", gap: 4, padding: "2px 6px",
                        }}
                      >
                        {tableOpen ? "ซ่อน" : "แสดงตาราง"}
                        <i className={`bi bi-chevron-${tableOpen ? "up" : "down"}`} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Loading */}
                {searchRunning && (
                  <div style={{ fontSize: 12, color: "var(--text-mid)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="spinner-border spinner-border-sm" role="status" />
                    กำลังค้นหาแปลงที่ทับซ้อน...
                  </div>
                )}

                {/* Error */}
                {!searchRunning && searchErr && (
                  <div style={{ fontSize: 12, color: "rgba(255,100,110,0.85)" }}>✗ {searchErr}</div>
                )}

                {/* Summary badge */}
                {!searchRunning && !searchErr && searchCount !== null && (
                  <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: parcelFeatures.length > 0 ? 8 : 0, color: searchCount > 0 ? "var(--green)" : "var(--text-dim)" }}>
                    {searchCount > 0 ? (
                      <>
                        ✓ พบ <strong>{searchCount.toLocaleString()}</strong> แปลงที่ทับซ้อนกับขอบเขต
                        {searchTruncated && (
                          <span style={{ color: "rgba(255,193,7,0.8)" }}> (แสดงไม่เกิน 2,000 แปลง)</span>
                        )}
                      </>
                    ) : (
                      <>ไม่พบแปลงที่ทับซ้อนกับขอบเขต</>
                    )}
                  </div>
                )}

                {/* Results table */}
                {!searchRunning && !searchErr && tableOpen && parcelFeatures.length > 0 && (
                  <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid rgba(45,158,95,0.18)", marginTop: 4 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: "rgba(45,158,95,0.10)" }}>
                          {["ชื่อ", "เลขทะเบียน", "อำเภอ", "จังหวัด", "ปีปลูก", "อายุ", "พื้นที่"].map((h) => (
                            <th key={h} style={{
                              padding: "7px 8px", textAlign: "left", fontWeight: 700,
                              color: "var(--kc-green-d, #1e7a47)", whiteSpace: "nowrap",
                              borderBottom: "1px solid rgba(45,158,95,0.15)",
                            }}>{h}</th>
                          ))}
                          <th style={{
                            padding: "7px 8px", textAlign: "left", fontWeight: 700,
                            color: "var(--kc-green-d, #1e7a47)", whiteSpace: "nowrap",
                            borderBottom: "1px solid rgba(45,158,95,0.15)",
                          }}>
                            <span title="Normalized Difference Vegetation Index — Google Earth Engine Sentinel-2/Landsat-9">
                              NDVI <i className="bi bi-globe2" style={{ fontSize: 9, opacity: 0.7 }} />
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {parcelFeatures.slice(0, 200).map((feat, i) => {
                          const p = (feat.properties ?? {}) as Record<string, unknown>;
                          const fmt = (v: unknown) => (v == null || v === "" ? "—" : String(v));
                          const flyTo = () => {
                            const map = mapRef.current;
                            if (!map || !feat.geometry) return;
                            const coords = feat.geometry.type === "Polygon"
                              ? (feat.geometry as GeoJSON.Polygon).coordinates[0]
                              : feat.geometry.type === "MultiPolygon"
                                ? (feat.geometry as GeoJSON.MultiPolygon).coordinates[0][0]
                                : null;
                            if (!coords?.length) return;
                            const lngs = coords.map(([x]) => x);
                            const lats = coords.map(([, y]) => y);
                            map.fitBounds(
                              [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                              { padding: 80, duration: 600, maxZoom: 18 },
                            );
                          };
                          return (
                            <tr
                              key={i}
                              onClick={flyTo}
                              style={{
                                cursor: "pointer",
                                borderBottom: "1px solid rgba(45,158,95,0.08)",
                                background: i % 2 === 0 ? "transparent" : "rgba(45,158,95,0.03)",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(45,158,95,0.10)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(45,158,95,0.03)")}
                            >
                              <td style={{ padding: "6px 8px", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fmt(p.farm_name)}>{fmt(p.farm_name)}</td>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.farm_idc)}</td>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.amphur)}</td>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.province)}</td>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.grow_year)}</td>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.rubber_age)}</td>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(p.grow_area)}</td>
                              <td
                                style={{ padding: "6px 8px", whiteSpace: "nowrap", textAlign: "center" }}
                                onClick={(e) => { e.stopPropagation(); if (ndviMap[i] !== "loading") fetchNdviForIndex(i); }}
                                title={ndviMap[i] === undefined ? "คลิกเพื่อดึง NDVI จาก Google Earth Engine" : undefined}
                              >
                                {ndviMap[i] === undefined && (
                                  <span style={{ cursor: "pointer", color: "rgba(45,158,95,0.55)", fontSize: 10, textDecoration: "underline dotted" }}>ดึง</span>
                                )}
                                {ndviMap[i] === "loading" && (
                                  <span className="spinner-border spinner-border-sm" style={{ width: 10, height: 10 }} />
                                )}
                                {ndviMap[i] === "error" && (
                                  <span style={{ color: "rgba(220,53,69,0.8)", fontSize: 10, cursor: "pointer" }} title="เกิดข้อผิดพลาด — คลิกลองใหม่">✗</span>
                                )}
                                {ndviMap[i] === null && (
                                  <span style={{ color: "var(--text-dim)", fontSize: 10 }}>N/A</span>
                                )}
                                {typeof ndviMap[i] === "number" && (
                                  <span style={{
                                    fontWeight: 700, fontSize: 11,
                                    color: (ndviMap[i] as number) < 0.1 ? "#c0392b"
                                      : (ndviMap[i] as number) < 0.3 ? "#e67e22"
                                        : (ndviMap[i] as number) < 0.5 ? "#d4ac0d"
                                          : "#2d9e5f",
                                  }}>
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
              </div>
            )}
          </div>

          {/* Step 2 */}
          <div className={`pstep${step === 2 ? " active" : ""}`}>
            <div className="step-title">
              <div className="step-tag">
                <i className="bi bi-pencil-square"></i> ขั้นตอนที่ 2 / 5
              </div>
              <h2>ข้อมูลแปลงยาง</h2>
              <p>กรอกข้อมูลแปลงเพื่อระบุตัวตนและคำนวณคาร์บอน</p>
            </div>

            <div
              style={{
                background: "linear-gradient(135deg,rgba(45,158,95,0.1),rgba(30,122,71,0.06))",
                border: "1px solid rgba(45,158,95,0.25)",
                borderRadius: 12,
                padding: "14px 16px",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  background: "linear-gradient(135deg,#2d9e5f,#1e7a47)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <i className="bi bi-map-fill" style={{ color: "#fff", fontSize: 16 }}></i>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    marginBottom: 2,
                  }}
                >
                  พื้นที่แปลง
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>
                    {pd.areaRai > 0 ? pd.areaRai.toFixed(2) : "—"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>ไร่</span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  <i
                    className="bi bi-tag"
                    style={{ marginRight: 4, color: "var(--green)" }}
                  ></i>
                  ชื่อแปลงยาง <span style={{ color: "#e05" }}>*</span>
                </label>
                <input
                  type="text"
                  value={pd.name}
                  onChange={(e) => setPd((p) => ({ ...p, name: e.target.value }))}
                  placeholder="เช่น แปลงยางหลัก 1"
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  <i
                    className="bi bi-person"
                    style={{ marginRight: 4, color: "var(--green)" }}
                  ></i>
                  เจ้าของแปลง
                </label>
                <input
                  type="text"
                  value={pd.ownerName}
                  onChange={(e) => setPd((p) => ({ ...p, ownerName: e.target.value }))}
                  readOnly
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  <i
                    className="bi bi-geo-alt"
                    style={{ marginRight: 4, color: "var(--green)" }}
                  ></i>
                  จังหวัด
                </label>
                <select
                  value={pd.province}
                  onChange={(e) => setPd((p) => ({ ...p, province: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "10px 13px",
                    background: "rgba(255,255,255,0.055)",
                    border: "1px solid rgba(255,255,255,0.11)",
                    borderRadius: 9,
                    color: "var(--text)",
                    fontSize: 13.5,
                    fontFamily: "var(--font)",
                    outline: "none",
                  }}
                >
                  <option value="">-- เลือกจังหวัด --</option>
                  {PROVINCES.map((pv) => (
                    <option key={pv}>{pv}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  <i
                    className="bi bi-calendar3"
                    style={{ marginRight: 4, color: "var(--green)" }}
                  ></i>
                  ปีที่ปลูก (พ.ศ.)
                </label>
                <input
                  type="number"
                  value={pd.plantYearInput}
                  onChange={(e) => setPd((p) => ({ ...p, plantYearInput: e.target.value }))}
                  placeholder="เช่น 2558"
                  min={2500}
                  max={2570}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  <i
                    className="bi bi-tree"
                    style={{ marginRight: 4, color: "var(--green)" }}
                  ></i>
                  พันธุ์ยาง
                </label>
                <select
                  value={pd.variety}
                  onChange={(e) => setPd((p) => ({ ...p, variety: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "10px 13px",
                    background: "rgba(255,255,255,0.055)",
                    border: "1px solid rgba(255,255,255,0.11)",
                    borderRadius: 9,
                    color: "var(--text)",
                    fontSize: 13.5,
                    fontFamily: "var(--font)",
                    outline: "none",
                  }}
                >
                  <option value="">-- เลือกพันธุ์ --</option>
                  {VARIETIES.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <button className="btn btn-primary" onClick={goStep3}>
              <i className="bi bi-arrow-right-circle me-1"></i> ถัดไป: ตรวจจับอายุต้นยาง
            </button>
            <button className="btn btn-outline" onClick={() => goStep(1)}>
              <i className="bi bi-arrow-left me-1"></i> กลับ
            </button>
          </div>

          {/* Step 3 */}
          <div className={`pstep${step === 3 ? " active" : ""}`}>
            <div className="step-title">
              <div className="step-tag">
                <i className="bi bi-cpu"></i> ขั้นตอนที่ 3 / 5
              </div>
              <h2>ตรวจจับอายุต้นยาง</h2>
              <p>วิเคราะห์ดาวเทียมเพื่อประมาณปีปลูกและอายุต้นยาง</p>
            </div>

            {analyzing && (
              <div className="analyzing show">
                <div className="spin"></div>
                <p>{analyzeMsg}</p>
              </div>
            )}

            {!analyzing && !ageResult && (
              <div>
                <button className="btn btn-primary" onClick={detectAge}>
                  <i className="bi bi-cpu me-1"></i> เริ่มตรวจจับอายุต้นยาง
                </button>
                <button className="btn btn-outline" onClick={() => goStep(2)}>
                  <i className="bi bi-arrow-left me-1"></i> กลับ
                </button>
              </div>
            )}

            {!analyzing && ageResult && (
              <div>
                <div className="chart-box">
                  <div className="chart-box-title">การกระจายปีปลูก (%)</div>
                  <canvas ref={yearCanvasRef} height={150} />
                </div>
                <div className="metrics-grid">
                  <div className="metric">
                    <div className="metric-label">ปีปลูกหลัก</div>
                    <div className="metric-value">{ageResult.year}</div>
                    <div className="metric-unit">พ.ศ.</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">อายุปัจจุบัน</div>
                    <div className="metric-value">{ageResult.age}</div>
                    <div className="metric-unit">ปี</div>
                  </div>
                </div>
                <div className="chips">
                  {Object.keys(ageResult.dist)
                    .sort()
                    .map((y) => (
                      <div
                        key={y}
                        className={`chip${+y === ageResult.year ? " main" : ""}`}
                      >
                        {y}: {ageResult.dist[y]}%
                      </div>
                    ))}
                </div>
                <button className="btn btn-primary" onClick={goStep4}>
                  <i className="bi bi-arrow-right-circle me-1"></i> ถัดไป: คำนวณคาร์บอน
                </button>
                <button className="btn btn-outline" onClick={() => goStep(2)}>
                  <i className="bi bi-arrow-left me-1"></i> กลับ
                </button>
              </div>
            )}
          </div>

          {/* Step 4 */}
          <div className={`pstep${step === 4 ? " active" : ""}`}>
            <div className="step-title">
              <div className="step-tag">
                <i className="bi bi-calculator"></i> ขั้นตอนที่ 4 / 5
              </div>
              <h2>คำนวณคาร์บอน</h2>
              <p>สมการอัลโลเมตริก Hevea brasiliensis</p>
            </div>

            <div className="info-box" style={{ marginBottom: 12 }}>
              <div className="info-box-title">สูตรคำนวณ</div>
              <ol className="info-steps">
                <li>
                  <span className="sn">H</span>ความสูง = 2.0 + 1.8 × อายุ (สูงสุด 28 ม.)
                </li>
                <li>
                  <span className="sn">D</span>DBH = 3 + 4.5 × อายุ (สูงสุด 60 ซม.)
                </li>
                <li>
                  <span className="sn">B</span>AGB = 0.1284 × D² × H × 0.001 ตัน/ต้น
                </li>
                <li>
                  <span className="sn">↑</span>CO₂ = (AGB + BGB) × 0.47 × 3.67
                </li>
              </ol>
            </div>

            {carbonComputing && (
              <div className="analyzing show">
                <div className="spin"></div>
                <p>กำลังคำนวณ...</p>
              </div>
            )}

            {carbonReady && (
              <div>
                <div className="metrics-grid">
                  <div className="metric">
                    <div className="metric-label">H ความสูง</div>
                    <div className="metric-value">{pd.H.toFixed(1)}</div>
                    <div className="metric-unit">เมตร</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">D รอบวง</div>
                    <div className="metric-value">{pd.D.toFixed(1)}</div>
                    <div className="metric-unit">ซม.</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">จำนวนต้น</div>
                    <div className="metric-value">{pd.treeCount.toLocaleString()}</div>
                    <div className="metric-unit">ต้น</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">Biomass/ต้น</div>
                    <div className="metric-value">{pd.bio}</div>
                    <div className="metric-unit">กก.</div>
                  </div>
                </div>
                <div className="carbon-hero">
                  <div className="carbon-hero-label">คาร์บอนทั้งแปลง</div>
                  <div className="carbon-hero-value">{pd.co2.toFixed(2)}</div>
                  <div className="carbon-hero-unit">tCO₂ eq.</div>
                </div>
                <div className="chart-box">
                  <div className="chart-box-title">คาร์บอนแยกส่วน (tCO₂)</div>
                  <canvas ref={carbonCanvasRef} height={130} />
                </div>
                <button className="btn btn-primary" onClick={goStep5}>
                  <i className="bi bi-graph-up-arrow me-1"></i> ถัดไป: พยากรณ์คาร์บอน
                </button>
                <button className="btn btn-outline" onClick={() => goStep(3)}>
                  <i className="bi bi-arrow-left me-1"></i> กลับ
                </button>
              </div>
            )}
          </div>

          {/* Step 5 */}
          <div className={`pstep${step === 5 ? " active" : ""}`}>
            <div className="step-title">
              <div className="step-tag">
                <i className="bi bi-graph-up"></i> ขั้นตอนที่ 5 / 5
              </div>
              <h2>พยากรณ์คาร์บอน</h2>
              <p>ดูแนวโน้มการสะสมคาร์บอนในปีต่อ ๆ ไป</p>
            </div>

            <div style={{ display: "flex", gap: 7, marginBottom: 12, alignItems: "center" }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <input
                  type="number"
                  value={fcYears}
                  onChange={(e) => setFcYears(parseInt(e.target.value) || 10)}
                  min={1}
                  max={50}
                  placeholder="จำนวนปี"
                />
              </div>
              <button
                className="btn btn-primary"
                style={{ width: "auto", padding: "10px 16px", marginBottom: 0 }}
                onClick={() => runForecast(fcYears)}
              >
                <i className="bi bi-play-fill me-1"></i>พยากรณ์
              </button>
            </div>
            <div className="preset-wrap">
              {[5, 10, 20, 30].map((y) => (
                <button
                  key={y}
                  className="btn-sm"
                  onClick={() => {
                    setFcYears(y);
                    runForecast(y);
                  }}
                >
                  {y} ปี
                </button>
              ))}
            </div>

            <div className="chart-box">
              <div className="chart-box-title">คาร์บอนสะสม (tCO₂) ตามปี</div>
              <canvas ref={fcCanvasRef} height={170} />
            </div>

            {fcTable.length > 0 && (
              <div className="metric" style={{ marginBottom: 14, padding: 12 }}>
                <div className="metric-label" style={{ marginBottom: 8 }}>
                  สรุปการพยากรณ์
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          color: "var(--text-dim)",
                          textAlign: "left",
                          padding: "3px 0",
                          fontWeight: 500,
                        }}
                      >
                        ปีที่
                      </th>
                      <th
                        style={{
                          color: "var(--text-dim)",
                          textAlign: "right",
                          fontWeight: 500,
                        }}
                      >
                        tCO₂
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fcTable.map((row) => (
                      <tr key={row.years}>
                        <td style={{ color: "var(--text-mid)", padding: "3px 0" }}>
                          +{row.years} ปี (อายุ {pd.treeAge + row.years} ปี)
                        </td>
                        <td
                          style={{
                            color: "var(--green)",
                            textAlign: "right",
                            fontWeight: 600,
                          }}
                        >
                          {row.co2}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", gap: 7 }}>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={savePlot}>
                <i className="bi bi-floppy me-1"></i> บันทึกแปลงนี้
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={() => goStep(4)}
              >
                <i className="bi bi-arrow-left me-1"></i> กลับ
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div id="statusbar">
        <div className="sdot"></div>
        <span id="status-text">{status}</span>
      </div>

      {/* Floating layer-switcher button (replaces the original custom maplibre control) */}
      <button
        title="เปลี่ยนชั้นข้อมูลแผนที่"
        onClick={() => setBasemapOpen((v) => !v)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 38,
          height: 38,
          background: "rgba(255,255,255,0.98)",
          border: "1px solid rgba(0,0,0,0.06)",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          zIndex: 110,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#555",
          cursor: "pointer",
        }}
      >
        <i className="bi bi-map"></i>
      </button>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 70,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "rgba(110,168,122,0.95)",
            color: "#fff",
            padding: "10px 22px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
            backdropFilter: "blur(10px)",
            whiteSpace: "nowrap",
          }}
        >
          <i className="bi bi-check-circle me-2"></i>
          {toast}
        </div>
      )}
    </div>
  );
}
