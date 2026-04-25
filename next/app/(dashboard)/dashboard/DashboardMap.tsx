"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Plot } from "@/lib/auth";

const RAYONG_BOUNDARY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [101.0, 12.4],
            [101.8, 12.4],
            [102.0, 12.6],
            [101.9, 13.0],
            [101.5, 13.1],
            [101.0, 13.0],
            [100.8, 12.8],
            [100.9, 12.5],
            [101.0, 12.4],
          ],
        ],
      },
      properties: { name: "ระยอง" },
    },
  ],
};

export default function DashboardMap({ plots }: { plots: Plot[] }) {
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
      zoom: 9,
      attributionControl: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("rayong", { type: "geojson", data: RAYONG_BOUNDARY });
      map.addLayer({
        id: "rayong-outline",
        type: "line",
        source: "rayong",
        paint: { "line-color": "#84a98c", "line-width": 2, "line-dasharray": [4, 2] },
      });
      map.addLayer({
        id: "rayong-fill",
        type: "fill",
        source: "rayong",
        paint: { "fill-color": "#84a98c", "fill-opacity": 0.05 },
      });

      plots.forEach((plot, idx) => {
        const geo = plot.geojson as GeoJSON.GeoJSON | undefined;
        if (!geo) return;
        const sourceId = `plot-${idx}`;
        map.addSource(sourceId, { type: "geojson", data: geo });
        map.addLayer({
          id: `plot-fill-${idx}`,
          type: "fill",
          source: sourceId,
          paint: { "fill-color": "#84a98c", "fill-opacity": 0.3 },
        });
        map.addLayer({
          id: `plot-line-${idx}`,
          type: "line",
          source: sourceId,
          paint: { "line-color": "#84a98c", "line-width": 2 },
        });
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [plots]);

  return <div id="dashboard-map" ref={containerRef} />;
}
