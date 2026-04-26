#!/usr/bin/env python3
"""
Detect rubber planting year and estimate plantation age from satellite time series.

Workflow:
1) Load parcel polygons (GeoJSON/Shapefile) with unique plot ID.
2) Read monthly Sentinel-2 and Sentinel-1 rasters from folders.
3) Extract per-plot monthly means for required bands.
4) Compute indicators: NDVI, NDBI, optional EVI, VV, VH, VV/VH.
5) Smooth indicators with Savitzky-Golay or moving average.
6) Detect planting breakpoint using change-point detection + rule checks.
7) Estimate planting year, age, and confidence score.
8) Export time-series table, final summary table, and per-plot charts.

Expected raster naming convention (flexible with regex):
- Sentinel-2 monthly files include date (YYYY-MM or YYYYMM) and band token:
  B04, B08, B11 (e.g. s2_2021-07_B08.tif)
- Sentinel-1 monthly files include date and polarization token:
  VV, VH (e.g. s1_2021-07_VH.tif)

If your filenames differ, adapt DATE_REGEX and band parsing in parse_file_metadata().
"""

from __future__ import annotations

import argparse
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
import ruptures as rpt
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds
from scipy.signal import savgol_filter


DATE_REGEX = re.compile(r"(?P<year>20\d{2})[-_]?((?P<month>0[1-9]|1[0-2]))")
S2_BANDS = ("B04", "B08", "B11")
S1_BANDS = ("VV", "VH")
EPS = 1e-6


@dataclass
class DetectionResult:
    plot_id: str
    planting_year: Optional[int]
    age_2026: Optional[int]
    confidence_score: float
    breakpoint_date: Optional[pd.Timestamp]
    reason: str


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(message)s",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect rubber planting year and current age from Sentinel time series."
    )
    parser.add_argument("--plots", required=True,
                        help="Path to plot polygons (GeoJSON/Shapefile)")
    parser.add_argument("--plot-id-field", default="plot_id",
                        help="Unique plot ID field name")
    parser.add_argument("--s2-dir", required=True,
                        help="Directory containing Sentinel-2 monthly rasters")
    parser.add_argument("--s1-dir", default=None,
                        help="Directory containing Sentinel-1 monthly rasters")
    parser.add_argument(
        "--output-dir",
        default="./output_rubber_age",
        help="Output directory for CSV results and charts",
    )
    parser.add_argument("--start", default="2017-01",
                        help="Start month (YYYY-MM)")
    parser.add_argument(
        "--end", default=datetime.utcnow().strftime("%Y-%m"), help="End month (YYYY-MM)")
    parser.add_argument("--smooth-method",
                        choices=["savgol", "moving"], default="savgol")
    parser.add_argument("--smooth-window", type=int, default=7,
                        help="Smoothing window (odd integer)")
    parser.add_argument("--smooth-polyorder", type=int,
                        default=2, help="Savitzky-Golay polyorder")
    parser.add_argument("--rupture-model", default="rbf",
                        choices=["l1", "l2", "rbf"])
    parser.add_argument("--rupture-penalty", type=float, default=6.0)
    parser.add_argument("--current-year", type=int, default=2026)
    parser.add_argument("--max-plots", type=int, default=None,
                        help="Limit plots for quick tests")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


def ensure_output_dirs(output_dir: Path) -> Dict[str, Path]:
    charts_dir = output_dir / "charts"
    output_dir.mkdir(parents=True, exist_ok=True)
    charts_dir.mkdir(parents=True, exist_ok=True)
    return {"root": output_dir, "charts": charts_dir}


def load_plots(plots_path: Path, plot_id_field: str, max_plots: Optional[int]) -> gpd.GeoDataFrame:
    if not plots_path.exists():
        raise FileNotFoundError(f"Plots file not found: {plots_path}")

    gdf = gpd.read_file(plots_path)
    if plot_id_field not in gdf.columns:
        raise ValueError(
            f"Missing plot ID field '{plot_id_field}' in plots dataset")

    gdf = gdf[[plot_id_field, "geometry"]].copy()
    gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()
    gdf[plot_id_field] = gdf[plot_id_field].astype(str)

    if max_plots is not None:
        gdf = gdf.head(max_plots).copy()

    logging.info("Loaded %d plots", len(gdf))
    return gdf


def parse_month(value: str) -> pd.Timestamp:
    return pd.Timestamp(f"{value}-01")


def month_range(start_month: str, end_month: str) -> pd.DatetimeIndex:
    start_dt = parse_month(start_month)
    end_dt = parse_month(end_month)
    if end_dt < start_dt:
        raise ValueError("--end must be greater than or equal to --start")
    return pd.date_range(start=start_dt, end=end_dt, freq="MS")


def parse_file_metadata(path: Path) -> Tuple[Optional[pd.Timestamp], Optional[str]]:
    name = path.stem.upper()
    match = DATE_REGEX.search(name)
    if not match:
        return None, None

    year = int(match.group("year"))
    month = int(match.group("month"))
    date = pd.Timestamp(year=year, month=month, day=1)

    band = None
    for token in (*S2_BANDS, *S1_BANDS):
        if re.search(rf"(^|[_\-]){token}([_\-]|$)", name):
            band = token
            break

    return date, band


def index_raster_files(directory: Path) -> Dict[pd.Timestamp, Dict[str, Path]]:
    if not directory.exists():
        raise FileNotFoundError(f"Raster directory not found: {directory}")

    index: Dict[pd.Timestamp, Dict[str, Path]] = {}
    for path in directory.rglob("*.tif"):
        date, band = parse_file_metadata(path)
        if date is None or band is None:
            continue
        index.setdefault(date, {})[band] = path

    logging.info("Indexed %d months from %s", len(index), directory)
    return index


def reproject_plots_for_raster(gdf: gpd.GeoDataFrame, raster_crs) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        raise ValueError(
            "Plots CRS is undefined. Assign CRS before running extraction.")
    if str(gdf.crs) == str(raster_crs):
        return gdf
    return gdf.to_crs(raster_crs)


def masked_mean(dataset: rasterio.io.DatasetReader, geom) -> float:
    bounds = geom.bounds
    window = from_bounds(*bounds, transform=dataset.transform)
    window = window.round_offsets().round_lengths()

    data = dataset.read(1, window=window, masked=True)
    if data.size == 0:
        return float("nan")

    window_transform = dataset.window_transform(window)
    geom_mask = geometry_mask(
        [geom],
        out_shape=data.shape,
        transform=window_transform,
        invert=True,
    )

    values = np.where(geom_mask, data.filled(np.nan), np.nan)
    mean_value = np.nanmean(values)
    if np.isnan(mean_value):
        return float("nan")
    return float(mean_value)


def extract_monthly_means(
    plots_gdf: gpd.GeoDataFrame,
    plot_id_field: str,
    month_list: pd.DatetimeIndex,
    s2_index: Dict[pd.Timestamp, Dict[str, Path]],
    s1_index: Optional[Dict[pd.Timestamp, Dict[str, Path]]] = None,
) -> pd.DataFrame:
    records: List[dict] = []

    for month in month_list:
        s2_files = s2_index.get(month, {})
        required_s2 = all(b in s2_files for b in S2_BANDS)
        if not required_s2:
            continue

        s1_files = s1_index.get(month, {}) if s1_index else {}

        try:
            with rasterio.open(s2_files["B04"]) as ds_b04, rasterio.open(s2_files["B08"]) as ds_b08, rasterio.open(
                s2_files["B11"]
            ) as ds_b11:
                plots_proj = reproject_plots_for_raster(plots_gdf, ds_b04.crs)

                ds_vv = rasterio.open(
                    s1_files["VV"]) if "VV" in s1_files else None
                ds_vh = rasterio.open(
                    s1_files["VH"]) if "VH" in s1_files else None

                try:
                    for _, row in plots_proj.iterrows():
                        plot_id = row[plot_id_field]
                        geom = row.geometry

                        b04 = masked_mean(ds_b04, geom)
                        b08 = masked_mean(ds_b08, geom)
                        b11 = masked_mean(ds_b11, geom)

                        vv = masked_mean(
                            ds_vv, geom) if ds_vv else float("nan")
                        vh = masked_mean(
                            ds_vh, geom) if ds_vh else float("nan")

                        records.append(
                            {
                                "date": month,
                                "plot_id": plot_id,
                                "B04": b04,
                                "B08": b08,
                                "B11": b11,
                                "VV": vv,
                                "VH": vh,
                            }
                        )
                finally:
                    if ds_vv is not None:
                        ds_vv.close()
                    if ds_vh is not None:
                        ds_vh.close()

        except Exception as exc:
            logging.exception("Failed month %s: %s",
                              month.strftime("%Y-%m"), exc)

    if not records:
        raise RuntimeError(
            "No monthly records extracted. Check raster naming and date ranges.")

    return pd.DataFrame.from_records(records)


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["NDVI"] = (out["B08"] - out["B04"]) / (out["B08"] + out["B04"] + EPS)
    out["NDBI"] = (out["B11"] - out["B08"]) / (out["B11"] + out["B08"] + EPS)
    out["EVI"] = 2.5 * (out["B08"] - out["B04"]) / (out["B08"] +
                                                    6 * out["B04"] - 7.5 * out["B11"] + 1.0 + EPS)
    out["VV_VH_RATIO"] = out["VV"] / (out["VH"].replace(0, np.nan) + EPS)

    numeric_cols = ["NDVI", "NDBI", "EVI", "VV", "VH", "VV_VH_RATIO"]
    for col in numeric_cols:
        out[col] = out[col].replace([np.inf, -np.inf], np.nan)

    return out


def smooth_series(values: pd.Series, method: str, window: int, polyorder: int) -> pd.Series:
    x = values.astype(float)
    if x.notna().sum() < 5:
        return x

    x_interp = x.interpolate(limit_direction="both")

    if method == "moving":
        return x_interp.rolling(window=max(3, window), center=True, min_periods=1).mean()

    if window % 2 == 0:
        window += 1
    window = min(window, len(x_interp) if len(x_interp) %
                 2 == 1 else len(x_interp) - 1)
    if window < 5:
        return x_interp

    poly = min(polyorder, window - 1)
    sm = savgol_filter(x_interp.to_numpy(),
                       window_length=window, polyorder=poly, mode="interp")
    return pd.Series(sm, index=values.index)


def apply_smoothing(df: pd.DataFrame, method: str, window: int, polyorder: int) -> pd.DataFrame:
    out = df.sort_values(["plot_id", "date"]).copy()

    for metric in ["NDVI", "NDBI", "EVI", "VV", "VH", "VV_VH_RATIO"]:
        out[f"{metric}_SM"] = (
            out.groupby("plot_id", group_keys=False)[metric]
            .apply(lambda s: smooth_series(s, method=method, window=window, polyorder=polyorder))
        )

    return out


def detect_changepoints_multivariate(
    ts_df: pd.DataFrame,
    rupture_model: str,
    penalty: float,
    use_s1: bool,
) -> List[int]:
    cols = ["NDVI_SM", "NDBI_SM"] + \
        (["VH_SM"] if use_s1 and "VH_SM" in ts_df else [])
    mat = ts_df[cols].to_numpy(dtype=float)

    mat = np.where(np.isnan(mat), np.nanmedian(mat, axis=0), mat)

    algo = rpt.Pelt(model=rupture_model).fit(mat)
    cps = algo.predict(pen=penalty)

    # ruptures returns 1-based end index segments and includes len(series)
    return [cp - 1 for cp in cps[:-1] if 2 <= cp <= len(ts_df) - 2]


def evaluate_breakpoint_candidate(ts_df: pd.DataFrame, idx: int, use_s1: bool) -> Tuple[float, str]:
    min_segment = 6
    if idx < min_segment or idx + min_segment >= len(ts_df):
        return 0.0, "insufficient_window"

    pre = ts_df.iloc[idx - min_segment: idx]
    post = ts_df.iloc[idx: idx + min_segment]

    ndvi_pre = pre["NDVI_SM"].mean()
    ndvi_post = post["NDVI_SM"].mean()
    ndbi_pre = pre["NDBI_SM"].mean()
    ndbi_post = post["NDBI_SM"].mean()

    # Required logic thresholds from the task
    pre_bare_ok = float(ndvi_pre < 0.25 and ndbi_pre > 0.15)
    post_green_ok = float(ndvi_post > 0.45 and (ndbi_post < ndbi_pre - 0.05))

    # Monotonic-like NDVI increase for at least 6 months
    ndvi_diffs = post["NDVI_SM"].diff().fillna(0)
    ndvi_increase_ratio = float((ndvi_diffs > 0).mean())
    ndvi_growth_ok = float(ndvi_increase_ratio >= 0.66)

    vh_growth_ok = 0.0
    if use_s1 and "VH_SM" in ts_df:
        vh_pre = pre["VH_SM"].mean()
        vh_post = post["VH_SM"].mean()
        vh_growth_ok = float(vh_post > vh_pre)

    # Magnitude terms improve ranking between multiple candidates
    ndvi_gain = max(0.0, ndvi_post - ndvi_pre)
    ndbi_drop = max(0.0, ndbi_pre - ndbi_post)

    base_score = 0.35 * pre_bare_ok + 0.35 * post_green_ok + \
        0.2 * ndvi_growth_ok + 0.1 * vh_growth_ok
    magnitude_boost = min(0.25, 0.2 * ndvi_gain + 0.1 * ndbi_drop)
    score = float(np.clip(base_score + magnitude_boost, 0.0, 1.0))

    reason = "ok" if score >= 0.45 else "low_confidence_transition"
    return score, reason


def detect_planting_for_plot(
    plot_df: pd.DataFrame,
    rupture_model: str,
    penalty: float,
    current_year: int,
    use_s1: bool,
) -> DetectionResult:
    plot_id = str(plot_df["plot_id"].iloc[0])
    ts = plot_df.sort_values("date").reset_index(drop=True)

    if len(ts) < 18:
        return DetectionResult(
            plot_id=plot_id,
            planting_year=None,
            age_2026=None,
            confidence_score=0.0,
            breakpoint_date=None,
            reason="insufficient_timeseries_length",
        )

    cps = detect_changepoints_multivariate(
        ts, rupture_model=rupture_model, penalty=penalty, use_s1=use_s1)

    if not cps:
        return DetectionResult(
            plot_id=plot_id,
            planting_year=None,
            age_2026=None,
            confidence_score=0.0,
            breakpoint_date=None,
            reason="no_breakpoint_found",
        )

    best_idx = None
    best_score = -1.0
    best_reason = "no_valid_candidate"

    for idx in cps:
        score, reason = evaluate_breakpoint_candidate(ts, idx, use_s1=use_s1)
        if score > best_score:
            best_score = score
            best_idx = idx
            best_reason = reason

    if best_idx is None or best_score < 0.35:
        return DetectionResult(
            plot_id=plot_id,
            planting_year=None,
            age_2026=None,
            confidence_score=max(best_score, 0.0),
            breakpoint_date=None,
            reason=best_reason,
        )

    bp_date = pd.Timestamp(ts.loc[best_idx, "date"])
    planting_year = int(bp_date.year)
    age = current_year - planting_year

    return DetectionResult(
        plot_id=plot_id,
        planting_year=planting_year,
        age_2026=age,
        confidence_score=float(round(best_score, 4)),
        breakpoint_date=bp_date,
        reason=best_reason,
    )


def plot_timeseries_chart(
    plot_df: pd.DataFrame,
    result: DetectionResult,
    chart_path: Path,
    use_s1: bool,
) -> None:
    ts = plot_df.sort_values("date")

    fig, axes = plt.subplots(nrows=2 if use_s1 else 1,
                             ncols=1, figsize=(12, 7), sharex=True)
    if not isinstance(axes, np.ndarray):
        axes = np.array([axes])

    ax0 = axes[0]
    ax0.plot(ts["date"], ts["NDVI"], color="#7cb342",
             alpha=0.35, label="NDVI raw")
    ax0.plot(ts["date"], ts["NDVI_SM"], color="#2e7d32",
             linewidth=2, label="NDVI smooth")
    ax0.plot(ts["date"], ts["NDBI"], color="#ff8f00",
             alpha=0.3, label="NDBI raw")
    ax0.plot(ts["date"], ts["NDBI_SM"], color="#ef6c00",
             linewidth=1.8, label="NDBI smooth")

    if result.breakpoint_date is not None:
        ax0.axvline(result.breakpoint_date, color="#d32f2f",
                    linestyle="--", linewidth=2, label="Detected planting")

    ax0.set_ylabel("Index value")
    ax0.set_title(
        f"Plot {result.plot_id} | planting_year={result.planting_year} | confidence={result.confidence_score:.2f}"
    )
    ax0.grid(alpha=0.2)
    ax0.legend(loc="best")

    if use_s1:
        ax1 = axes[1]
        ax1.plot(ts["date"], ts["VH"], color="#1565c0",
                 alpha=0.35, label="VH raw")
        ax1.plot(ts["date"], ts["VH_SM"], color="#0d47a1",
                 linewidth=2, label="VH smooth")
        ax1.plot(ts["date"], ts["VV"], color="#6a1b9a",
                 alpha=0.25, label="VV raw")
        ax1.plot(ts["date"], ts["VV_SM"], color="#4a148c",
                 linewidth=1.8, label="VV smooth")
        if result.breakpoint_date is not None:
            ax1.axvline(result.breakpoint_date, color="#d32f2f",
                        linestyle="--", linewidth=2)
        ax1.set_ylabel("Backscatter")
        ax1.grid(alpha=0.2)
        ax1.legend(loc="best")

    axes[-1].set_xlabel("Date")
    fig.tight_layout()
    fig.savefig(chart_path, dpi=160)
    plt.close(fig)


def run_detection_pipeline(args: argparse.Namespace) -> None:
    plots_path = Path(args.plots)
    s2_dir = Path(args.s2_dir)
    s1_dir = Path(args.s1_dir) if args.s1_dir else None
    output_dir = Path(args.output_dir)

    dirs = ensure_output_dirs(output_dir)

    plots = load_plots(plots_path, args.plot_id_field, args.max_plots)
    months = month_range(args.start, args.end)

    s2_index = index_raster_files(s2_dir)
    s1_index = index_raster_files(s1_dir) if s1_dir else None

    logging.info("Extracting monthly means for %d target months", len(months))
    raw_df = extract_monthly_means(
        plots_gdf=plots,
        plot_id_field=args.plot_id_field,
        month_list=months,
        s2_index=s2_index,
        s1_index=s1_index,
    )

    ts_df = compute_indicators(raw_df)
    ts_df = apply_smoothing(
        ts_df,
        method=args.smooth_method,
        window=args.smooth_window,
        polyorder=args.smooth_polyorder,
    )

    ts_df = ts_df.sort_values(["plot_id", "date"]).reset_index(drop=True)
    ts_out = dirs["root"] / "plot_monthly_timeseries.csv"
    ts_df.to_csv(ts_out, index=False)
    logging.info("Saved time-series table: %s", ts_out)

    use_s1 = bool(s1_dir)
    detections: List[DetectionResult] = []

    for plot_id, g in ts_df.groupby("plot_id"):
        try:
            res = detect_planting_for_plot(
                plot_df=g,
                rupture_model=args.rupture_model,
                penalty=args.rupture_penalty,
                current_year=args.current_year,
                use_s1=use_s1,
            )
            detections.append(res)

            chart_path = dirs["charts"] / f"plot_{plot_id}.png"
            plot_timeseries_chart(g, res, chart_path, use_s1=use_s1)

        except Exception as exc:
            logging.exception("Detection failed for plot %s: %s", plot_id, exc)
            detections.append(
                DetectionResult(
                    plot_id=str(plot_id),
                    planting_year=None,
                    age_2026=None,
                    confidence_score=0.0,
                    breakpoint_date=None,
                    reason="processing_error",
                )
            )

    result_df = pd.DataFrame([r.__dict__ for r in detections])
    result_df = result_df[["plot_id", "planting_year", "age_2026",
                           "confidence_score", "breakpoint_date", "reason"]]
    summary_out = dirs["root"] / "rubber_planting_year_summary.csv"
    result_df.to_csv(summary_out, index=False)
    logging.info("Saved summary table: %s", summary_out)

    # Also export only the required compact table example format
    compact = result_df[["plot_id", "planting_year",
                         "age_2026", "confidence_score"]].copy()
    compact_out = dirs["root"] / "rubber_planting_year_compact.csv"
    compact.to_csv(compact_out, index=False)
    logging.info("Saved compact table: %s", compact_out)


def main() -> None:
    args = parse_args()
    setup_logging(args.log_level)

    try:
        run_detection_pipeline(args)
        logging.info("Pipeline completed successfully.")
    except Exception as exc:
        logging.exception("Pipeline failed: %s", exc)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
