"""
GEE per-pixel BFAST-like rubber planting year raster for Rayong Province, Thailand.

Algorithm (per pixel):
  For each candidate year t in [start_year+2 .. end_year-2]:
    pre_ndvi  = 2-year median NDVI before t  (bare-land signal)
    post_ndvi = 2-year median NDVI after t   (recovery signal)
    score     = 0.4*pre_bare + 0.4*post_green + 0.2*level_jump
  planting_year = argmax(score) via GEE qualityMosaic
  rubber_age    = current_year - planting_year

Output GeoTIFF bands (all int16):
  1. planting_year  (YYYY, 0 = not detected)
  2. rubber_age     (years, 0 = not detected)
  3. confidence     (0-100 scaled)

Data source: Landsat 5/7/8/9 Collection 2 Level-2, annual cloud-free median composites.
Province boundary: FAO GAUL 2015 Level-1 (Thailand / Rayong).
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

GAUL_L1 = "FAO/GAUL/2015/level1"
DEFAULT_SCALE = 100          # metres — 30 for full-res, 100 for faster preview
DEFAULT_START_YEAR = 2000
DEFAULT_END_YEAR = datetime.utcnow().year
DEFAULT_CURRENT_YEAR = datetime.utcnow().year
NDVI_LOW_THRESH = 0.25       # bare / recently cleared
NDVI_HIGH_THRESH = 0.45      # established canopy
RASTER_FILENAME = "rayong_rubber_age.tif"


# ── Province boundary ────────────────────────────────────────────────────────

def get_province_geometry(province_name: str = "Rayong"):
    """Return an ee.Geometry for a Thai province from FAO GAUL."""
    import ee
    fc = ee.FeatureCollection(GAUL_L1)
    province = fc.filter(
        ee.Filter.And(
            ee.Filter.eq("ADM0_NAME", "Thailand"),
            ee.Filter.eq("ADM1_NAME", province_name),
        )
    )
    return province.geometry()


# ── Annual NDVI composites ───────────────────────────────────────────────────

def _mask_and_ndvi_l89(img):
    import ee
    qa = img.select("QA_PIXEL")
    clear = (
        qa.bitwiseAnd(1 << 3).eq(0)   # cloud shadow
        .And(qa.bitwiseAnd(1 << 5).eq(0))  # cloud
    )
    return (
        img.normalizedDifference(["SR_B5", "SR_B4"])
        .rename("NDVI")
        .updateMask(clear)
        .multiply(10000)
        .int16()
        .copyProperties(img, ["system:time_start"])
    )


def _mask_and_ndvi_l57(img):
    import ee
    qa = img.select("QA_PIXEL")
    clear = (
        qa.bitwiseAnd(1 << 3).eq(0)
        .And(qa.bitwiseAnd(1 << 5).eq(0))
    )
    return (
        img.normalizedDifference(["SR_B4", "SR_B3"])
        .rename("NDVI")
        .updateMask(clear)
        .multiply(10000)
        .int16()
        .copyProperties(img, ["system:time_start"])
    )


def build_annual_ndvi_images(
    geom,
    start_year: int,
    end_year: int,
) -> list:
    """Return a list of annual dry-season (Nov–Apr) median NDVI ee.Images (int16, scaled ×10000).

    Each composite for year Y uses Nov(Y-1)–Apr(Y): the full pre-monsoon dry window
    in Thailand. Nov–Dec are already clear in Rayong; doubling available scenes per
    median composite reduces null pixels on small parcels without mixing monsoon signal.
    """
    import ee

    images = []
    for year in range(start_year, end_year + 1):
        # Nov(Y-1)–Apr(Y): full dry season, lowest cloud cover in Thailand.
        # Nov–Dec are already dry in Rayong; including them doubles available
        # scenes per annual median without mixing in monsoon signal.
        start = f"{year - 1}-11-01"
        end = f"{year}-04-30"

        l89 = (
            ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
            .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
            .filterDate(start, end)
            .filterBounds(geom)
            .filter(ee.Filter.lt("CLOUD_COVER", 60))
            .map(_mask_and_ndvi_l89)
        )
        l57 = (
            ee.ImageCollection("LANDSAT/LT05/C02/T1_L2")
            .merge(ee.ImageCollection("LANDSAT/LE07/C02/T1_L2"))
            .filterDate(start, end)
            .filterBounds(geom)
            .filter(ee.Filter.lt("CLOUD_COVER", 60))
            .map(_mask_and_ndvi_l57)
        )

        median_img = (
            l89.merge(l57)
            .median()
            .rename("NDVI")
            .set("year", year)
            .set("system:time_start", ee.Date(start).millis())
        )
        # Fill masked pixels with -10000 sentinel so array ops stay aligned
        images.append(median_img.unmask(-10000))

    return images


# ── Per-pixel BFAST detection ─────────────────────────────────────────────────

def build_rubber_age_raster(
    geom,
    start_year: int = DEFAULT_START_YEAR,
    end_year: int = DEFAULT_END_YEAR,
    current_year: int = DEFAULT_CURRENT_YEAR,
    ndvi_low: float = NDVI_LOW_THRESH,
    ndvi_high: float = NDVI_HIGH_THRESH,
):
    """
    Return an ee.Image with bands: planting_year, rubber_age, confidence (all int16).

    Uses GEE qualityMosaic pattern: for each candidate planting year, build a
    [score, planting_year] image; qualityMosaic selects the pixel-wise best year.
    """
    import ee

    ndvi_images = build_annual_ndvi_images(geom, start_year, end_year)
    years = list(range(start_year, end_year + 1))
    n = len(years)

    # Scale factor: stored as int16 ×10000, convert to float [-1,1]
    SCALE = 10000.0
    NODATA = -10000

    candidates = []

    # Candidate years: need ≥2 years pre and ≥2 years post
    for i, year in enumerate(years):
        if i < 2 or i > n - 3:
            continue

        # 2-year pre/post windows
        pre_imgs = [ndvi_images[i - 2], ndvi_images[i - 1]]
        post_imgs = [ndvi_images[i], ndvi_images[i + 1]]

        # Mask nodata sentinel before averaging
        def valid(img):
            return img.updateMask(img.neq(NODATA)).divide(SCALE)

        pre_col = ee.ImageCollection([valid(img) for img in pre_imgs])
        post_col = ee.ImageCollection([valid(img) for img in post_imgs])

        pre_mean = pre_col.mean().rename("pre")
        post_mean = post_col.mean().rename("post")

        # pre_bare_score  : 1 when pre_mean ≈ 0, 0 when pre_mean ≥ ndvi_low
        pre_bare = (
            pre_mean.subtract(ndvi_low)
            .multiply(-1.0 / ndvi_low)
            .clamp(0, 1)
        )

        # post_green_score: 1 when post_mean is high, 0 when below ndvi_high
        denom = max(1.0 - ndvi_high, 0.01)
        post_green = (
            post_mean.subtract(ndvi_high)
            .divide(denom)
            .clamp(0, 1)
        )

        # level_jump_score: 1 when transition magnitude ≥ 0.3
        level_jump = (
            post_mean.subtract(pre_mean)
            .divide(0.30)
            .clamp(0, 1)
        )

        score = (
            pre_bare.multiply(0.4)
            .add(post_green.multiply(0.4))
            .add(level_jump.multiply(0.2))
            .rename("score")
        )

        planting_year_band = ee.Image.constant(year).int16().rename("planting_year")
        confidence_band = score.multiply(100).int16().rename("confidence")

        # Stack: score, planting_year, confidence — qualityMosaic picks max score
        candidate = score.addBands(planting_year_band).addBands(confidence_band)
        candidates.append(candidate)

    if not candidates:
        # Not enough years — return zero raster
        return (
            ee.Image.constant(0).int16().rename("planting_year")
            .addBands(ee.Image.constant(0).int16().rename("rubber_age"))
            .addBands(ee.Image.constant(0).int16().rename("confidence"))
            .clip(geom)
        )

    # qualityMosaic selects the pixel-wise candidate with the highest "score"
    best = ee.ImageCollection(candidates).qualityMosaic("score")

    planting_year = best.select("planting_year")
    confidence = best.select("confidence")

    # Mask out low-confidence pixels (score < 20 → confidence < 20)
    valid_mask = confidence.gte(20)
    planting_year = planting_year.updateMask(valid_mask).unmask(0).int16()
    confidence = confidence.updateMask(valid_mask).unmask(0).int16()

    rubber_age = (
        ee.Image.constant(current_year)
        .subtract(planting_year)
        .updateMask(planting_year.gt(0))
        .unmask(0)
        .int16()
        .rename("rubber_age")
    )

    return (
        planting_year.rename("planting_year")
        .addBands(rubber_age)
        .addBands(confidence)
        .clip(geom)
    )


# ── Export helpers ────────────────────────────────────────────────────────────

def submit_export_to_drive(
    image,
    geom,
    filename: str = "rayong_rubber_age",
    scale: int = DEFAULT_SCALE,
    drive_folder: str = "GEE_Exports",
    crs: str = "EPSG:4326",
) -> str:
    """Submit a GEE Export.image.toDrive task; return the task id."""
    import ee

    task = ee.batch.Export.image.toDrive(
        image=image,
        description=filename,
        folder=drive_folder,
        fileNamePrefix=filename,
        region=geom,
        scale=scale,
        crs=crs,
        fileFormat="GeoTIFF",
        maxPixels=int(1e10),
    )
    task.start()
    logger.info("GEE export task started: id=%s  description=%s", task.id, filename)
    return task.id


def get_task_status(task_id: str) -> dict:
    """Return the raw GEE task status dict for a given task id."""
    import ee
    statuses = ee.data.getTaskStatus([task_id])
    if not statuses:
        return {"state": "UNKNOWN", "id": task_id}
    return statuses[0]


def get_map_tile_url(image) -> str:
    """
    Return a GEE XYZ tile URL for the rubber_age band, styled with the age colour ramp.
    Valid for ~24 hours. Use as an XYZ raster source in MapLibre / Leaflet.
    """
    import ee
    vis = {
        "bands": ["rubber_age"],
        "min": 1,
        "max": 25,
        "palette": ["#bbf7d0", "#4ade80", "#16a34a", "#166534", "#14532d"],
    }
    display = image.select("rubber_age").updateMask(image.select("rubber_age").gt(0))
    map_id = display.getMapId(vis)
    return map_id["tile_fetcher"].url_format


def get_download_url(
    image,
    geom,
    scale: int = DEFAULT_SCALE,
    crs: str = "EPSG:4326",
) -> str:
    """
    Return a signed download URL for the raster (suitable for small regions / preview).
    Use scale ≥ 100 m to stay within GEE size limits.
    """
    import ee
    url = image.getDownloadURL(
        {
            "region": geom,
            "scale": scale,
            "crs": crs,
            "format": "GEO_TIFF",
            "bands": ["planting_year", "rubber_age", "confidence"],
        }
    )
    return url


# ── Local raster sampling ─────────────────────────────────────────────────────

def sample_raster_at_geometry(
    raster_path: Path,
    geometry: dict,
) -> dict:
    """
    Sample a local GeoTIFF (planting_year / rubber_age / confidence) at a GeoJSON geometry.
    Returns mean values for all valid pixels inside the polygon.
    """
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.windows import from_bounds
    from shapely.geometry import shape

    geom_shape = shape(geometry)
    bounds = geom_shape.bounds  # (minx, miny, maxx, maxy)

    with rasterio.open(raster_path) as src:
        # If the raster is not georeferenced, sampling by lat/lon geometries will never match.
        try:
            if src.crs is None:
                return {
                    "planting_year": None,
                    "rubber_age": None,
                    "confidence": None,
                    "planting_year_mode": None,
                    "reason": "raster_missing_crs",
                }
        except Exception:
            # If rasterio can't even expose CRS, treat as invalid georeferencing.
            return {
                "planting_year": None,
                "rubber_age": None,
                "confidence": None,
                "planting_year_mode": None,
                "reason": "raster_invalid",
            }

        # Reproject bounds to raster CRS if needed
        from rasterio.crs import CRS
        from pyproj import Transformer

        raster_crs = src.crs
        input_crs = CRS.from_epsg(4326)

        if raster_crs != input_crs:
            transformer = Transformer.from_crs(input_crs, raster_crs, always_xy=True)
            minx, miny = transformer.transform(bounds[0], bounds[1])
            maxx, maxy = transformer.transform(bounds[2], bounds[3])
            from shapely.ops import transform as shp_transform
            geom_shape = shp_transform(transformer.transform, geom_shape)
        else:
            minx, miny, maxx, maxy = bounds

        # Clamp to raster bounds; parcels can be outside the raster extent.
        rb = src.bounds
        minx2 = max(minx, rb.left)
        miny2 = max(miny, rb.bottom)
        maxx2 = min(maxx, rb.right)
        maxy2 = min(maxy, rb.top)

        # No overlap with raster
        if not (maxx2 > minx2 and maxy2 > miny2):
            return {
                "planting_year": None,
                "rubber_age": None,
                "confidence": None,
                "planting_year_mode": None,
                "reason": "outside_raster_extent",
            }

        window = from_bounds(minx2, miny2, maxx2, maxy2, src.transform).round_offsets().round_lengths()
        window_transform = src.window_transform(window)

        if window.width <= 0 or window.height <= 0:
            return {
                "planting_year": None,
                "rubber_age": None,
                "confidence": None,
                "planting_year_mode": None,
                "reason": "empty_window",
            }

        data = src.read(window=window)      # shape: (bands, rows, cols)
        band_names = ["planting_year", "rubber_age", "confidence"]

        mask = geometry_mask(
            [geom_shape.__geo_interface__],
            out_shape=(data.shape[1], data.shape[2]),
            transform=window_transform,
            invert=True,
        )

        result = {}
        for idx, name in enumerate(band_names):
            if idx >= data.shape[0]:
                result[name] = None
                continue
            band = data[idx].astype(float)
            band[band == 0] = np.nan          # 0 = nodata in our encoding
            band[~mask] = np.nan
            valid = band[np.isfinite(band)]
            result[name] = round(float(np.nanmean(valid)), 2) if valid.size > 0 else None

        # Dominant planting year (mode, not mean)
        py_band = data[0].astype(float)
        py_band[~mask] = 0
        valid_py = py_band[(py_band > 0) & np.isfinite(py_band)].astype(int)
        if valid_py.size > 0:
            counts = np.bincount(valid_py)
            result["planting_year_mode"] = int(np.argmax(counts))
        else:
            result["planting_year_mode"] = None

        # If we couldn't sample any valid pixels, report it explicitly.
        if result.get("planting_year") is None and result.get("planting_year_mode") is None:
            result["reason"] = "no_valid_pixels"

    return result
