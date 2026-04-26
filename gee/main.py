"""
GEE NDVI microservice
---------------------
Exposes:
  GET  /health  – liveness probe
  POST /ndvi    – compute mean NDVI for a GeoJSON geometry

Environment variables:
  GEE_KEY_FILE    Path to the service-account JSON key file (default: /run/secrets/gee_key.json)
  GEE_PROJECT_ID  GCP project ID that has Earth Engine API enabled

NDVI source priority:
  1. Sentinel-2 SR Harmonized (10 m, cloud < 30 %)
  2. Landsat-9 C2 T1 L2 (30 m, fallback if no S2 imagery)
"""

import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

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


# ── Schema ──────────────────────────────────────────────────────────────────

class NDVIRequest(BaseModel):
    geometry: dict
    start_date: str | None = None
    end_date: str | None = None


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
                "Set GEE_SERVICE_ACCOUNT_JSON and GEE_PROJECT_ID environment variables."
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
