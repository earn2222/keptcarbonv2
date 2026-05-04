"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type MapPlot = {
  id: number | string;
  name: string;
  amphoe?: string;
  areaRai: number;
  carbonTotal: number;
  age?: number;
  geojson: GeoJSON.GeoJSON;
  boundaryGeojson?: GeoJSON.GeoJSON | null;
};

type Bbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export default function DashboardMap({
  plots,
  bbox,
}: {
  plots: MapPlot[];
  bbox?: Bbox | null;
}) {
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
      "bottom-right",
    );

    map.on("load", () => {
      const detectedFeatures: GeoJSON.Feature[] = [];
      const boundaryFeatures: GeoJSON.Feature[] = [];
      const seenBoundaries = new Set<string>();

      for (const plot of plots) {
        const geo = plot.geojson;
        if (geo) {
          detectedFeatures.push({
            type: "Feature",
            geometry: geo as GeoJSON.Geometry,
            properties: {
              name: plot.name ?? "แปลงไม่มีชื่อ",
              amphoe: plot.amphoe ?? "",
              area: plot.areaRai ?? 0,
              carbon: plot.carbonTotal ?? 0,
              age: plot.age ?? 0,
            },
          });
        }
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
      }

      /* ── Boundary layer (drawn / SHP imported) ── */
      map.addSource("plots-boundary", {
        type: "geojson",
        data: { type: "FeatureCollection", features: boundaryFeatures },
      });
      map.addLayer({
        id: "plots-boundary-fill",
        type: "fill",
        source: "plots-boundary",
        paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.10 },
      });
      map.addLayer({
        id: "plots-boundary-line",
        type: "line",
        source: "plots-boundary",
        paint: {
          "line-color": "#0284c7",
          "line-width": 2,
          "line-dasharray": [6, 3],
        },
      });

      /* ── Detected plots — gradient by carbon level ── */
      map.addSource("plots-detected", {
        type: "geojson",
        data: { type: "FeatureCollection", features: detectedFeatures },
      });
      map.addLayer({
        id: "plots-detected-fill",
        type: "fill",
        source: "plots-detected",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "carbon"], 0],
            0,   "#bbf7d0",
            50,  "#4ade80",
            200, "#16a34a",
            600, "#166534",
          ],
          "fill-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "plots-detected-line",
        type: "line",
        source: "plots-detected",
        paint: { "line-color": "#15803d", "line-width": 1.2, "line-opacity": 0.7 },
      });

      /* ── Popup ── */
      map.on("click", "plots-detected-fill", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties ?? {};
        new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:inherit;font-size:13px;line-height:1.6">
              <div style="font-weight:800;font-size:14px;color:#15803d;margin-bottom:6px">
                🌿 ${p.name ?? "แปลงไม่มีชื่อ"}
              </div>
              ${p.amphoe ? `<div style="color:#6b7280;font-size:11px;margin-bottom:4px">อ.${p.amphoe}</div>` : ""}
              <div style="display:flex;flex-direction:column;gap:3px">
                <div>พื้นที่: <b>${Number(p.area).toFixed(2)} ไร่</b></div>
                <div>คาร์บอน: <b>${Number(p.carbon).toFixed(1)} tCO₂</b></div>
                ${Number(p.age) > 0 ? `<div>อายุยาง: <b>${p.age} ปี</b></div>` : ""}
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

      /* ── Fit bounds ── */
      if (bbox) {
        map.fitBounds(
          [[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]],
          { padding: 60, duration: 1000, maxZoom: 13 },
        );
      } else if (detectedFeatures.length > 0) {
        // Fallback: walk a sample of coords
        const sample = detectedFeatures.slice(0, 50);
        const allCoords: [number, number][] = [];
        const walk = (c: unknown): void => {
          if (!Array.isArray(c)) return;
          if (typeof c[0] === "number" && typeof c[1] === "number") {
            allCoords.push([c[0] as number, c[1] as number]);
            return;
          }
          for (const child of c) walk(child);
        };
        sample.forEach((f) => {
          if ("coordinates" in f.geometry)
            walk((f.geometry as GeoJSON.Geometry & { coordinates?: unknown }).coordinates);
        });
        if (allCoords.length > 0) {
          const lngs = allCoords.map(([x]) => x);
          const lats = allCoords.map(([, y]) => y);
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 60, duration: 1000, maxZoom: 13 },
          );
        }
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [plots, bbox]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div id="dashboard-map" ref={containerRef} style={{ height: "100%" }} />

      {/* Carbon gradient legend */}
      <div className="dv3-map-legend">
        <div className="dv3-legend-title">ระดับคาร์บอน (tCO₂)</div>
        <div className="dv3-legend-gradient" />
        <div className="dv3-legend-scale">
          <span>ต่ำ</span>
          <span>กลาง</span>
          <span>สูง</span>
        </div>
      </div>
    </div>
  );
}
