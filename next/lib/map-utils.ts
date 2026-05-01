export type LngLat = [number, number];

export function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function isMobile() {
  return typeof window !== "undefined" && window.innerWidth <= 768;
}

// Equal-area-ish polygon area in m^2 (matches the original map-draw.html algorithm).
export function polygonAreaM2(coords: LngLat[]): number {
  let a = 0;
  const R = 6371000;
  for (let i = 0; i < coords.length; i++) {
    const [lo1, la1] = coords[i];
    const [lo2, la2] = coords[(i + 1) % coords.length];
    const x1 = ((lo1 * Math.PI) / 180) * R * Math.cos((la1 * Math.PI) / 180);
    const y1 = ((la1 * Math.PI) / 180) * R;
    const x2 = ((lo2 * Math.PI) / 180) * R * Math.cos((la2 * Math.PI) / 180);
    const y2 = ((la2 * Math.PI) / 180) * R;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function carbonForAge(age: number, trees: number) {
  const H = Math.min(2.0 + 1.8 * age, 28);
  const D = Math.min(3 + 4.5 * age, 60);
  const AGB = 0.1284 * D * D * H * 0.001; // tonnes/tree
  const BGB = AGB * 0.26;
  const co2 = (AGB + BGB) * 0.47 * 3.67 * trees; // tCO2 total
  return { H, D, AGB, BGB, co2 };
}

export function validateAndFixGeoJSON(feature: GeoJSON.Feature): GeoJSON.Feature {
  const f = JSON.parse(JSON.stringify(feature)) as GeoJSON.Feature;

  const walk = (coords: any) => {
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0];
      const y = coords[1];

      // Check for UTM or other large projected coordinates (> 2000 is safe since max lng is 180)
      if (Math.abs(x) > 2000 || Math.abs(y) > 2000) {
        throw new Error("ไฟล์ของคุณอาจใช้พิกัด UTM หรือโปรเจกชันอื่น กรุณาใช้ไฟล์ที่เป็น WGS84 (EPSG:4326) เท่านั้น");
      }

      // Check for swapped Lng/Lat specifically for Thailand context
      // Thailand: Lng ~100, Lat ~13
      // If swapped: Lng ~13, Lat ~100 -> Lat > 90 (Invalid for Mapbox/MapLibre)
      if (Math.abs(y) > 90 && Math.abs(x) <= 90) {
        coords[0] = y; // Lng
        coords[1] = x; // Lat
      }
      return;
    }
    if (Array.isArray(coords)) {
      for (const c of coords) walk(c);
    }
  };

  if (f.geometry) {
    walk((f.geometry as any).coordinates);
  }
  return f;
}
