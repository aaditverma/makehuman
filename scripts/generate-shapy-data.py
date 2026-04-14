"""
Generate SHAPY calibration dataset for SMPL beta coefficient training.

Produces scripts/data/calibration_dataset.json containing (measurements → betas) pairs
across a population grid. Uses SHAPY A2S if available, otherwise falls back to a
synthetic SMPL-based heuristic approach.

Usage:
    python scripts/generate-shapy-data.py
    python scripts/generate-shapy-data.py --num-betas 20
"""

import os
import sys
import json
import time
import logging
import argparse
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

# ── Paths ────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "data")
OUT_DIR = os.path.join(BASE_DIR, "scripts", "data")
OUT_PATH = os.path.join(OUT_DIR, "calibration_dataset.json")

MALE_CSV = os.path.join(DATA_DIR, "ansur2_male.csv")
FEMALE_CSV = os.path.join(DATA_DIR, "ansur2_female.csv")

# ── CLI Args ─────────────────────────────────────────────
_parser = argparse.ArgumentParser(description="Generate SHAPY calibration dataset")
_parser.add_argument("--num-betas", type=int, default=10,
                     help="Number of beta components to generate (default: 10)")
_cli_args = _parser.parse_args()

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Population grid parameters ───────────────────────────
HEIGHTS = list(range(140, 211, 5))       # 140–210 cm, 5 cm steps → 15 values
WEIGHTS = list(range(40, 161, 5))        # 40–160 kg, 5 kg steps  → 25 values
AGES = [20, 25, 30, 35, 40, 45, 50, 55, 60]  # 9 age bins for denser coverage
GENDERS = ["male", "female"]
BMI_MIN = 14
BMI_MAX = 50
MIN_VALID_ENTRIES = 5000
NUM_BETAS = _cli_args.num_betas
KNN_K = 5


# ═══════════════════════════════════════════════════════════
# 1. ANSUR II loading & KD-tree interpolation  (Task 4.1)
# ═══════════════════════════════════════════════════════════

def load_ansur() -> pd.DataFrame:
    """Load and merge ANSUR II male + female CSVs."""
    log.info("Loading ANSUR II data …")
    male_df = pd.read_csv(MALE_CSV, encoding="latin-1")
    female_df = pd.read_csv(FEMALE_CSV, encoding="latin-1")

    # Normalise column names to lowercase
    male_df.columns = [c.lower() for c in male_df.columns]
    female_df.columns = [c.lower() for c in female_df.columns]

    male_df["gender_code"] = 1    # male
    female_df["gender_code"] = 0  # female

    ansur = pd.concat([male_df, female_df], ignore_index=True)

    # Convert ANSUR units (mm → cm, tenths-of-kg → kg)
    clean = pd.DataFrame({
        "height_cm":   ansur["stature"] / 10,
        "weight_kg":   ansur["weightkg"] / 10,
        "age":         ansur["age"],
        "gender_code": ansur["gender_code"],
        "chestCm":     ansur["chestcircumference"] / 10,
        "waistCm":     ansur["waistcircumference"] / 10,
        "hipCm":       ansur["buttockcircumference"] / 10,
        "shoulderCm":  ansur["biacromialbreadth"] / 10,
        "inseamCm":    ansur["crotchheight"] / 10,
    })

    clean = clean.dropna()
    log.info(f"  Loaded {len(clean)} ANSUR II subjects")
    return clean


def build_kdtree(ansur: pd.DataFrame):
    """
    Build a KD-tree indexed by (height, weight, age, gender_code).
    Returns (tree, feature_matrix, ansur_df).
    """
    # Normalise features so each dimension has roughly equal scale
    features = ansur[["height_cm", "weight_kg", "age", "gender_code"]].copy()
    # Scale: height ~140-210 (range 70), weight ~40-160 (range 120),
    #        age ~20-60 (range 40), gender 0/1 (range 1)
    # We scale gender up so it acts as a meaningful split
    features["height_cm"] = features["height_cm"] / 20.0
    features["weight_kg"] = features["weight_kg"] / 30.0
    features["age"] = features["age"] / 25.0
    features["gender_code"] = features["gender_code"] * 3.0  # amplify gender split

    feat_matrix = features.values
    tree = cKDTree(feat_matrix)
    return tree, feat_matrix, ansur


def interpolate_measurements(
    tree: cKDTree,
    ansur: pd.DataFrame,
    height_cm: float,
    weight_kg: float,
    age: float,
    gender_code: int,
    k: int = KNN_K,
) -> dict:
    """
    Find k nearest ANSUR II neighbours and interpolate measurements
    using inverse-distance weighting.
    """
    query = np.array([
        height_cm / 20.0,
        weight_kg / 30.0,
        age / 25.0,
        gender_code * 3.0,
    ])
    dists, idxs = tree.query(query, k=k)

    # Guard against zero distance (exact match)
    dists = np.maximum(dists, 1e-8)
    weights = 1.0 / dists
    weights /= weights.sum()

    result = {}
    for col in ["chestCm", "waistCm", "hipCm", "shoulderCm", "inseamCm"]:
        vals = ansur[col].iloc[idxs].values
        result[col] = float(np.dot(weights, vals))

    return result



# ═══════════════════════════════════════════════════════════
# 2. SHAPY A2S invocation / synthetic fallback  (Task 4.2)
# ═══════════════════════════════════════════════════════════

def _try_import_shapy():
    """Attempt to import SHAPY A2S. Returns the model or None."""
    try:
        from shapy.a2s import A2SModel  # type: ignore
        model = A2SModel()
        log.info("SHAPY A2S model loaded successfully.")
        return model
    except Exception:
        pass

    try:
        import shapy  # type: ignore
        log.info("SHAPY package found but A2S import path differs – falling back.")
    except ImportError:
        pass

    return None


def _shapy_a2s_predict(model, measurements: dict, gender: str) -> np.ndarray | None:
    """
    Invoke SHAPY A2S to get SMPL betas from measurements.
    Returns ndarray(NUM_BETAS) or None on failure.
    Pads with 0.0 if SHAPY outputs fewer betas than requested.
    """
    try:
        result = model.predict(
            height=measurements["height_cm"],
            chest=measurements["chestCm"],
            waist=measurements["waistCm"],
            hips=measurements["hipCm"],
            gender=gender,
        )
        raw_betas = np.array(result, dtype=np.float64)
        if not np.all(np.isfinite(raw_betas)):
            return None
        # Pad or truncate to NUM_BETAS
        if len(raw_betas) < NUM_BETAS:
            betas = np.zeros(NUM_BETAS, dtype=np.float64)
            betas[:len(raw_betas)] = raw_betas
            return betas
        return raw_betas[:NUM_BETAS]
    except Exception as e:
        log.debug(f"SHAPY A2S error: {e}")
        return None


# ── Synthetic fallback ───────────────────────────────────
# When SHAPY is unavailable we generate plausible betas from
# measurements using known SMPL PCA shape-space properties:
#   β0 ∝ overall size
#   β1 ∝ BMI / belly
#   β2 ∝ height-to-weight ratio (lankiness)
#   β3 ∝ shoulder-to-hip ratio (V-taper)
#   β4 ∝ leg length proportion
#   β5 ∝ torso width
#   β6 ∝ chest depth
#   β7 ∝ hip width
#   β8 ∝ limb thickness
#   β9 ∝ leg thickness

def _synthetic_betas(
    height_cm: float,
    weight_kg: float,
    age: float,
    gender_code: int,
    measurements: dict,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Heuristic beta generation from interpolated measurements.
    Produces 10 SMPL betas with controlled noise for diversity.
    """
    bmi = weight_kg / (height_cm / 100.0) ** 2

    # Normalised features (same centres as design doc)
    h_norm = (height_cm - 175.0) / 20.0
    w_norm = (weight_kg - 80.0) / 30.0
    bmi_norm = (bmi - 25.0) / 8.0
    a_norm = (age - 40.0) / 25.0
    g_sign = 1.0 if gender_code == 1 else -1.0

    chest = measurements["chestCm"]
    waist = measurements["waistCm"]
    hip = measurements["hipCm"]
    shoulder = measurements["shoulderCm"]
    inseam = measurements["inseamCm"]

    # Derived ratios
    shoulder_waist = shoulder / max(waist, 1.0)
    hip_waist = hip / max(waist, 1.0)
    chest_norm = (chest - 95.0) / 15.0
    waist_norm = (waist - 82.0) / 15.0
    hip_norm = (hip - 98.0) / 12.0
    inseam_norm = (inseam - 80.0) / 10.0

    betas = np.zeros(NUM_BETAS, dtype=np.float64)

    # β0: overall size – driven by height
    betas[0] = 0.8 * h_norm + 0.15 * w_norm + 0.05 * g_sign

    # β1: BMI / belly prominence
    betas[1] = 0.7 * bmi_norm + 0.2 * waist_norm + 0.1 * a_norm
    # Males accumulate more belly fat
    if gender_code == 1:
        betas[1] += 0.08 * max(w_norm, 0)

    # β2: height-to-weight ratio (lankiness, negative = stocky)
    betas[2] = 0.5 * h_norm - 0.4 * w_norm - 0.1 * bmi_norm

    # β3: shoulder-to-hip ratio (V-taper)
    betas[3] = 0.6 * (shoulder_waist - 0.48) * 5.0 + 0.15 * g_sign

    # β4: leg length proportion
    betas[4] = 0.5 * inseam_norm + 0.3 * h_norm - 0.1 * w_norm

    # β5: torso width
    betas[5] = 0.4 * chest_norm + 0.3 * w_norm + 0.1 * g_sign
    if gender_code == 1:
        betas[5] += 0.06 * max(w_norm, 0)

    # β6: chest depth
    betas[6] = 0.35 * chest_norm + 0.25 * bmi_norm + 0.1 * a_norm

    # β7: hip width – females accumulate more here
    betas[7] = 0.5 * hip_norm + 0.2 * w_norm - 0.1 * g_sign
    if gender_code == 0:
        betas[7] += 0.1 * max(w_norm, 0)

    # β8: limb thickness
    betas[8] = 0.3 * w_norm + 0.2 * chest_norm + 0.1 * bmi_norm

    # β9: leg thickness – females accumulate more here
    betas[9] = 0.3 * hip_norm + 0.25 * w_norm + 0.05 * a_norm
    if gender_code == 0:
        betas[9] += 0.08 * max(w_norm, 0)

    # Betas beyond index 9 remain 0.0 (no heuristic for higher PCs)

    # Age-related redistribution: older → more central fat
    if age > 40:
        age_shift = (age - 40) / 40.0
        betas[1] += 0.1 * age_shift   # more belly
        betas[5] += 0.05 * age_shift  # wider torso
        betas[7] -= 0.03 * age_shift * g_sign  # gender-dependent hip shift

    # Add controlled noise for diversity (σ ≈ 0.05)
    noise = rng.normal(0, 0.05, size=NUM_BETAS)
    betas += noise

    # Clamp to [-3, 3]
    betas = np.clip(betas, -3.0, 3.0)

    return betas


def generate_betas_for_point(
    shapy_model,
    height_cm: float,
    weight_kg: float,
    age: float,
    gender: str,
    gender_code: int,
    measurements: dict,
    rng: np.random.Generator,
) -> np.ndarray | None:
    """
    Get NUM_BETAS SMPL betas for a single grid point.
    Uses SHAPY A2S if available, otherwise synthetic fallback.
    Returns ndarray(NUM_BETAS) or None on failure.
    """
    if shapy_model is not None:
        try:
            betas = _shapy_a2s_predict(shapy_model, measurements, gender)
            if betas is not None:
                return betas
        except Exception as e:
            log.warning(f"SHAPY failed for h={height_cm} w={weight_kg}: {e}")

    # Fallback: synthetic heuristic
    return _synthetic_betas(height_cm, weight_kg, age, gender_code, measurements, rng)



# ═══════════════════════════════════════════════════════════
# 3. Export calibration dataset as JSON  (Task 4.3)
# ═══════════════════════════════════════════════════════════

def export_dataset(entries: list[dict], out_path: str) -> None:
    """Write calibration dataset JSON and log summary statistics."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    with open(out_path, "w") as f:
        json.dump(entries, f, indent=1)

    size_kb = os.path.getsize(out_path) / 1024
    log.info(f"Wrote {out_path} ({size_kb:.0f} KB)")


def log_summary(entries: list[dict], failure_count: int) -> None:
    """Log summary statistics about the generated dataset."""
    total = len(entries)
    males = sum(1 for e in entries if e["gender"] == "male")
    females = total - males

    bmis = [e["weightKg"] / (e["heightCm"] / 100) ** 2 for e in entries]
    bmi_min = min(bmis) if bmis else 0
    bmi_max = max(bmis) if bmis else 0

    heights = [e["heightCm"] for e in entries]
    weights = [e["weightKg"] for e in entries]

    log.info("=" * 50)
    log.info("CALIBRATION DATASET SUMMARY")
    log.info("=" * 50)
    log.info(f"  Total entries:   {total}")
    log.info(f"  Males:           {males}")
    log.info(f"  Females:         {females}")
    log.info(f"  BMI range:       {bmi_min:.1f} – {bmi_max:.1f}")
    log.info(f"  Height range:    {min(heights):.0f} – {max(heights):.0f} cm")
    log.info(f"  Weight range:    {min(weights):.0f} – {max(weights):.0f} kg")
    log.info(f"  Failure count:   {failure_count}")
    log.info(f"  Min required:    {MIN_VALID_ENTRIES}")
    log.info(f"  Meets minimum:   {'YES' if total >= MIN_VALID_ENTRIES else 'NO'}")
    log.info("=" * 50)


# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════

def main():
    start = time.time()

    # 1. Load ANSUR II and build KD-tree
    ansur = load_ansur()
    tree, _, ansur_df = build_kdtree(ansur)

    # 2. Try to load SHAPY A2S
    shapy_model = _try_import_shapy()
    if shapy_model is None:
        log.info("SHAPY not available – using synthetic beta fallback.")
    else:
        log.info("Using SHAPY A2S for beta generation.")
        log.info(f"  Requesting {NUM_BETAS} betas per entry (will pad with 0.0 if SHAPY outputs fewer).")

    # 3. Iterate over population grid
    rng = np.random.default_rng(seed=42)
    entries: list[dict] = []
    failure_count = 0
    total_grid = 0

    for gender in GENDERS:
        gender_code = 1 if gender == "male" else 0
        for age in AGES:
            for h in HEIGHTS:
                for w in WEIGHTS:
                    bmi = w / (h / 100.0) ** 2
                    # Filter physiologically implausible
                    if bmi < BMI_MIN or bmi > BMI_MAX:
                        continue

                    total_grid += 1

                    # Interpolate measurements from ANSUR II
                    measurements = interpolate_measurements(
                        tree, ansur_df, h, w, age, gender_code
                    )

                    # Generate betas
                    try:
                        betas = generate_betas_for_point(
                            shapy_model, h, w, age, gender, gender_code,
                            measurements, rng,
                        )
                    except Exception as e:
                        log.warning(f"Beta generation failed h={h} w={w} age={age} "
                                    f"gender={gender}: {e}")
                        failure_count += 1
                        continue

                    if betas is None:
                        failure_count += 1
                        continue

                    entries.append({
                        "heightCm": h,
                        "weightKg": w,
                        "age": age,
                        "gender": gender,
                        "chestCm": round(measurements["chestCm"], 1),
                        "waistCm": round(measurements["waistCm"], 1),
                        "hipCm": round(measurements["hipCm"], 1),
                        "shoulderCm": round(measurements["shoulderCm"], 1),
                        "inseamCm": round(measurements["inseamCm"], 1),
                        "numBetas": NUM_BETAS,
                        "betas": [round(float(b), 4) for b in betas],
                    })

    elapsed = time.time() - start

    # 4. Validate & export
    log.info(f"Grid points evaluated: {total_grid}")
    log.info(f"Time elapsed: {elapsed:.1f}s")

    if len(entries) < MIN_VALID_ENTRIES:
        log.warning(
            f"Only {len(entries)} valid entries (minimum {MIN_VALID_ENTRIES}). "
            "Dataset may be insufficient."
        )

    log_summary(entries, failure_count)
    export_dataset(entries, OUT_PATH)

    log.info("Done.")


if __name__ == "__main__":
    main()
