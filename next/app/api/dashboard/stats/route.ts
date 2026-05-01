import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verifyToken, AUTH_COOKIE } from "@/lib/jwt";

/**
 * GET /api/dashboard/stats
 * Returns aggregate stats from rubber_plots for the dashboard.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Aggregate stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)::int                                           AS total_plots,
        COALESCE(SUM(
          COALESCE(NULLIF(split_part(grow_area, '-', 1), ''), '0')::numeric +
          COALESCE(NULLIF(split_part(grow_area, '-', 2), ''), '0')::numeric / 4.0 +
          COALESCE(NULLIF(split_part(grow_area, '-', 3), ''), '0')::numeric / 400.0
        ), 0)                                                   AS total_area_rai,
        COALESCE(SUM(NULLIF(gee_carbon::text, '')::numeric), 0) AS total_carbon
      FROM rubber_plots
    `);

    // Age distribution (for CarbonAgeChart) — group by rubber_age bucket
    const ageResult = await pool.query(`
      SELECT
        COALESCE(NULLIF(rubber_age::text, '')::numeric, NULLIF(gee_age::text, '')::numeric, 0)::int AS age,
        COALESCE(SUM(NULLIF(gee_carbon::text, '')::numeric), 0)                                     AS carbon,
        COUNT(*)::int                                                                               AS plot_count
      FROM rubber_plots
      WHERE COALESCE(NULLIF(rubber_age::text, ''), NULLIF(gee_age::text, '')) IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);

    // Map data: centroids of plots (limit 2000 for performance)
    const mapResult = await pool.query(`
      SELECT
        id,
        farm_name,
        (
          COALESCE(NULLIF(split_part(grow_area, '-', 1), ''), '0')::numeric +
          COALESCE(NULLIF(split_part(grow_area, '-', 2), ''), '0')::numeric / 4.0 +
          COALESCE(NULLIF(split_part(grow_area, '-', 3), ''), '0')::numeric / 400.0
        )                                                  AS area_rai,
        COALESCE(NULLIF(gee_carbon::text, '')::numeric, 0) AS carbon,
        ST_AsGeoJSON(geom)::json AS geojson
      FROM rubber_plots
      WHERE geom IS NOT NULL
      LIMIT 2000
    `);

    const stats = statsResult.rows[0] ?? {};

    return NextResponse.json({
      totalPlots: stats.total_plots ?? 0,
      totalAreaRai: parseFloat(String(stats.total_area_rai ?? 0)),
      totalCarbon: parseFloat(String(stats.total_carbon ?? 0)),
      ageData: ageResult.rows.map((r) => ({
        age: Number(r.age),
        carbon: parseFloat(String(r.carbon)),
        plotCount: Number(r.plot_count),
      })),
      mapPlots: mapResult.rows.map((r) => ({
        id: r.id,
        name: r.farm_name ?? "ไม่มีชื่อ",
        areaRai: parseFloat(String(r.area_rai)),
        carbonTotal: parseFloat(String(r.carbon)),
        geojson: r.geojson,
      })),
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
