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
  flyToCenter,
  flyZoom = 11,
}: {
  plots: MapPlot[];
  bbox?: Bbox | null;
  flyToCenter?: [number, number] | null;
  flyZoom?: number;
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
        paint: { "fill-color": "#f97316", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "plots-boundary-line",
        type: "line",
        source: "plots-boundary",
        paint: {
          "line-color": "#ea580c",
          "line-width": 2.5,
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
          "fill-color": "#2d9e5f",
          "fill-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "plots-detected-line",
        type: "line",
        source: "plots-detected",
        paint: { "line-color": "#15803d", "line-width": 1.2, "line-opacity": 0.7 },
      });



      /* ── Fit bounds ── */
      if (bbox) {
        map.fitBounds(
          [[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]],
          { padding: 60, duration: 1000, maxZoom: 16 },
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
            { padding: 60, duration: 1000, maxZoom: 16 },
          );
        }
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [plots, bbox]);

  useEffect(() => {
    if (!mapRef.current || !flyToCenter) return;
    mapRef.current.flyTo({ center: flyToCenter, zoom: flyZoom, duration: 1000 });
  }, [flyToCenter, flyZoom]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div id="dashboard-map" ref={containerRef} style={{ height: "100%" }} />


    </div>
  );
}
