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
