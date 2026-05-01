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
      const importedFeatures: GeoJSON.Feature[] = [];

      plots.forEach((plot) => {
        const geo = plot.geojson as GeoJSON.GeoJSON | undefined;
        if (!geo) return;

        const feature: GeoJSON.Feature = {
          type: "Feature",
          geometry: geo as GeoJSON.Geometry,
          properties: {
            name: plot.name ?? "แปลงไม่มีชื่อ",
            area: plot.areaRai ?? 0,
            carbon: plot.carbonTotal ?? 0,
          },
        };
        importedFeatures.push(feature);
      });

      const importedFC: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: importedFeatures,
      };

      map.addSource("plots-imported", { type: "geojson", data: importedFC });
      map.addLayer({
        id: "plots-imported-fill",
        type: "fill",
        source: "plots-imported",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "plots-imported-line",
        type: "line",
        source: "plots-imported",
        paint: { "line-color": "#16a34a", "line-width": 2.5 },
      });

      // Click popup
      map.on("click", "plots-imported-fill", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties ?? {};
        new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:inherit;font-size:13px;line-height:1.55">
              <div style="font-weight:800;font-size:14px;color:#15803d;margin-bottom:6px">
                🌿 ${p.name ?? "แปลงไม่มีชื่อ"}
              </div>
              <div>พื้นที่: <b>${Number(p.area).toFixed(2)} ไร่</b></div>
              <div>คาร์บอน: <b>${Number(p.carbon).toFixed(1)} tCO₂</b></div>
            </div>
          `)
          .addTo(map);
      });

      map.on("mouseenter", "plots-imported-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "plots-imported-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      // Fit to all plots if any
      if (plots.length > 0) {
        const allCoords: [number, number][] = [];
        plots.forEach((plot) => {
          const geo = plot.geojson as GeoJSON.GeoJSON | undefined;
          if (!geo) return;
          const walkCoords = (c: unknown): void => {
            if (!Array.isArray(c)) return;
            if (typeof c[0] === "number" && typeof c[1] === "number") {
              allCoords.push([c[0] as number, c[1] as number]);
              return;
            }
            for (const child of c) walkCoords(child);
          };
          if ("coordinates" in geo) walkCoords((geo as GeoJSON.Geometry & { coordinates?: unknown }).coordinates);
          else if ("features" in geo) {
            for (const f of (geo as GeoJSON.FeatureCollection).features) {
              if ("coordinates" in f.geometry) walkCoords((f.geometry as GeoJSON.Geometry & { coordinates?: unknown }).coordinates);
            }
          }
        });

        if (allCoords.length > 0) {
          const lngs = allCoords.map(([x]) => x);
          const lats = allCoords.map(([, y]) => y);
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 60, duration: 1000, maxZoom: 15 }
          );
        }
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [plots]);

  return <div id="dashboard-map" ref={containerRef} />;
}
