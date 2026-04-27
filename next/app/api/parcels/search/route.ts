import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verifyToken, AUTH_COOKIE } from "@/lib/jwt";

type Relation = "intersects" | "touches" | "contains";

const RELATIONS: Relation[] = ["intersects", "touches", "contains"];
const HARD_LIMIT = 2000;

function buildWhere(rel: Relation): string {
  const g = "ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)";
  switch (rel) {
    case "touches":
      return `ST_Touches(geom, ${g})`;
    case "contains":
      return `ST_Within(geom, ${g})`;
    case "intersects":
    default:
      return `ST_Intersects(geom, ${g})`;
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { geometry?: unknown; relation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { geometry, relation } = body;

  if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
    return NextResponse.json(
      { error: "geometry must be a GeoJSON geometry object" },
      { status: 400 },
    );
  }

  const rel: Relation = (RELATIONS as string[]).includes(relation as string)
    ? (relation as Relation)
    : "intersects";

  const sql = `
    SELECT id, farm_name, farm_idc, app_no, land_seq, land_right, land_name,
           land_moo, land_vill, tambon, amphoe_t, province,
          grow_year, rip_type, grow_area,
           ST_AsGeoJSON(geom)::json AS geometry
    FROM rubber_plots
    WHERE ${buildWhere(rel)}
    LIMIT ${HARD_LIMIT}
  `;

  try {
    const result = await pool.query(sql, [JSON.stringify(geometry)]);
    const features = result.rows.map((row: Record<string, unknown>) => {
      const { geometry: g, ...properties } = row;
      const geometry = typeof g === "string" ? JSON.parse(g) : g;
      return {
        type: "Feature" as const,
        geometry,
        properties,
      };
    });
    return NextResponse.json({
      type: "FeatureCollection",
      features,
      count: features.length,
      relation: rel,
      truncated: features.length >= HARD_LIMIT,
    });
  } catch (err) {
    console.error("Parcel search error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
