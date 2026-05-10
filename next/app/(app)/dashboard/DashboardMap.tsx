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

export type DistrictMarker = {
  id: string;
  name: string;
  carbon: number;
  plots: number;
  lat: number;
  lng: number;
};

type Bbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

// Carbon color stops (low → high)
const CARBON_MIN = 27000;
const CARBON_MAX = 120000;

export default function DashboardMap({
  plots,
  bbox,
  flyToCenter,
  flyZoom = 11,
  districts = [],
  selectedDistrictId,
  onSelectDistrict,
}: {
  plots: MapPlot[];
  bbox?: Bbox | null;
  flyToCenter?: [number, number] | null;
  flyZoom?: number;
  districts?: DistrictMarker[];
  selectedDistrictId?: string;
  onSelectDistrict?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  // Ref so the click handler always has the latest callback (avoids stale closure)
  const onSelectRef = useRef(onSelectDistrict);
  onSelectRef.current = onSelectDistrict;

  // ── Map initialisation (runs once) ──────────────────────────────────────────
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
            maxzoom: 18,
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
      // ── User plot layers (for reuse on other pages) ────────────────────────
      const detectedFeatures: GeoJSON.Feature[] = [];
      const boundaryFeatures: GeoJSON.Feature[] = [];
      const seenBoundaries = new Set<string>();

      for (const plot of plots) {
        if (plot.geojson) {
          detectedFeatures.push({
            type: "Feature",
            geometry: plot.geojson as GeoJSON.Geometry,
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
            boundaryFeatures.push({ type: "Feature", geometry: bnd, properties: { name: plot.name } });
          }
        }
      }

      map.addSource("plots-boundary", { type: "geojson", data: { type: "FeatureCollection", features: boundaryFeatures } });
      map.addLayer({ id: "plots-boundary-fill", type: "fill", source: "plots-boundary", paint: { "fill-color": "#f97316", "fill-opacity": 0.12 } });
      map.addLayer({ id: "plots-boundary-line", type: "line", source: "plots-boundary", paint: { "line-color": "#ea580c", "line-width": 2.5 } });
      map.addSource("plots-detected", { type: "geojson", data: { type: "FeatureCollection", features: detectedFeatures } });
      map.addLayer({ id: "plots-detected-fill", type: "fill", source: "plots-detected", paint: { "fill-color": "#2d9e5f", "fill-opacity": 0.55 } });
      map.addLayer({ id: "plots-detected-line", type: "line", source: "plots-detected", paint: { "line-color": "#15803d", "line-width": 1.2, "line-opacity": 0.7 } });

      // ── District markers ───────────────────────────────────────────────────
      if (districts.length > 0) {
        const features: GeoJSON.Feature[] = districts.map(d => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [d.lng, d.lat] } as GeoJSON.Point,
          properties: { id: d.id, name: d.name, carbon: d.carbon, plots: d.plots },
        }));

        map.addSource("districts", {
          type: "geojson",
          data: { type: "FeatureCollection", features },
        });

        // Soft glow ring (pulse effect)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addLayer({
          id: "districts-glow",
          type: "circle",
          source: "districts",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "carbon"], CARBON_MIN, 26, CARBON_MAX, 50],
            "circle-color": ["interpolate", ["linear"], ["get", "carbon"], CARBON_MIN, "#4ade80", 75000, "#16a34a", CARBON_MAX, "#14532d"],
            "circle-opacity": 0.2,
            "circle-blur": 1.4,
          },
        } as any); // eslint-disable-line

        // Main circle — colored by carbon level
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addLayer({
          id: "districts-circle",
          type: "circle",
          source: "districts",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "carbon"],
              CARBON_MIN, 13,
              50000, 18,
              80000, 24,
              CARBON_MAX, 30,
            ],
            "circle-color": ["interpolate", ["linear"], ["get", "carbon"],
              CARBON_MIN, "#4ade80",
              40000, "#34d399",
              60000, "#22c55e",
              90000, "#16a34a",
              CARBON_MAX, "#14532d",
            ],
            "circle-opacity": 0.92,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.95,
          },
        } as any); // eslint-disable-line

        // Selected district highlight ring (amber)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addLayer({
          id: "districts-selected",
          type: "circle",
          source: "districts",
          filter: ["==", ["get", "id"], ""],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "carbon"],
              CARBON_MIN, 20, CARBON_MAX, 38,
            ],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-width": 3.5,
            "circle-stroke-color": "#fbbf24",
            "circle-stroke-opacity": 0.95,
          },
        } as any); // eslint-disable-line

        // Click to select district
        map.on("click", "districts-circle", (e) => {
          const props = e.features?.[0]?.properties as { id?: string } | undefined;
          if (props?.id) onSelectRef.current?.(props.id);
        });
        map.on("mouseenter", "districts-circle", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "districts-circle", () => { map.getCanvas().style.cursor = ""; });

        // HTML label markers below each circle
        for (const d of districts) {
          const radius = Math.round(13 + 17 * (d.carbon - CARBON_MIN) / (CARBON_MAX - CARBON_MIN));
          const el = document.createElement("div");
          el.style.cssText = "text-align:center;pointer-events:none;";
          el.innerHTML = `
            <div style="font-size:11px;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.95),0 0 10px rgba(0,0,0,0.6);white-space:nowrap;line-height:1.4">${d.name}</div>
            <div style="font-size:9.5px;font-weight:700;color:#86efac;text-shadow:0 1px 3px rgba(0,0,0,0.95);white-space:nowrap">${(d.carbon / 1000).toFixed(0)}k tCO₂</div>
          `;
          new maplibregl.Marker({ element: el, anchor: "top", offset: [0, radius + 5] })
            .setLngLat([d.lng, d.lat])
            .addTo(map);
        }
      }

      // ── Fit bounds ─────────────────────────────────────────────────────────
      if (bbox) {
        map.fitBounds([[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]], { padding: 60, duration: 1000, maxZoom: 16 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [plots, bbox, districts]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update selected district ring when selection changes ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (map.getLayer("districts-selected")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.setFilter("districts-selected", ["==", ["get", "id"], selectedDistrictId ?? ""] as any);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [selectedDistrictId]);

  // ── Fly to selected district ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !flyToCenter) return;
    mapRef.current.flyTo({ center: flyToCenter, zoom: flyZoom, duration: 1000 });
  }, [flyToCenter, flyZoom]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div ref={containerRef} style={{ height: "100%" }} />

      {/* ── Map legend ──────────────────────────────────────────────────────── */}
      <div style={{
        position: "absolute",
        bottom: 48,
        left: 12,
        background: "rgba(10,18,35,0.9)",
        backdropFilter: "blur(12px)",
        borderRadius: 13,
        padding: "12px 16px",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
        fontFamily: "'Noto Sans Thai','Inter',sans-serif",
        minWidth: 168,
      }}>
        {/* Header */}
        <div style={{ fontSize: 10, fontWeight: 800, color: "#6ee7b7", marginBottom: 9, letterSpacing: 0.6 }}>
          คาร์บอนสะสม (tCO₂)
        </div>

        {/* Carbon gradient bar */}
        <div style={{ width: "100%", height: 7, borderRadius: 4, background: "linear-gradient(90deg,#4ade80,#22c55e,#16a34a,#14532d)", marginBottom: 4 }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", marginBottom: 12 }}>
          <span>27k (น้อย)</span>
          <span>118k (มาก)</span>
        </div>

        {/* Symbol descriptions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg,#4ade80,#14532d)",
              border: "2px solid rgba(255,255,255,0.7)",
            }} />
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>แปลงยางพาราต่ออำเภอ</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: "rgba(74,222,128,0.15)",
              border: "1.5px solid rgba(74,222,128,0.35)",
              marginLeft: 3,
            }} />
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>ขนาดวงกลม ∝ ปริมาณคาร์บอน</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 13, height: 13, borderRadius: "50%", flexShrink: 0,
              background: "transparent",
              border: "2.5px solid #fbbf24",
              marginLeft: 1,
            }} />
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>อำเภอที่เลือกอยู่</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 13, height: 13, borderRadius: "50%", flexShrink: 0,
              background: "rgba(74,222,128,0.2)",
              border: "1px solid rgba(74,222,128,0.3)",
              marginLeft: 1,
            }} />
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>คลิกเพื่อเลือกอำเภอ</span>
          </div>
        </div>
      </div>
    </div>
  );
}
