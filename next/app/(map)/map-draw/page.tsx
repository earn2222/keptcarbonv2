"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import JSZip from "jszip";
import { useAuth } from "@/lib/auth-context";
import {
  emptyFC,
  isMobile,
  polygonAreaM2,
  type LngLat,
  validateAndFixGeoJSON,
  detectUtmFromPrj,
  detectUtmZoneAuto,
  truncateCoords,
} from "@/lib/map-utils";
import { ParcelResultsPanel } from "@/app/components/organisms";

type Tab = "draw" | "shp";
type NdviStatus = number | null | "loading" | "error";
type BfastStatus = {
  state: "idle" | "loading" | "done" | "error";
  plantingYear?: number | null;
  age?: number | null;
  confidence?: number;
  ndviLatest?: number | null;
};

export default function MapDrawPage() {
  const { user } = useAuth();

  // Toggle body class for full-screen layout
  useEffect(() => {
    document.body.classList.add("map-draw-active");
    return () => document.body.classList.remove("map-draw-active");
  }, []);

  // Map refs / state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mapLoadedRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Draw state
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  const vertsRef = useRef<LngLat[]>([]);
  const [vertCount, setVertCount] = useState(0);
  const finalGJRef = useRef<GeoJSON.Feature | null>(null);
  const [drawDone, setDrawDone] = useState(false);
  const [drawPreview, setDrawPreview] = useState("—");

  // Tab + UI
  const [tab, setTab] = useState<Tab>("draw");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [basemap, setBasemap] = useState<"sat" | "street" | "topo">("sat");
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
  const [dragOver, setDragOver] = useState(false);

  // Search
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<{ display_name: string; lon: string; lat: string }[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // Stepper state
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Panel toggle state
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Area Validation State
  const [areaError, setAreaError] = useState<{ rai: number; sqm: number } | null>(null);

  // Drawn boundary geometry (set when search is confirmed)
  const [drawnGeometry, setDrawnGeometry] = useState<GeoJSON.Geometry | null>(null);

  const runParcelSearchRef = useRef<() => void>(() => { });


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
            minzoom: 1,
            maxzoom: 17,
            attribution: "",
          },
          street: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            minzoom: 1,
            maxzoom: 19,
            attribution: "",
          },
          topo: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            minzoom: 1,
            maxzoom: 17,
            attribution: "",
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#ffffff" } },
          { id: "sat", type: "raster", source: "sat", layout: { visibility: "visible" } },
          { id: "street", type: "raster", source: "street", layout: { visibility: "none" } },
          { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
        ],
      },
      center: [101.258, 13.5],
      zoom: 2,
      minZoom: 1,
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
      map.setProjection({ type: "globe" });
      mapLoadedRef.current = true;

      // ── Rayong Province Boundary ──────────────────────────────────────────
      map.addSource("rayong-boundary", {
        type: "geojson",
        data: "/assets/rayong-boundary.geojson",
      });
      // Glow / halo layer (wider, semi-transparent)
      map.addLayer({
        id: "rayong-boundary-glow",
        type: "line",
        source: "rayong-boundary",
        paint: {
          "line-color": "#0a43ffff",
          "line-width": 8,
          "line-opacity": 0.25,
          "line-blur": 4,
        },
      });
      // Main deep-pink line
      map.addLayer({
        id: "rayong-boundary-line",
        type: "line",
        source: "rayong-boundary",
        paint: {
          "line-color": "#1845c2ff",
          "line-width": 2.5,
          "line-opacity": 0.95,
          "line-dasharray": [6, 3],
        },
      });
      // ─────────────────────────────────────────────────────────────────────

      map.addSource("draw-line", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "draw-line-l",
        type: "line",
        source: "draw-line",
        paint: { "line-color": "#3b82f6", "line-width": 2, "line-dasharray": [3, 2] },
      });
      map.addSource("draw-fill", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "draw-fill-l",
        type: "fill",
        source: "draw-fill",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.05 },
      });
      map.addSource("draw-verts", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "draw-verts-l",
        type: "circle",
        source: "draw-verts",
        paint: {
          "circle-color": "#3b82f6",
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
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.05 },
      });
      map.addLayer({
        id: "plot-line",
        type: "line",
        source: "plot",
        paint: { "line-color": "#3b82f6", "line-width": 2.5 },
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
      map.addLayer({
        id: "matched-parcels-label",
        type: "symbol",
        source: "matched-parcels",
        layout: {
          "text-field": "{plot_index}",
          "text-size": 16,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#fa0303ff",
          "text-halo-width": 3,
        },
      });

      const fmt = (v: unknown) => (v == null || v === "" ? "—" : String(v));
      map.on("click", "matched-parcels-fill", (e) => {
        if (drawingRef.current) return;
        if (!e.features?.length) return;
        const p = (e.features[0].properties ?? {}) as Record<string, unknown>;
        const html = `
          <div style="font-family:var(--font,inherit); font-size:14px; line-height:1.6; color:#222; min-width:240px;">
            <div style="font-weight:700; font-size:16px; margin-bottom:6px; color:#1e7a47;">${fmt(p.farm_name)}</div>
            <div><b>เลขประจำตัว:</b> ${fmt(p.farm_idc)}</div>
            <div><b>เลขคำขอ:</b> ${fmt(p.app_no)} (แปลงที่ ${fmt(p.land_seq)})</div>
            <div><b>หมู่ ${fmt(p.land_moo)}</b> ต.${fmt(p.tambon)} อ.${fmt(p.amphoe_t)} จ.${fmt(p.province)}</div>
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
    if (!map || !final) return;
    let coords: LngLat[] = [];
    if (final.geometry.type === "Polygon") {
      coords = final.geometry.coordinates[0] as LngLat[];
    } else if (final.geometry.type === "MultiPolygon") {
      coords = (final.geometry.coordinates as GeoJSON.Position[][][]).flatMap((poly) => poly[0]) as LngLat[];
    }
    if (!coords.length) return;
    const lngs = coords.map((p) => p[0]);
    const lats = coords.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        duration: 900,
        pitch: 18,
      },
    );
  }, []);


  const finishDraw = useCallback((skipFit = false) => {
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

    // We keep draw-line and draw-verts visible so the user can edit them
    // Clear plot so it doesn't double-render
    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      (map.getSource("plot") as maplibregl.GeoJSONSource).setData(emptyFC());
    }

    const sqm = polygonAreaM2(ring);
    const rai = sqm / 1600;

    // Validation: 1 Rai minimum
    if (rai < 1) {
      setAreaError({ rai, sqm });
    } else {
      setAreaError(null);
    }

    setDrawPreview(`${rai.toFixed(2)} ไร่ · ${verts.length} จุด`);
    setDrawDone(true);
    setHasGeom(true);
    setStatus(`✓ วาดแปลงเสร็จ — ลากจุดเพื่อแก้ไข หรือคลิกเส้นเพื่อเพิ่มจุด`);
    if (!skipFit) fitPlot();

    // Auto process - ONLY if area is >= 1 Rai
    if (rai >= 1) {
      runParcelSearchRef.current();
    } else {
      // If area too small, ensure we stay on step 1 and don't process
      setCurrentStep(1);
    }
  }, [fitPlot]);

  // Map click / dblclick / Escape handlers — keep refs in sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!drawingRef.current) return;
      const pts = vertsRef.current;

      // Auto-close polygon if clicking near the first point
      if (pts.length >= 3) {
        const firstPt = map.project(pts[0] as [number, number]);
        const clickedPt = e.point;
        const dist = Math.hypot(firstPt.x - clickedPt.x, firstPt.y - clickedPt.y);
        if (dist < 20) {
          e.preventDefault();
          finishDraw();
          return;
        }
      }

      pts.push([e.lngLat.lng, e.lngLat.lat]);
      setVertCount(pts.length);
      previewDraw();
      setStatus(`จุดที่ ${pts.length}${pts.length >= 3 ? " — กดปุ่ม \"เสร็จสิ้น\" หรือ Double-click เพื่อจบการวาด" : " — คลิกต่อไปเพื่อเพิ่มจุด"}`);
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      if (!drawingRef.current || vertsRef.current.length < 3) return;
      e.preventDefault();
      finishDraw();
    };

    // Custom edit logic
    const onLineClick = (e: maplibregl.MapMouseEvent) => {
      if (drawingRef.current || vertsRef.current.length < 3) return;
      const pts = vertsRef.current;
      const pt = [e.lngLat.lng, e.lngLat.lat];
      let minDist = Infinity;
      let insertIdx = -1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const d = Math.hypot(a[0] - pt[0], a[1] - pt[1]) + Math.hypot(b[0] - pt[0], b[1] - pt[1]) - Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d < minDist) { minDist = d; insertIdx = i + 1; }
      }
      if (insertIdx !== -1) {
        pts.splice(insertIdx, 0, [e.lngLat.lng, e.lngLat.lat] as LngLat);
        previewDraw();
        finishDraw(true);
      }
    };

    let dragIdx = -1;
    const onMove = (ev: maplibregl.MapMouseEvent) => {
      if (dragIdx === -1) return;
      vertsRef.current[dragIdx] = [ev.lngLat.lng, ev.lngLat.lat];
      previewDraw();
    };
    const onUp = () => {
      if (dragIdx !== -1) {
        dragIdx = -1;
        map.getCanvas().style.cursor = 'grab';
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (!drawingRef.current && vertsRef.current.length >= 3) {
          finishDraw(true);
        }
      }
    };
    const onVertsDown = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      const pts = vertsRef.current;
      let minDist = Infinity;
      pts.forEach((p, i) => {
        const d = Math.hypot(p[0] - e.lngLat.lng, p[1] - e.lngLat.lat);
        if (d < minDist) { minDist = d; dragIdx = i; }
      });
      map.getCanvas().style.cursor = 'grabbing';
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    };

    map.on("click", onClick);
    map.on("dblclick", onDbl);

    // Attach edit handlers
    map.on('click', 'draw-line-l', onLineClick);
    map.on('mouseenter', 'draw-verts-l', () => { map.getCanvas().style.cursor = 'grab'; });
    map.on('mouseleave', 'draw-verts-l', () => { map.getCanvas().style.cursor = ''; });
    map.on('mousedown', 'draw-verts-l', onVertsDown);

    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
      map.off('click', 'draw-line-l', onLineClick);
      map.off('mousedown', 'draw-verts-l', onVertsDown);
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
    clearDraw();
    setIsPanelOpen(true);
    drawingRef.current = true;
    setDrawing(true);
    setStatus("โหมดวาด — คลิกเพื่อเพิ่มจุด | Double-click หรือกดเสร็จสิ้น เพื่อปิดแปลง | Esc ยกเลิก");
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
    setVertCount(0);
    setDrawPreview("—");
    setAreaError(null);
    setHasGeom(false);
    setDrawnGeometry(null);
    setSearchCount(null);
    setSearchErr(null);
    setSearchTruncated(false);
    setParcelFeatures([]);
    setShpFile(null);
    setShpStatus(null);
    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      (map.getSource("draw-line") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("draw-fill") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("draw-verts") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("plot") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
      (map.getSource("matched-parcels") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
    }
    setCurrentStep(1);
  };

  const cancelSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearchRunning(false);
    setCurrentStep(1);
    setSearchCount(null);
    setSearchErr(null);
    setSearchTruncated(false);
    setParcelFeatures([]);
    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      (map.getSource("matched-parcels") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
    }
  }, []);

  const backToStep1 = useCallback(() => {
    setCurrentStep(1);
    setSearchCount(null);
    setSearchErr(null);
    setSearchTruncated(false);
    setParcelFeatures([]);
    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      (map.getSource("matched-parcels") as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
    }
  }, []);

  // ===== PARCEL DB SEARCH =====
  const runParcelSearch = useCallback(async () => {
    const final = finalGJRef.current;
    if (!final?.geometry) {
      setSearchErr("กรุณาวาดแปลงหรืออัปโหลด Shapefile ก่อน");
      return;
    }
    // Abort any previous in-flight search
    searchAbortRef.current?.abort();
    const abort = new AbortController();
    searchAbortRef.current = abort;

    setDrawnGeometry(final.geometry);
    setSearchRunning(true);
    setCurrentStep(2);
    setSearchErr(null);
    setSearchCount(null);
    setSearchTruncated(false);
    try {
      const res = await fetch("/api/parcels/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: abort.signal,
        body: JSON.stringify({ geometry: truncateCoords(final.geometry), relation: "intersects" }),
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

      // Inject plot_index so the map label can display it
      features.forEach((f, i) => {
        if (!f.properties) f.properties = {};
        f.properties.plot_index = String(i + 1);
      });

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
                padding: { top: 60, bottom: 60, left: 60, right: 60 },
                duration: 700,
                maxZoom: 16,
              },
            );
          }
        }
      }
      setParcelFeatures(features);
      setSearchCount(data.count ?? features.length);
      setSearchTruncated(Boolean(data.truncated));
      if ((data.count ?? 0) === 0) {
        setStatus("ไม่พบแปลงในฐานข้อมูลที่ตรงเงื่อนไข");
      } else {
        setStatus(`พบ ${data.count} แปลงในฐานข้อมูล (ตัดกับพื้นที่)`);
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") return; // cancelled — don't set error
      setSearchErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchRunning(false);
    }
  }, []);

  useEffect(() => {
    runParcelSearchRef.current = runParcelSearch;
  }, [runParcelSearch]);

  // Search is triggered manually via "ยืนยันแปลงที่วาด" button (draw) or inside loadShp (SHP)


  // ===== SHP IMPORT =====
  const onShpSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    clearDraw();
    setShpFile(f);
    setShpStatus({ msg: `✓ เลือกไฟล์: ${f.name}`, ok: true });
    e.target.value = "";
  };

  const loadShp = async () => {
    if (!shpFile) return;
    setShpStatus({ msg: "กำลังอ่านไฟล์..." });
    try {
      const zip = await JSZip.loadAsync(shpFile);
      const fns = Object.keys(zip.files);
      const sk = fns.find((f) => f.toLowerCase().endsWith(".shp"));
      const dk = fns.find((f) => f.toLowerCase().endsWith(".dbf"));
      const pk = fns.find((f) => f.toLowerCase().endsWith(".prj"));
      if (!sk) throw new Error("ไม่พบไฟล์ .shp ใน zip");
      const shpBuf = await zip.files[sk].async("arraybuffer");
      const dbfBuf = dk ? await zip.files[dk].async("arraybuffer") : undefined;
      const shapefile = await import("shapefile");
      const src = await shapefile.open(shpBuf, dbfBuf);
      const rawFeats: GeoJSON.Feature[] = [];
      let r;
      while (!(r = await src.read()).done) rawFeats.push(r.value);
      if (!rawFeats.length) throw new Error("ไม่พบ Feature ในไฟล์");

      // Detect projection from .prj, or auto-detect UTM zone from coordinates
      let utm: { zone: number; isNorth: boolean } | undefined;
      if (pk) {
        const prjText = await zip.files[pk].async("string");
        utm = detectUtmFromPrj(prjText) ?? undefined;
      }
      // If no .prj or not parseable, check first coordinate for UTM range and auto-detect
      if (!utm) {
        const sample = (rawFeats[0]?.geometry as any)?.coordinates;
        const flat = (function first(c: any): [number, number] | null {
          if (!Array.isArray(c)) return null;
          if (typeof c[0] === "number") return c as [number, number];
          return first(c[0]);
        })(sample);
        if (flat && (Math.abs(flat[0]) > 2000 || Math.abs(flat[1]) > 2000)) {
          utm = detectUtmZoneAuto(flat[0], flat[1]) ?? undefined;
          if (!utm) throw new Error("ไม่สามารถตรวจจับระบบพิกัดได้ กรุณาใส่ไฟล์ .prj หรือแปลงเป็น WGS84 (EPSG:4326) ก่อน");
        }
      }

      const projLabel = utm ? ` (UTM Zone ${utm.zone}${utm.isNorth ? "N" : "S"} → WGS84)` : " (WGS84)";
      const feats = rawFeats.map((f) => validateAndFixGeoJSON(f, utm));

      // Collect ALL polygon features (not just the first one)
      const polyFeats = feats.filter(
        (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
      );
      if (!polyFeats.length) throw new Error("ไม่พบ Polygon");

      // Merge all rings into one MultiPolygon for the search query
      const allRings: GeoJSON.Position[][][] = [];
      for (const f of polyFeats) {
        if (f.geometry.type === "Polygon") {
          allRings.push(f.geometry.coordinates as GeoJSON.Position[][]);
        } else if (f.geometry.type === "MultiPolygon") {
          allRings.push(...(f.geometry.coordinates as GeoJSON.Position[][][]));
        }
      }
      const searchGeom: GeoJSON.MultiPolygon = { type: "MultiPolygon", coordinates: allRings };
      finalGJRef.current = { type: "Feature", geometry: searchGeom, properties: {} };

      // Calculate total area for validation
      let totalSqm = 0;
      for (const f of polyFeats) {
        if (f.geometry.type === "Polygon") {
          totalSqm += polygonAreaM2(f.geometry.coordinates[0] as LngLat[]);
        } else if (f.geometry.type === "MultiPolygon") {
          for (const poly of f.geometry.coordinates) {
            totalSqm += polygonAreaM2(poly[0] as LngLat[]);
          }
        }
      }
      const totalRai = totalSqm / 1600;
      if (totalRai < 1) {
        setAreaError({ rai: totalRai, sqm: totalSqm });
      } else {
        setAreaError(null);
      }

      setHasGeom(true);
      const map = mapRef.current;
      if (map && mapLoadedRef.current) {
        // Show all uploaded parcels on the map
        (map.getSource("plot") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: polyFeats,
        });
      }
      fitPlot();
      
      // Auto process - ONLY if total area is >= 1 Rai
      if (totalRai >= 1) {
        void runParcelSearch();
      } else {
        setCurrentStep(1);
      }

      setShpStatus({
        msg: `✓ โหลดสำเร็จ — ${polyFeats.length} แปลง${projLabel}${totalRai < 1 ? " (พื้นที่น้อยกว่า 1 ไร่)" : ""}`,
        ok: totalRai >= 1,
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

  // ===== Outside-click close (search) =====
  useEffect(() => {
    if (!searchResults) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const sc = document.getElementById("search-container");
      if (searchResults && sc && !sc.contains(target)) setSearchResults(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [searchResults]);


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


  return (
    <div className={`mds-shell${drawing ? " drawing" : ""}`}>

      {/* ══ LEFT: Map ══ */}
      <div className="mds-map-side">
        <div className="mds-map-container" ref={mapContainerRef} />

        {/* Floating search bar */}
        <div className="mds-search-wrap" id="search-container">
          <div className="mds-search-box">
            <input
              className="mds-search-input"
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="ค้นหา จังหวัด, อำเภอ, ตำบล..."
            />
            <button className="mds-search-btn" onClick={searchLocation} disabled={searchLoading}>
              {searchLoading
                ? <div className="spinner-border spinner-border-sm" role="status" style={{ width: 16, height: 16, borderWidth: 2, color: "#fff" }} />
                : <i className="bi bi-search" />}
            </button>
          </div>
          {searchResults && (
            <div className="mds-search-results">
              {searchResults.length === 0 && (
                <div className="mds-search-item" style={{ color: "rgba(220,53,69,0.8)", textAlign: "center" }}>
                  ไม่พบสถานที่ที่ค้นหา
                </div>
              )}
              {searchResults.map((item, i) => (
                <div key={i} className="mds-search-item" onClick={() => pickSearchResult(item)}>
                  <i className="bi bi-compass me-2" style={{ color: "#2d9e5f" }} />
                  {item.display_name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Layer switcher button */}
        <div className="mds-map-controls">
          <button
            className="mds-map-ctrl-btn"
            title="เปลี่ยนแผนที่ฐาน"
            onClick={() => setBasemapOpen((v) => !v)}
          >
            <i className="bi bi-layers" />
          </button>
        </div>

        {/* Basemap card */}
        <div className={`mds-basemap-card${basemapOpen ? " open" : ""}`}>
          <div className="mds-basemap-header">
            <span><i className="bi bi-layers me-1" /> แผนที่ฐาน</span>
            <i className="bi bi-x" style={{ cursor: "pointer", fontSize: 18 }} onClick={() => setBasemapOpen(false)} />
          </div>
          {(["sat", "street", "topo"] as const).map((m) => (
            <div
              key={m}
              className={`mds-basemap-option${basemap === m ? " active" : ""}`}
              onClick={() => switchBasemap(m)}
            >
              <i className={m === "sat" ? "bi bi-globe-asia-australia" : m === "street" ? "bi bi-map" : "bi bi-tree"} />
              {m === "sat" ? "ดาวเทียม" : m === "street" ? "ถนน (Street)" : "ภูมิประเทศ"}
            </div>
          ))}
        </div>

      </div>

      {/* ── Toggle Panel Button (when closed) ── */}
      {!isPanelOpen && (
        <button
          className="mds-panel-toggle-btn"
          onClick={() => setIsPanelOpen(true)}
          title="เปิดแผงเครื่องมือ"
        >
          <i className="bi bi-clipboard2-data-fill" />
        </button>
      )}

      {/* ══ RIGHT: Data Panel ══ */}
      <div className={`mds-panel-side ${isPanelOpen ? "open" : "closed"}`}>

        {/* Drag handle for mobile toggle */}
        <div className="mds-mobile-drag-handle" onClick={() => setIsPanelOpen(false)} />

        {/* ── Panel Mini Header ── */}
        <div className="mds-panel-topbar">
          <div className="mds-panel-topbar-left">
            <div className="mds-panel-topbar-icon">
              <i className="bi bi-geo-alt-fill" />
            </div>
            <div>
              <div className="mds-panel-topbar-title">วิเคราะห์แปลงยาง</div>
              <div className="mds-panel-topbar-sub">KeptCarbon · ระบบกำหนดขอบเขต</div>
            </div>
          </div>
          <button
            className="mds-panel-topbar-close"
            onClick={() => setIsPanelOpen(false)}
            title="ซ่อนแผง"
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>

        {/* ── Step Tracker ── */}
        <div className="mds-stepper">
          <div className="mds-steps-row">
            <div className="mds-stepper-track">
              <div className="mds-stepper-fill" style={{ width: `${(currentStep - 1) * 50}%` }} />
            </div>
            {([
              { n: 1 as const, label: "กำหนดพื้นที่" },
              { n: 2 as const, label: "ผลวิเคราะห์" },
              { n: 3 as const, label: "บันทึก" },
            ]).map(({ n, label }) => {
              const isActive = currentStep === n;
              const isDone = currentStep > n;
              return (
                <div key={n} className={`mds-step${isActive ? " active" : isDone ? " done" : ""}`}>
                  <div className="mds-step-circle">
                    {isDone ? <i className="bi bi-check-lg" /> : n}
                  </div>
                  <span className="mds-step-label">{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable Content ── */}
        <div className="mds-panel-body">

          {/* STEP 1: Draw / Upload */}
          {currentStep === 1 && (
            <div className="mds-s1">
              <div className="mds-s1-card">
                <div className="mds-s1-hd">
                  <div>
                    <div className="mds-section-tag">
                      <i className="bi bi-pencil-square" /> ขั้นตอนที่ 1
                    </div>
                    <h2 className="mds-s1-title">กำหนดขอบเขตแปลง</h2>
                    <p className="mds-s1-sub">
                      วาดหรือนำเข้าพื้นที่บนแผนที่เพื่อค้นหาแปลงยางในฐานข้อมูล
                    </p>
                  </div>
                  <div className="mds-s1-num">01</div>
                </div>

                {/* Method selector */}
                <div className="mds-method-toggle">
                  <button
                    className={`mds-mtab${tab === "draw" ? " active" : ""}`}
                    onClick={() => setTab("draw")}
                  >
                    <i className="bi bi-pencil-square" /> วาดแปลง
                  </button>
                  <button
                    className={`mds-mtab${tab === "shp" ? " active" : ""}`}
                    onClick={() => setTab("shp")}
                  >
                    <i className="bi bi-file-earmark-zip" /> นำเข้า SHP
                  </button>
                </div>

                {/* ── Draw tab ── */}
                {tab === "draw" && (
                  <div className="mds-action-content">
                    {drawing ? (
                      /* ── Drawing in progress ── */
                      <>
                        <div className="mds-draw-hint">
                          <div className="mds-dot-pulse" />
                          คลิกบนแผนที่เพื่อเพิ่มจุด · <strong>Double-click</strong> หรือกดปุ่ม <strong>"เสร็จสิ้น"</strong> เพื่อจบการวาด
                        </div>
                        <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                          <button
                            className="mds-btn mds-btn-solid mds-finish-btn-mobile"
                            style={{ flex: 1 }}
                            onClick={() => finishDraw()}
                            disabled={vertCount < 3}
                          >
                            <i className="bi bi-check-circle" /> เสร็จสิ้น วาดแปลง
                          </button>
                          <button className="mds-btn mds-btn-danger" onClick={clearDraw}>
                            <i className="bi bi-x-circle" /> ยกเลิก
                          </button>
                        </div>
                      </>
                    ) : (
                      /* ── Default: show instructions + start button ── */
                      <>
                        <div className="mds-instr-note">
                          <i className="bi bi-info-circle" />
                          ขนาดแปลงต้องไม่น้อยกว่า 1 ไร่ / 40×40 เมตร
                        </div>
                        <ol className="mds-instr-list">
                          <li>คลิกปุ่ม <strong>&ldquo;เริ่มวาดแปลง&rdquo;</strong> ด้านล่าง</li>
                          <li>คลิกบนแผนที่เพื่อเพิ่มจุดขอบเขต (อย่างน้อย 3 จุด)</li>
                          <li>กดปุ่ม <strong>&ldquo;เสร็จสิ้น วาดแปลง&rdquo;</strong> หรือ Double-click เพื่อจบการวาด</li>
                          <li>แก้ไข: ลากจุดเพื่อย้ายตำแหน่ง</li>
                        </ol>
                        <button className="mds-btn mds-btn-solid" onClick={startDrawFlow}>
                          <i className="bi bi-pencil" /> เริ่มวาดแปลง
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* ── SHP tab ── */}
                {tab === "shp" && (
                  <div className="mds-action-content">
                    <div
                      className={`mds-dropzone${dragOver ? " drag-over" : ""}${shpFile ? " has-file" : ""}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f) { setShpFile(f); setShpStatus({ msg: `✓ เลือกไฟล์: ${f.name}`, ok: true }); }
                      }}
                      onClick={() => document.getElementById("shp-file-input-split")?.click()}
                    >
                      <i className={`bi ${shpFile ? "bi-file-zip-fill" : "bi-cloud-upload"}`} />
                      <p>{shpFile ? shpFile.name : "ลาก .zip มาวาง หรือคลิกเลือก"}</p>
                      <span>ต้องมี .shp .shx .dbf ใน ZIP · WGS84 (EPSG:4326)</span>
                    </div>
                    <input
                      id="shp-file-input-split"
                      type="file"
                      accept=".zip"
                      style={{ display: "none" }}
                      onChange={onShpSelected}
                    />
                    {shpStatus && (
                      <div className={`mds-shp-msg${shpStatus.ok ? " ok" : ""}`}>
                        {shpStatus.msg}
                      </div>
                    )}
                    <button
                      className="mds-btn mds-btn-solid"
                      onClick={loadShp}
                      disabled={!shpFile}
                    >
                      <i className="bi bi-upload" /> โหลดและแสดงบนแผนที่
                    </button>
                    {hasGeom && !drawing && (
                      <button className="mds-btn mds-btn-soft" onClick={clearDraw}>
                        <i className="bi bi-trash" /> ล้างแปลง
                      </button>
                    )}
                  </div>
                )}

              </div>{/* /mds-s1-card */}
            </div>
          )}

          {/* STEPS 2 & 3: Results + Save */}
          {(currentStep >= 2 || searchRunning || searchErr) && (
            <div className="mds-results-container">
              <ParcelResultsPanel
                searchRunning={searchRunning}
                searchErr={searchErr}
                searchCount={searchCount}
                searchTruncated={searchTruncated}
                parcelFeatures={parcelFeatures}
                userDisplayName={user?.fullname ?? ""}
                drawnGeometry={drawnGeometry}
                onFlyTo={flyToFeature}
                onReset={clearDraw}
                onBack={backToStep1}
                onCancel={cancelSearch}
                currentStep={currentStep}
                onStepChange={setCurrentStep}
              />
            </div>
          )}

        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="mds-toast">
          <i className="bi bi-check-circle me-2" />
          {toast}
        </div>
      )}

      {/* Area Validation Popup */}
      {areaError && (
        <div className="mds-area-popup-overlay" onClick={() => setAreaError(null)}>
          <div className="mds-area-popup" onClick={(e) => e.stopPropagation()}>
            <div className="mds-area-popup-icon">
              <i className="bi bi-exclamation-triangle-fill" />
            </div>
            <div className="mds-area-popup-content">
              <h3>พื้นที่แปลงเล็กเกินไป</h3>
              <p>
                ขนาดแปลงที่วาดคือ <strong>{areaError.rai.toFixed(2)} ไร่</strong> ({Math.round(areaError.sqm).toLocaleString()} ตร.ม.)
                ซึ่งน้อยกว่าเกณฑ์ขั้นต่ำ <strong>1 ไร่</strong> (40×40 เมตร)
              </p>
              <div className="mds-area-popup-hint">
                กรุณาปรับขยายขอบเขตแปลงให้ครอบคลุมพื้นที่มากขึ้น
              </div>
            </div>
            <button className="mds-area-popup-close" onClick={() => setAreaError(null)}>
              ตกลง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

