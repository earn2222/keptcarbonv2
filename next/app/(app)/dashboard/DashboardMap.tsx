"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type MapPlot = {
  id: string;
  name: string;
  areaRai: number;
  carbonTotal: number;
  geojson: GeoJSON.GeoJSON;
  boundaryGeojson?: GeoJSON.GeoJSON | null;
};

export default function DashboardMap({ plots }: { plots: MapPlot[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "© Esri",
          },
        },
        layers: [{ id: "satellite", type: "raster", source: "satellite" }],
      },
      center: [101.2587, 12.6819],
      zoom: 8,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: false }),
      "bottom-right"
    );

    map.on("load", () => {
      /* ── Collect features for each layer ── */
      const detectedFeatures: GeoJSON.Feature[] = [];
      const boundaryFeatures: GeoJSON.Feature[] = [];

      // Track seen boundary strings to avoid drawing the same boundary multiple times
      const seenBoundaries = new Set<string>();

      plots.forEach((plot) => {
        /* Detected parcel layer (green) */
        const geo = plot.geojson as GeoJSON.GeoJSON | undefined;
        if (geo) {
          detectedFeatures.push({
            type: "Feature",
            geometry: geo as GeoJSON.Geometry,
            properties: {
              name: plot.name ?? "แปลงไม่มีชื่อ",
              area: plot.areaRai ?? 0,
              carbon: plot.carbonTotal ?? 0,
            },
          });
        }

        /* Drawn boundary layer (blue) */
        const bnd = plot.boundaryGeojson as GeoJSON.Geometry | null | undefined;
        if (bnd) {
          const key = JSON.stringify(bnd);
          if (!seenBoundaries.has(key)) {
            seenBoundaries.add(key);
            boundaryFeatures.push({
              type: "Feature",
              geometry: bnd,
              properties: { name: plot.name },
            });
          }
        }
      });

      /* ── Boundary layer (drawn area) — blue/teal ── */
      map.addSource("plots-boundary", {
        type: "geojson",
        data: { type: "FeatureCollection", features: boundaryFeatures },
      });
      map.addLayer({
        id: "plots-boundary-fill",
        type: "fill",
        source: "plots-boundary",
        paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "plots-boundary-line",
        type: "line",
        source: "plots-boundary",
        paint: {
          "line-color": "#0284c7",
          "line-width": 2.5,
          "line-dasharray": [6, 3],
        },
      });

      /* ── Detected plots layer — green ── */
      map.addSource("plots-detected", {
        type: "geojson",
        data: { type: "FeatureCollection", features: detectedFeatures },
      });
      map.addLayer({
        id: "plots-detected-fill",
        type: "fill",
        source: "plots-detected",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "plots-detected-line",
        type: "line",
        source: "plots-detected",
        paint: { "line-color": "#16a34a", "line-width": 2.2 },
      });

      /* ── Popup on detected plot click ── */
      map.on("click", "plots-detected-fill", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties ?? {};
        new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:inherit;font-size:13px;line-height:1.55">
              <div style="font-weight:800;font-size:14px;color:#15803d;margin-bottom:4px">
                🌿 ${p.name ?? "แปลงไม่มีชื่อ"}
              </div>
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:2px">
                <span style="width:10px;height:10px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0"></span>
                <span>แปลงที่ตรวจจับได้</span>
              </div>
              <div>พื้นที่: <b>${Number(p.area).toFixed(2)} ไร่</b></div>
              <div>คาร์บอน: <b>${Number(p.carbon).toFixed(1)} tCO₂</b></div>
            </div>
          `)
          .addTo(map);
      });

      /* ── Popup on boundary click ── */
      map.on("click", "plots-boundary-fill", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties ?? {};
        new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:inherit;font-size:13px;line-height:1.55">
              <div style="font-weight:800;font-size:14px;color:#0284c7;margin-bottom:4px">
                ✏️ ขอบเขตที่วาด
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <span style="width:10px;height:10px;border-radius:50%;background:#0ea5e9;display:inline-block;flex-shrink:0"></span>
                <span>${p.name ?? "ขอบเขตการค้นหา"}</span>
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on("mouseenter", "plots-detected-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "plots-detected-fill", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "plots-boundary-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "plots-boundary-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      /* ── Fit bounds to all features ── */
      const allCoords: [number, number][] = [];
      const walkCoords = (c: unknown): void => {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === "number" && typeof c[1] === "number") {
          allCoords.push([c[0] as number, c[1] as number]);
          return;
        }
        for (const child of c) walkCoords(child);
      };

      [...detectedFeatures, ...boundaryFeatures].forEach((f) => {
        if ("coordinates" in f.geometry)
          walkCoords((f.geometry as GeoJSON.Geometry & { coordinates?: unknown }).coordinates);
      });

      if (allCoords.length > 0) {
        const lngs = allCoords.map(([x]) => x);
        const lats = allCoords.map(([, y]) => y);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, duration: 1000, maxZoom: 15 }
        );
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [plots]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div id="dashboard-map" ref={containerRef} style={{ height: "100%" }} />

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 40, left: 12,
        background: "rgba(255,255,255,0.95)", borderRadius: 10,
        padding: "8px 14px", boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
        fontSize: 12, lineHeight: 1.8, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 3, borderRadius: 2, background: "#0284c7", display: "inline-block", borderTop: "2px dashed #0284c7" }} />
          <span style={{ color: "#0369a1", fontWeight: 600 }}>ขอบเขตที่วาด</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 10, borderRadius: 3, background: "rgba(34,197,94,0.5)", border: "2px solid #16a34a", display: "inline-block" }} />
          <span style={{ color: "#15803d", fontWeight: 600 }}>แปลงที่ตรวจจับ</span>
        </div>
      </div>
    </div>
  );
}
