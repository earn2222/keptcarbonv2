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
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartItem,
} from "chart.js";
import JSZip from "jszip";
import { useAuth } from "@/lib/auth-context";
import {
  emptyFC,
  isMobile,
  polygonAreaM2,
  type LngLat,
} from "@/lib/map-utils";
import { ParcelResultsPanel } from "@/app/components/organisms";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

type Tab = "draw" | "shp";
type NdviStatus = number | null | "loading" | "error";
type BfastStatus = {
  state: "idle" | "loading" | "done" | "error";
  plantingYear?: number | null;
  age?: number | null;
  confidence?: number;
  ndviLatest?: number | null;
};

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

  // Tab + UI
  const [tab, setTab] = useState<Tab>("draw");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [basemap, setBasemap] = useState<"sat" | "street" | "topo">("sat");
  const [panelOpen, setPanelOpen] = useState(true);
  const [status, setStatus] = useState("🌍 แผนที่ลูกโลก — กด \"เริ่มวาดแปลง\" เพื่อบินไปยังประเทศไทย");

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
  const [selectedParcelIdx, setSelectedParcelIdx] = useState<number[]>([]);
  const [tableOpen, setTableOpen] = useState(false);
  const [ndviMap, setNdviMap] = useState<Record<number, NdviStatus>>({});
  const [ndviFetching, setNdviFetching] = useState(false);
  const [ndviProgress, setNdviProgress] = useState({ done: 0, total: 0 });
  const [bfastMap, setBfastMap] = useState<Record<number, BfastStatus>>({});
  const [bfastFetching, setBfastFetching] = useState(false);
  const [bfastProgress, setBfastProgress] = useState({ done: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);

  // Age distribution chart (infographic)
  const ageChartRef = useRef<Chart | null>(null);
  const ageCanvasRef = useRef<HTMLCanvasElement>(null);

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
            <div><b>ปีปลูก:</b> ${fmt(p.grow_year)}</div>
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
    setStatus(`✓ วาดแปลงเสร็จ: ${rai.toFixed(2)} ไร่`);
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
    setSelectedParcelIdx([]);
    setTableOpen(false);
    setNdviMap({});
    setBfastMap({});
    setNdviFetching(false);
    setNdviProgress({ done: 0, total: 0 });
    setBfastFetching(false);
    setBfastProgress({ done: 0, total: 0 });
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
      setSelectedParcelIdx(features.map((_, i) => i));
      setBfastMap({});
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

  const fetchBfastForIndices = useCallback(async (indices: number[]) => {
    const uniq = Array.from(new Set(indices)).filter((i) => i >= 0 && i < parcelFeatures.length);
    if (uniq.length === 0 || bfastFetching) return;

    setBfastFetching(true);
    setBfastProgress({ done: 0, total: uniq.length });
    setBfastMap((prev) => {
      const next = { ...prev };
      for (const i of uniq) next[i] = { state: "loading" };
      return next;
    });

    const features = uniq.map((i) => {
      const feat = parcelFeatures[i];
      const p = (feat.properties ?? {}) as Record<string, unknown>;
      const plotId = String(p.farm_idc ?? p.id ?? p.plot_id ?? `plot_${i + 1}`);
      return { plot_id: plotId, geometry: feat.geometry };
    });

    try {
      const res = await fetch("/api/rubber-age/bfast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          features,
          startDate: "2017-01-01",
          endDate: new Date().toISOString().slice(0, 10),
          currentYear: new Date().getFullYear(),
          maxPlots: features.length,
        }),
      });

      const data = (await res.json()) as { rows?: Array<Record<string, unknown>>; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const byPlot = new Map<string, Record<string, unknown>>();
      for (const row of data.rows ?? []) {
        const pid = String(row.plot_id ?? "");
        byPlot.set(pid, row);
      }

      setBfastMap((prev) => {
        const next = { ...prev };
        for (const i of uniq) {
          const feat = parcelFeatures[i];
          const p = (feat.properties ?? {}) as Record<string, unknown>;
          const plotId = String(p.farm_idc ?? p.id ?? p.plot_id ?? `plot_${i + 1}`);
          const row = byPlot.get(plotId);
          if (!row) {
            next[i] = { state: "error" };
            continue;
          }
          next[i] = {
            state: "done",
            plantingYear: row.planting_year == null ? null : Number(row.planting_year),
            age: row.age == null ? null : Number(row.age),
            confidence: Number(row.confidence ?? 0),
            ndviLatest: row.ndvi_latest == null ? null : Number(row.ndvi_latest),
          };
        }
        return next;
      });
      setBfastProgress({ done: uniq.length, total: uniq.length });
    } catch {
      setBfastMap((prev) => {
        const next = { ...prev };
        for (const i of uniq) next[i] = { state: "error" };
        return next;
      });
    } finally {
      setBfastFetching(false);
    }
  }, [parcelFeatures, bfastFetching]);

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
      const map = mapRef.current;
      if (map && mapLoadedRef.current) {
        (map.getSource("plot") as maplibregl.GeoJSONSource).setData(final);
      }
      fitPlot();
      setShpStatus({
        msg: `✓ โหลดสำเร็จ — ${feats.length} feature`,
        ok: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setShpStatus({ msg: "✗ " + msg });
    }
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

  const flyToFeature = useCallback((feature: GeoJSON.Feature) => {
    const map = mapRef.current;
    if (!map || !feature.geometry) return;
    const coords = feature.geometry.type === "Polygon"
      ? (feature.geometry as GeoJSON.Polygon).coordinates[0]
      : feature.geometry.type === "MultiPolygon"
        ? (feature.geometry as GeoJSON.MultiPolygon).coordinates[0][0]
        : null;
    if (!coords?.length) return;
    const lngs = coords.map(([x]) => x);
    const lats = coords.map(([, y]) => y);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, duration: 600, maxZoom: 18 },
    );
  }, []);

  const onLogout = () => {
    logout();
    router.push("/");
  };

  // ===== INFOGRAPHIC COMPUTATIONS =====
  const AGE_BRACKETS = ["0–5 ปี", "6–10 ปี", "11–15 ปี", "16–20 ปี", "20+ ปี"];
  const BRACKET_COLORS = [
    "rgba(16, 185, 129, 0.8)",
    "rgba(5, 150, 105, 0.8)",
    "rgba(4, 120, 87, 0.8)",
    "rgba(217, 119, 6, 0.8)",
    "rgba(180, 83, 9, 0.8)",
  ];

  const infographic = useMemo(() => {
    if (!parcelFeatures.length) return null;
    const bracketCounts = [0, 0, 0, 0, 0];
    let totalAge = 0;
    const provinces: Record<string, number> = {};
    for (const f of parcelFeatures) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const age = Number(p.rubber_age ?? 0);
      totalAge += age;
      if (age <= 5) bracketCounts[0]++;
      else if (age <= 10) bracketCounts[1]++;
      else if (age <= 15) bracketCounts[2]++;
      else if (age <= 20) bracketCounts[3]++;
      else bracketCounts[4]++;
      const prov = String(p.province ?? "—");
      provinces[prov] = (provinces[prov] ?? 0) + 1;
    }
    return {
      bracketCounts,
      avgAge: totalAge / parcelFeatures.length,
      topProvinces: Object.entries(provinces).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [parcelFeatures]);

  useEffect(() => {
    if (!infographic || !ageCanvasRef.current) return;
    ageChartRef.current?.destroy();
    const ctx = ageCanvasRef.current.getContext("2d") as ChartItem;
    ageChartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: AGE_BRACKETS,
        datasets: [{
          data: infographic.bracketCounts,
          backgroundColor: BRACKET_COLORS,
          borderRadius: 6,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }, tooltip: {
            callbacks: {
              label: (ctx) => ` ${(ctx.parsed.y ?? 0).toLocaleString()} แปลง`,
            }
          }
        },
        scales: {
          x: { ticks: { color: "rgba(45,90,61,0.6)", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "rgba(45,90,61,0.5)", font: { size: 9 } }, grid: { color: "rgba(45,158,95,0.06)" } },
        },
      },
    });
    return () => { ageChartRef.current?.destroy(); ageChartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infographic]);

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
          <span className="panel-collapsed-title">🌿 สำรวจแปลงยาง</span>
          <div className="panel-toggle-btn">
            <i className={`bi ${panelOpen ? "bi-chevron-down" : "bi-chevron-up"}`}></i>
          </div>
        </div>

        <div className="panel-inner">
          <div className="pstep active">

            {/* Drawing mode live banner */}
            {drawing && (
              <div className="s1-drawing-banner">
                <div className="s1-drawing-pulse" />
                <span>โหมดวาด · คลิกเพิ่มจุด · Double-click ปิดแปลง · Esc ยกเลิก</span>
              </div>
            )}

            <div className="step-title">
              <div className="step-tag">
                <i className="bi bi-map"></i> กำหนดพื้นที่ศึกษา
              </div>
              <h2>สำรวจแปลงยาง</h2>
              <p>วาดพื้นที่หรือนำเข้า Shapefile เพื่อดูข้อมูลแปลงยาง</p>
            </div>

            {/* Method selector cards */}
            <div className="s1-method-row">
              <button
                className={`s1-method-card${tab === "draw" ? " active" : ""}`}
                onClick={() => setTab("draw")}
              >
                <i className="bi bi-pencil-square"></i>
                <span>วาดบนแผนที่</span>
              </button>
              <button
                className={`s1-method-card${tab === "shp" ? " active" : ""}`}
                onClick={() => setTab("shp")}
              >
                <i className="bi bi-file-earmark-zip"></i>
                <span>นำเข้า SHP</span>
              </button>
            </div>

            {/* ── Draw tab ── */}
            {tab === "draw" && (
              <div>
                <div className={`draw-done${drawDone ? " show" : ""}`}>
                  <i className="bi bi-check-circle-fill"></i>
                  <div className="draw-done-text">
                    <strong>วาดแปลงเรียบร้อย ✓</strong>
                    <span>{drawPreview}</span>
                  </div>
                </div>

                <button
                  className={`btn btn-primary s1-draw-btn${drawing ? " s1-draw-active" : ""}`}
                  onClick={
                    drawing
                      ? clearDraw
                      : drawDone
                        ? () => { clearDraw(); startDrawFlow(); }
                        : startDrawFlow
                  }
                >
                  <i className={`bi ${drawing ? "bi-stop-circle" : drawDone ? "bi-arrow-repeat" : "bi-pencil"} me-1`}></i>{" "}
                  {drawing ? "หยุดวาด (Esc)" : drawDone ? "วาดแปลงใหม่" : "เริ่มวาดแปลง"}
                </button>

                {drawDone && !drawing && (
                  <button className="btn btn-outline" onClick={clearDraw}>
                    <i className="bi bi-trash me-1"></i> ล้างแปลง
                  </button>
                )}
              </div>
            )}

            {/* ── SHP tab ── */}
            {tab === "shp" && (
              <div>
                <div
                  className={`s1-dropzone${dragOver ? " drag-over" : ""}${shpFile ? " has-file" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f) { setShpFile(f); setShpStatus({ msg: `✓ เลือกไฟล์: ${f.name}`, ok: true }); }
                  }}
                  onClick={() => document.getElementById("shp-file-input")?.click()}
                >
                  <i className={`bi ${shpFile ? "bi-file-zip-fill" : "bi-cloud-upload"}`}></i>
                  <p>{shpFile ? shpFile.name : "ลาก .zip มาวาง หรือคลิกเลือก"}</p>
                  <span>ต้องมี .shp .shx .dbf ใน ZIP · WGS84 (EPSG:4326)</span>
                </div>
                <input
                  id="shp-file-input"
                  type="file"
                  accept=".zip"
                  style={{ display: "none" }}
                  onChange={onShpSelected}
                />
                {shpStatus && (
                  <div className={`s1-shp-msg${shpStatus.ok ? " ok" : ""}`}>
                    {shpStatus.msg}
                  </div>
                )}
                <button className="btn btn-primary" onClick={loadShp} disabled={!shpFile}>
                  <i className="bi bi-upload me-1"></i> โหลดและแสดงบนแผนที่
                </button>
              </div>
            )}

            <ParcelResultsPanel
              searchRunning={searchRunning}
              searchErr={searchErr}
              searchCount={searchCount}
              searchTruncated={searchTruncated}
              parcelFeatures={parcelFeatures}
              selectedParcelIdx={selectedParcelIdx}
              tableOpen={tableOpen}
              ndviMap={ndviMap}
              ndviFetching={ndviFetching}
              ndviProgress={ndviProgress}
              infographic={infographic}
              ageCanvasRef={ageCanvasRef}
              onFetchAllNdvi={fetchAllNdvi}
              onToggleTable={() => setTableOpen((v) => !v)}
              onSelectAll={() => setSelectedParcelIdx(parcelFeatures.map((_, i) => i))}
              onClearSelection={() => setSelectedParcelIdx([])}
              onToggleSelection={(index) => {
                setSelectedParcelIdx((prev) =>
                  prev.includes(index) ? prev.filter((v) => v !== index) : [...prev, index],
                );
              }}
              onFlyTo={flyToFeature}
              onFetchNdvi={(index) => {
                if (ndviMap[index] !== "loading") {
                  fetchNdviForIndex(index);
                }
              }}
            />
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
