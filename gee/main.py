"""
GEE NDVI microservice
---------------------
Exposes:
  GET  /health                              – liveness probe
  POST /ndvi                                – compute mean NDVI for a GeoJSON geometry
  POST /rubber-age/bfast-raster/generate   – generate Rayong province rubber-age raster via GEE
  GET  /rubber-age/bfast-raster/status/{task_id} – poll GEE export task status
  POST /rubber-age/from-raster             – sample local raster at a drawn parcel geometry

Environment variables:
  GEE_KEY_FILE       Path to the service-account JSON key file (default: /run/secrets/gee_key.json)
  GEE_PROJECT_ID     GCP project ID that has Earth Engine API enabled
  RUBBER_DATA_ROOT   Root directory for rubber-age data (default: /workspace/data)
"""

import json
import logging
import os
import re
import subprocess
import sys
import urllib.request
from csv import DictReader
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
import numpy as np
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ee_ready = False


def _init_ee() -> bool:
    key_file = os.environ.get(
        "GEE_KEY_FILE", "/run/secrets/gee_key.json").strip()
    project = os.environ.get("GEE_PROJECT_ID", "").strip()

    if not os.path.isfile(key_file):
        logger.warning(
            "GEE key file not found at %s — Earth Engine will NOT be initialized. "
            "Mount the service-account JSON at that path (see docker-compose.yml).",
            key_file,
        )
        return False

    try:
        import ee
        from google.oauth2.service_account import Credentials

        with open(key_file, "r") as f:
            key_dict = json.load(f)
        credentials = Credentials.from_service_account_info(
            key_dict,
            scopes=["https://www.googleapis.com/auth/earthengine"],
        )
        ee.Initialize(
            credentials,
            project=project or key_dict.get("project_id"),
        )
        logger.info(
            "Earth Engine initialized (project=%s)",
            project or key_dict.get("project_id", "(from key)"),
        )
        return True
    except Exception as exc:
        logger.error("Earth Engine initialization failed: %s", exc)
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ee_ready
    ee_ready = _init_ee()
    yield


app = FastAPI(title="KeptCarbon GEE Service", lifespan=lifespan)
AGE_SCRIPT = Path(__file__).with_name("rubber_planting_year_detection.py")
DATA_ROOT = Path(os.environ.get(
    "RUBBER_DATA_ROOT", "/workspace/data")).resolve()


# ── Schema ──────────────────────────────────────────────────────────────────

class NDVIRequest(BaseModel):
    geometry: dict
    start_date: str | None = None
    end_date: str | None = None


class AgeDetectionRequest(BaseModel):
    plots_path: str | None = Field(
        default=None,
        description="Path to GeoJSON/Shapefile under RUBBER_DATA_ROOT",
    )
    plots_geojson: dict | None = Field(
        default=None,
        description="Optional inline GeoJSON FeatureCollection of plot polygons",
    )
    s2_dir: str = Field(...,
                        description="Directory path containing Sentinel-2 monthly rasters")
    s1_dir: str | None = Field(
        default=None, description="Optional Sentinel-1 monthly raster directory")
    plot_id_field: str = "plot_id"
    start_month: str = "2017-01"
    end_month: str | None = None
    smooth_method: str = "savgol"
    smooth_window: int = 7
    smooth_polyorder: int = 2
    rupture_model: str = "rbf"
    rupture_penalty: float = 6.0
    current_year: int = Field(default_factory=lambda: datetime.utcnow().year)
    max_plots: int | None = None
    output_tag: str | None = None


class BFASTFeature(BaseModel):
    plot_id: str
    geometry: dict


class BFASTAgeRequest(BaseModel):
    features: list[BFASTFeature]
    start_date: str = "2017-01-01"
    end_date: str | None = None
    current_year: int = Field(default_factory=lambda: datetime.utcnow().year)
    max_plots: int = 50


def _ensure_data_root() -> None:
    if not DATA_ROOT.exists():
        raise HTTPException(
            status_code=500,
            detail=f"RUBBER_DATA_ROOT does not exist in container: {DATA_ROOT}",
        )


def _resolve_under_data_root(value: str, *, must_exist: bool, expect_dir: bool) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = DATA_ROOT / candidate

    resolved = candidate.resolve()
    try:
        resolved.relative_to(DATA_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Path must be under RUBBER_DATA_ROOT ({DATA_ROOT}): {value}"
            ),
        ) from exc

    if must_exist and not resolved.exists():
        raise HTTPException(
            status_code=400, detail=f"Path not found: {resolved}")

    if must_exist and expect_dir and not resolved.is_dir():
        raise HTTPException(
            status_code=400, detail=f"Expected directory: {resolved}")

    if must_exist and not expect_dir and not resolved.is_file():
        raise HTTPException(
            status_code=400, detail=f"Expected file: {resolved}")

    return resolved


def _safe_output_tag(value: str | None) -> str:
    base = value or datetime.utcnow().strftime("run-%Y%m%d-%H%M%S")
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", base).strip("-")[:80] or "run"


def _read_summary_rows(summary_csv: Path, limit: int = 200) -> list[dict]:
    rows: list[dict] = []
    with summary_csv.open("r", encoding="utf-8") as f:
        reader = DictReader(f)
        for i, row in enumerate(reader):
            rows.append(row)
            if i + 1 >= limit:
                break
    return rows


def _save_inline_plots_geojson(plots_geojson: dict, output_dir: Path) -> Path:
    if plots_geojson.get("type") != "FeatureCollection":
        raise HTTPException(
            status_code=400,
            detail="plots_geojson must be a GeoJSON FeatureCollection",
        )
    features = plots_geojson.get("features")
    if not isinstance(features, list) or not features:
        raise HTTPException(
            status_code=400,
            detail="plots_geojson.features must be a non-empty array",
        )

    plots_file = output_dir / "selected_parcels.geojson"
    with plots_file.open("w", encoding="utf-8") as f:
        json.dump(plots_geojson, f, ensure_ascii=False)
    return plots_file


def _read_indicator_rows(
    timeseries_csv: Path,
    summary_csv: Path,
    limit: int = 500,
) -> list[dict]:
    summary_by_plot: dict[str, dict] = {}
    with summary_csv.open("r", encoding="utf-8") as f:
        for row in DictReader(f):
            summary_by_plot[str(row.get("plot_id", ""))] = row

    latest_by_plot: dict[str, dict] = {}
    with timeseries_csv.open("r", encoding="utf-8") as f:
        for row in DictReader(f):
            pid = str(row.get("plot_id", ""))
            if not pid:
                continue
            cur = latest_by_plot.get(pid)
            date = str(row.get("date", ""))
            if cur is None or date > str(cur.get("date", "")):
                latest_by_plot[pid] = row

    merged: list[dict] = []
    for pid, row in latest_by_plot.items():
        summary = summary_by_plot.get(pid, {})
        merged.append({
            "plot_id": pid,
            "date": row.get("date"),
            "NDVI": row.get("NDVI_SM") or row.get("NDVI"),
            "NDBI": row.get("NDBI_SM") or row.get("NDBI"),
            "EVI": row.get("EVI_SM") or row.get("EVI"),
            "VV": row.get("VV_SM") or row.get("VV"),
            "VH": row.get("VH_SM") or row.get("VH"),
            "planting_year": summary.get("planting_year"),
            "age_2026": summary.get("age_2026"),
            "confidence_score": summary.get("confidence_score"),
        })

    merged.sort(key=lambda r: str(r.get("plot_id", "")))
    return merged[:limit]


def _month_starts(start_date: str, end_date: str) -> list[datetime]:
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    cur = datetime(start.year, start.month, 1)
    months: list[datetime] = []
    while cur <= end:
        months.append(cur)
        if cur.month == 12:
            cur = datetime(cur.year + 1, 1, 1)
        else:
            cur = datetime(cur.year, cur.month + 1, 1)
    return months


def _next_month(dt: datetime) -> datetime:
    if dt.month == 12:
        return datetime(dt.year + 1, 1, 1)
    return datetime(dt.year, dt.month + 1, 1)


def _linear_fill_nan(arr: np.ndarray) -> np.ndarray:
    if arr.size == 0:
        return arr
    x = np.arange(arr.size)
    valid = np.isfinite(arr)
    if valid.sum() == 0:
        return np.zeros_like(arr)
    if valid.sum() == 1:
        return np.full_like(arr, arr[valid][0])
    return np.interp(x, x[valid], arr[valid])


def _monthly_ndvi_from_gee(geom: dict, start_date: str, end_date: str) -> tuple[list[datetime], list[float | None], list[int]]:
    import ee

    months = _month_starts(start_date, end_date)
    ee_geom = ee.Geometry(geom)
    ndvi_values: list[float | None] = []
    image_counts: list[int] = []

    for m in months:
        m_next = _next_month(m)
        start_s = m.strftime("%Y-%m-%d")
        end_s = m_next.strftime("%Y-%m-%d")

        s2 = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterDate(start_s, end_s)
            .filterBounds(ee_geom)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 40))
        )
        count = int(s2.size().getInfo())

        if count > 0:
            ndvi_img = s2.median().normalizedDifference(["B8", "B4"])
        else:
            ls = (
                ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
                .filterDate(start_s, end_s)
                .filterBounds(ee_geom)
            )
            ls_count = int(ls.size().getInfo())
            count = ls_count
            if ls_count > 0:
                ndvi_img = ls.median().normalizedDifference(["SR_B5", "SR_B4"])
            else:
                ndvi_values.append(None)
                image_counts.append(0)
                continue

        stat = ndvi_img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=ee_geom,
            scale=20,
            maxPixels=int(1e8),
            bestEffort=True,
        )
        val = stat.getInfo().get("nd")
        ndvi_values.append(float(val) if val is not None else None)
        image_counts.append(count)

    return months, ndvi_values, image_counts


def _bfast_like_breakpoint(dates: list[datetime], ndvi_values: list[float | None]) -> dict:
    arr = np.array([np.nan if v is None else float(v)
                   for v in ndvi_values], dtype=float)
    valid_count = int(np.isfinite(arr).sum())
    if valid_count < 18:
        return {
            "break_idx": None,
            "confidence": 0.0,
            "reason": "insufficient_observations",
            "smoothed": _linear_fill_nan(arr).tolist(),
        }

    arr_filled = _linear_fill_nan(arr)
    kernel = np.array([0.25, 0.5, 0.25])
    smoothed = np.convolve(arr_filled, kernel, mode="same")

    months_num = np.array([d.month for d in dates])
    seasonal = np.zeros_like(smoothed)
    for m in range(1, 13):
        idx = np.where(months_num == m)[0]
        if idx.size:
            seasonal[idx] = smoothed[idx].mean()
    residual = smoothed - seasonal

    best_idx: int | None = None
    best_score = -1.0
    n = len(smoothed)

    for i in range(6, n - 6):
        pre = smoothed[i - 6:i]
        post = smoothed[i:i + 6]
        if pre.size < 6 or post.size < 6:
            continue

        pre_mean = float(pre.mean())
        post_mean = float(post.mean())
        level_jump = post_mean - pre_mean

        x = np.arange(6, dtype=float)
        pre_slope = float(np.polyfit(x, pre, 1)[0])
        post_slope = float(np.polyfit(x, post, 1)[0])
        slope_shift = post_slope - pre_slope

        pre_res = residual[i - 6:i]
        post_res = residual[i:i + 6]
        res_shift = float(post_res.mean() - pre_res.mean())

        pre_ok = 1.0 if pre_mean < 0.25 else 0.0
        post_ok = 1.0 if post_mean > 0.45 else 0.0

        score = (
            0.35 * pre_ok
            + 0.35 * post_ok
            + 0.20 * max(0.0, min(1.0, level_jump / 0.30))
            + 0.10 * max(0.0, min(1.0, (slope_shift + abs(res_shift)) / 0.06))
        )

        if score > best_score:
            best_score = score
            best_idx = i

    if best_idx is None or best_score < 0.35:
        return {
            "break_idx": None,
            "confidence": max(0.0, best_score),
            "reason": "no_clear_break",
            "smoothed": smoothed.tolist(),
        }

    return {
        "break_idx": best_idx,
        "confidence": float(round(min(1.0, best_score), 4)),
        "reason": "ok",
        "smoothed": smoothed.tolist(),
    }


# ── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "ee_ready": ee_ready}


@app.post("/ndvi")
def get_ndvi(req: NDVIRequest):
    """
    Compute mean NDVI over a GeoJSON geometry.
    Returns:
      ndvi         – float 0-1 or null (no imagery)
      source       – "Sentinel-2" | "Landsat-9" | null
      image_count  – number of images composited
      start_date / end_date
    """
    if not ee_ready:
        raise HTTPException(
            status_code=503,
            detail=(
                "Earth Engine is not initialized. "
                "Set GEE_KEY_FILE and GEE_PROJECT_ID environment variables."
            ),
        )

    import ee  # imported here so the service starts cleanly even if ee isn't installed

    end_dt = req.end_date or datetime.utcnow().strftime("%Y-%m-%d")
    start_dt = req.start_date or (
        datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")

    try:
        geom = ee.Geometry(req.geometry)

        # ── Sentinel-2 SR Harmonized ────────────────────────────────────────
        s2 = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterDate(start_dt, end_dt)
            .filterBounds(geom)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
        )
        img_count = s2.size().getInfo()

        if img_count > 0:
            ndvi_img = s2.median().normalizedDifference(["B8", "B4"])
            source = "Sentinel-2"
        else:
            # ── Landsat-9 C2 T1 L2 fallback ─────────────────────────────────
            ls = (
                ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
                .filterDate(start_dt, end_dt)
                .filterBounds(geom)
            )
            ls_count = ls.size().getInfo()
            if ls_count == 0:
                return {
                    "ndvi": None,
                    "source": None,
                    "image_count": 0,
                    "start_date": start_dt,
                    "end_date": end_dt,
                }
            ndvi_img = ls.median().normalizedDifference(["SR_B5", "SR_B4"])
            source = "Landsat-9"
            img_count = ls_count

        # ── reduceRegion ─────────────────────────────────────────────────────
        stats = ndvi_img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=20,
            maxPixels=int(1e8),
            bestEffort=True,
        )
        nd = stats.getInfo().get("nd")

        return {
            "ndvi": round(float(nd), 4) if nd is not None else None,
            "source": source,
            "image_count": img_count,
            "start_date": start_dt,
            "end_date": end_dt,
        }

    except Exception as exc:
        logger.error("NDVI computation error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/rubber-age/detect")
def detect_rubber_age(req: AgeDetectionRequest):
    """
    Run the rubber planting-year detection pipeline script and return summary rows.
    Paths are restricted under RUBBER_DATA_ROOT for safety.
    """
    _ensure_data_root()

    if not AGE_SCRIPT.exists():
        raise HTTPException(
            status_code=500, detail=f"Detection script not found: {AGE_SCRIPT}")

    if not req.plots_path and not req.plots_geojson:
        raise HTTPException(
            status_code=400,
            detail="Either plots_path or plots_geojson must be provided",
        )

    s2_dir = _resolve_under_data_root(
        req.s2_dir, must_exist=True, expect_dir=True)
    s1_dir = (
        _resolve_under_data_root(req.s1_dir, must_exist=True, expect_dir=True)
        if req.s1_dir
        else None
    )

    output_tag = _safe_output_tag(req.output_tag)
    output_dir = _resolve_under_data_root(
        f"age_detection_runs/{output_tag}",
        must_exist=False,
        expect_dir=True,
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    if req.plots_geojson:
        plots_path = _save_inline_plots_geojson(req.plots_geojson, output_dir)
    else:
        plots_path = _resolve_under_data_root(
            str(req.plots_path),
            must_exist=True,
            expect_dir=False,
        )

    end_month = req.end_month or datetime.utcnow().strftime("%Y-%m")
    python_bin = os.environ.get("PYTHON_BIN", sys.executable)

    cmd = [
        python_bin,
        str(AGE_SCRIPT),
        "--plots",
        str(plots_path),
        "--plot-id-field",
        req.plot_id_field,
        "--s2-dir",
        str(s2_dir),
        "--output-dir",
        str(output_dir),
        "--start",
        req.start_month,
        "--end",
        end_month,
        "--smooth-method",
        req.smooth_method,
        "--smooth-window",
        str(req.smooth_window),
        "--smooth-polyorder",
        str(req.smooth_polyorder),
        "--rupture-model",
        req.rupture_model,
        "--rupture-penalty",
        str(req.rupture_penalty),
        "--current-year",
        str(req.current_year),
    ]
    if s1_dir:
        cmd.extend(["--s1-dir", str(s1_dir)])
    if req.max_plots is not None:
        cmd.extend(["--max-plots", str(req.max_plots)])

    try:
        run = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504, detail="Age detection timed out after 60 minutes") from exc

    if run.returncode != 0:
        logger.error("Age detection failed: %s", run.stderr)
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Age detection pipeline failed",
                "stdout_tail": run.stdout[-4000:],
                "stderr_tail": run.stderr[-4000:],
            },
        )

    summary_csv = output_dir / "rubber_planting_year_summary.csv"
    compact_csv = output_dir / "rubber_planting_year_compact.csv"
    timeseries_csv = output_dir / "plot_monthly_timeseries.csv"
    charts_dir = output_dir / "charts"

    if not summary_csv.exists() or not compact_csv.exists():
        raise HTTPException(
            status_code=500,
            detail=(
                "Pipeline completed but expected output CSV files were not found. "
                f"Expected: {summary_csv} and {compact_csv}"
            ),
        )

    rows = _read_summary_rows(summary_csv, limit=200)
    indicators = _read_indicator_rows(
        timeseries_csv, summary_csv, limit=500) if timeseries_csv.exists() else []
    confidences = [
        float(r.get("confidence_score", 0) or 0)
        for r in rows
        if r.get("confidence_score") not in (None, "")
    ]
    detected_count = sum(1 for r in rows if r.get(
        "planting_year") not in (None, "", "nan"))

    return {
        "success": True,
        "run_id": output_tag,
        "paths": {
            "data_root": str(DATA_ROOT),
            "output_dir": str(output_dir),
            "summary_csv": str(summary_csv),
            "compact_csv": str(compact_csv),
            "timeseries_csv": str(timeseries_csv),
            "charts_dir": str(charts_dir),
        },
        "stats": {
            "returned_rows": len(rows),
            "detected_count": detected_count,
            "avg_confidence": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
        },
        "rows": rows,
        "indicators": indicators,
        "stdout_tail": run.stdout[-4000:],
    }


@app.post("/rubber-age/bfast")
def detect_rubber_age_bfast(req: BFASTAgeRequest):
    if not ee_ready:
        raise HTTPException(
            status_code=503,
            detail="Earth Engine is not initialized (missing GEE credentials)",
        )

    if not req.features:
        raise HTTPException(status_code=400, detail="features is required")

    end_date = req.end_date or datetime.utcnow().strftime("%Y-%m-%d")
    features = req.features[: max(1, min(req.max_plots, 300))]

    rows: list[dict] = []
    for item in features:
        try:
            dates, ndvi, image_counts = _monthly_ndvi_from_gee(
                item.geometry, req.start_date, end_date)
            bfast = _bfast_like_breakpoint(dates, ndvi)
            break_idx = bfast["break_idx"]

            planting_year = dates[break_idx].year if break_idx is not None else None
            age = req.current_year - planting_year if planting_year is not None else None

            latest_idx = None
            for i in range(len(ndvi) - 1, -1, -1):
                if ndvi[i] is not None:
                    latest_idx = i
                    break

            rows.append({
                "plot_id": item.plot_id,
                "planting_year": planting_year,
                "age": age,
                "confidence": bfast["confidence"],
                "breakpoint_date": dates[break_idx].strftime("%Y-%m-%d") if break_idx is not None else None,
                "ndvi_latest": round(float(ndvi[latest_idx]), 4) if latest_idx is not None and ndvi[latest_idx] is not None else None,
                "latest_month": dates[latest_idx].strftime("%Y-%m") if latest_idx is not None else None,
                "image_count_total": int(sum(image_counts)),
                "method": "GEE_BFAST_like",
                "reason": bfast["reason"],
            })
        except Exception as exc:
            logger.error(
                "BFAST age detection failed for plot_id=%s: %s", item.plot_id, exc)
            rows.append({
                "plot_id": item.plot_id,
                "planting_year": None,
                "age": None,
                "confidence": 0.0,
                "breakpoint_date": None,
                "ndvi_latest": None,
                "latest_month": None,
                "image_count_total": 0,
                "method": "GEE_BFAST_like",
                "reason": "error",
                "error": str(exc),
            })

    detected = sum(1 for r in rows if r.get("planting_year") is not None)
    avg_conf = round(float(sum(float(r.get("confidence", 0.0))
                     for r in rows) / len(rows)), 4) if rows else 0.0

    return {
        "success": True,
        "method": "GEE_BFAST_like",
        "start_date": req.start_date,
        "end_date": end_date,
        "count": len(rows),
        "detected": detected,
        "avg_confidence": avg_conf,
        "rows": rows,
    }


# ── Raster generation / sampling ─────────────────────────────────────────────

RASTER_FILENAME = "rayong_rubber_age.tif"
RASTERS_DIR = DATA_ROOT / "rasters"


class RasterGenerateRequest(BaseModel):
    province: str = Field(default="Rayong", description="Thai province name (FAO GAUL ADM1_NAME)")
    region_geojson: dict | None = Field(
        default=None,
        description="Optional GeoJSON geometry (Polygon/MultiPolygon). If provided, raster is generated for this region instead of province boundary.",
    )
    start_year: int = Field(default=2000, ge=1984, le=2100)
    end_year: int = Field(default_factory=lambda: datetime.utcnow().year, ge=1990, le=2100)
    current_year: int = Field(default_factory=lambda: datetime.utcnow().year, ge=1990, le=2100)
    scale: int = Field(default=100, ge=10, le=1000, description="Output resolution in metres")
    drive_folder: str = Field(default="GEE_Exports", description="Google Drive folder for export")
    filename: str = Field(default="rayong_rubber_age", description="Output file prefix")
    export_mode: str = Field(
        default="drive",
        description="'drive' = async export to Google Drive; 'download' = sync download URL (small scale only)",
    )


class FromRasterRequest(BaseModel):
    geometry: dict = Field(..., description="GeoJSON geometry (Polygon / MultiPolygon)")
    raster_filename: str = Field(
        default=RASTER_FILENAME,
        description="Filename under RUBBER_DATA_ROOT/rasters/",
    )


@app.post("/rubber-age/bfast-raster/generate")
def generate_rubber_age_raster(req: RasterGenerateRequest):
    """
    Generate a per-pixel rubber planting-year raster for a Thai province using GEE BFAST-like algorithm.

    - export_mode='drive': submits an async GEE Export.image.toDrive task.
      Returns immediately with a task_id; poll /rubber-age/bfast-raster/status/{task_id}.
      Once the file appears in Google Drive, download it to RUBBER_DATA_ROOT/rasters/.
    - export_mode='download': returns a signed download URL directly (use scale ≥ 100 m).
    """
    if not ee_ready:
        raise HTTPException(status_code=503, detail="Earth Engine is not initialized")

    from bfast_raster import (
        get_province_geometry,
        build_rubber_age_raster,
        submit_export_to_drive,
        get_download_url,
        get_map_tile_url,
    )

    try:
        if req.region_geojson:
            import ee
            geom = ee.Geometry(req.region_geojson)
        else:
            geom = get_province_geometry(req.province)
        image = build_rubber_age_raster(
            geom=geom,
            start_year=req.start_year,
            end_year=req.end_year,
            current_year=req.current_year,
        )

        if req.export_mode == "download":
            url = get_download_url(image, geom, scale=req.scale)
            RASTERS_DIR.mkdir(parents=True, exist_ok=True)
            out_name = f"{req.filename}.tif"
            out_path = (RASTERS_DIR / out_name).resolve()
            tmp_path = out_path.with_suffix(".tif.part")
            try:
                with urllib.request.urlopen(url, timeout=60 * 15) as resp, open(tmp_path, "wb") as f:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
                tmp_path.replace(out_path)
            finally:
                if tmp_path.exists():
                    try:
                        tmp_path.unlink()
                    except Exception:
                        pass

            try:
                tile_url = get_map_tile_url(image)
            except Exception as tile_exc:
                logger.warning("Could not get map tile URL: %s", tile_exc)
                tile_url = None

            return {
                "success": True,
                "export_mode": "download",
                "download_url": url,
                "saved": True,
                "saved_path": str(out_path),
                "saved_filename": out_name,
                "tile_url": tile_url,
                "note": "File downloaded and saved under RUBBER_DATA_ROOT/rasters/",
            }

        task_id = submit_export_to_drive(
            image=image,
            geom=geom,
            filename=req.filename,
            scale=req.scale,
            drive_folder=req.drive_folder,
        )
        return {
            "success": True,
            "export_mode": "drive",
            "task_id": task_id,
            "province": req.province,
            "scale_m": req.scale,
            "drive_folder": req.drive_folder,
            "filename": req.filename + ".tif",
            "note": (
                f"Poll /rubber-age/bfast-raster/status/{task_id} until state=COMPLETED, "
                f"then copy the file to RUBBER_DATA_ROOT/rasters/{req.filename}.tif"
            ),
        }

    except Exception as exc:
        logger.error("Raster generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/rubber-age/bfast-raster/status/{task_id}")
def get_raster_task_status(task_id: str):
    """Poll the status of a GEE Export task submitted by /rubber-age/bfast-raster/generate."""
    if not ee_ready:
        raise HTTPException(status_code=503, detail="Earth Engine is not initialized")

    from bfast_raster import get_task_status

    try:
        status = get_task_status(task_id)
        return {
            "task_id": task_id,
            "state": status.get("state", "UNKNOWN"),
            "description": status.get("description"),
            "creation_timestamp_ms": status.get("creation_timestamp_ms"),
            "update_timestamp_ms": status.get("update_timestamp_ms"),
            "error_message": status.get("error_message"),
        }
    except Exception as exc:
        logger.error("Task status check failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/rubber-age/from-raster")
def rubber_age_from_raster(req: FromRasterRequest):
    """
    Sample the pre-generated rubber-age raster at a drawn parcel geometry.
    Returns planting_year, rubber_age, and confidence for pixels within the geometry.

    The raster must already exist at RUBBER_DATA_ROOT/rasters/<raster_filename>.
    Generate it once with POST /rubber-age/bfast-raster/generate.
    """
    raster_path = RASTERS_DIR / req.raster_filename

    if not raster_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Raster not found: {raster_path}. "
                "Generate it first with POST /rubber-age/bfast-raster/generate"
            ),
        )

    # Basic GeoJSON geometry validation
    geom_type = req.geometry.get("type", "")
    if geom_type not in ("Polygon", "MultiPolygon", "GeometryCollection"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported geometry type: {geom_type}. Expected Polygon or MultiPolygon.",
        )

    from bfast_raster import sample_raster_at_geometry

    try:
        result = sample_raster_at_geometry(raster_path, req.geometry)
        return {
            "success": True,
            "raster": req.raster_filename,
            "planting_year": result.get("planting_year_mode") or result.get("planting_year"),
            "planting_year_mean": result.get("planting_year"),
            "rubber_age": result.get("rubber_age"),
            "confidence": result.get("confidence"),
            "reason": result.get("reason"),
            "method": "raster_sample",
        }
    except Exception as exc:
        logger.error("Raster sampling failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
