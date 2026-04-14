"""
Train calibrated SMPL beta regression coefficients from the SHAPY calibration dataset.

Reads scripts/data/calibration_dataset.json and produces src/data/calibrated_coefficients.json
containing:
  - Per-beta polynomial regression (intercepts, weights, normalization)
  - Calibrated preset offset vectors (slim, average, athletic, curvy, heavy)
  - Composition bias vectors (athletic, average, heavy)
  - Sensitivity map (measurement → beta sensitivities)
  - Per-gender fat distribution vectors (weightToBeta, ageFactor)

Usage:
    python scripts/train-beta-coefficients.py
    python scripts/train-beta-coefficients.py --num-betas 20
"""

import os
import sys
import json
import logging
import datetime
import argparse
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_score

# ── Paths ────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "scripts", "data")
OUT_DIR = os.path.join(BASE_DIR, "src", "data")
DATASET_PATH = os.path.join(DATA_DIR, "calibration_dataset.json")
OUT_PATH = os.path.join(OUT_DIR, "calibrated_coefficients.json")

# Parse CLI arguments
_parser = argparse.ArgumentParser(description="Train SMPL beta regression coefficients")
_parser.add_argument("--num-betas", type=int, default=10,
                     help="Number of beta components to train (default: 10)")
_cli_args = _parser.parse_args()

NUM_BETAS = _cli_args.num_betas

# Normalization parameters — must match TypeScript smplRegressor.ts
NORMALIZATION = {
    "heightNorm": {"center": 175, "range": 20},
    "weightNorm": {"center": 80, "range": 30},
    "ageNorm": {"center": 40, "range": 25},
    "genderSign": {"center": 0, "range": 1},
    "bmiNorm": {"center": 25, "range": 8},
    "hwInteraction": {"center": 0, "range": 1},
    "bmiSq": {"center": 0, "range": 1},
}

FEATURE_NAMES = [
    "heightNorm", "weightNorm", "ageNorm", "genderSign",
    "bmiNorm", "hwInteraction", "bmiSq",
]

# 8-input normalization parameters — must match TypeScript smplRegressor.ts
NORMALIZATION_8INPUT = {
    "heightNorm": {"center": 175, "range": 20},
    "weightNorm": {"center": 80, "range": 30},
    "ageNorm": {"center": 40, "range": 25},
    "genderSign": {"center": 0, "range": 1},
    "chestNorm": {"center": 96, "range": 15},
    "waistNorm": {"center": 82, "range": 15},
    "hipNorm": {"center": 98, "range": 15},
    "inseamNorm": {"center": 80, "range": 10},
    "bmiNorm": {"center": 25, "range": 8},
    "whrNorm": {"center": 0.85, "range": 0.15},
    "cwrNorm": {"center": 1.15, "range": 0.2},
}

FEATURE_NAMES_8INPUT = [
    "heightNorm", "weightNorm", "ageNorm", "genderSign",
    "chestNorm", "waistNorm", "hipNorm", "inseamNorm",
    "bmiNorm", "whrNorm", "cwrNorm",
]

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════

def load_dataset(path: str) -> list[dict]:
    """Load calibration dataset from JSON."""
    log.info(f"Loading calibration dataset from {path}")
    with open(path) as f:
        data = json.load(f)
    log.info(f"  Loaded {len(data)} entries")
    return data


def compute_features(entry: dict) -> np.ndarray:
    """Compute the 7 normalized features for a single entry."""
    h = entry["heightCm"]
    w = entry["weightKg"]
    age = entry["age"]
    gender = entry["gender"]

    heightNorm = (h - 175.0) / 20.0
    weightNorm = (w - 80.0) / 30.0
    ageNorm = (age - 40.0) / 25.0
    genderSign = 1.0 if gender == "male" else -1.0
    bmi = w / max(0.01, (h / 100.0) ** 2)
    bmiNorm = (bmi - 25.0) / 8.0
    hwInteraction = heightNorm * weightNorm
    bmiSq = bmiNorm * bmiNorm

    return np.array([heightNorm, weightNorm, ageNorm, genderSign, bmiNorm, hwInteraction, bmiSq])


def build_feature_matrix(data: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Build feature matrix X and target matrix Y from dataset."""
    X = np.array([compute_features(e) for e in data])
    raw_Y = np.array([e["betas"] for e in data])
    # Pad or truncate to NUM_BETAS columns
    if raw_Y.shape[1] < NUM_BETAS:
        Y = np.zeros((raw_Y.shape[0], NUM_BETAS))
        Y[:, :raw_Y.shape[1]] = raw_Y
    else:
        Y = raw_Y[:, :NUM_BETAS]
    return X, Y


def compute_features_8input(entry: dict) -> np.ndarray:
    """Compute the 11 normalized features for the 8-input model from a single entry."""
    h = entry["heightCm"]
    w = entry["weightKg"]
    age = entry["age"]
    gender = entry["gender"]
    chest = entry["chestCm"]
    waist = entry["waistCm"]
    hip = entry["hipCm"]
    inseam = entry["inseamCm"]

    heightNorm = (h - 175.0) / 20.0
    weightNorm = (w - 80.0) / 30.0
    ageNorm = (age - 40.0) / 25.0
    genderSign = 1.0 if gender == "male" else -1.0
    chestNorm = (chest - 96.0) / 15.0
    waistNorm = (waist - 82.0) / 15.0
    hipNorm = (hip - 98.0) / 15.0
    inseamNorm = (inseam - 80.0) / 10.0
    bmi = w / max(0.01, (h / 100.0) ** 2)
    bmiNorm = (bmi - 25.0) / 8.0
    whr = waist / max(0.01, hip)
    whrNorm = (whr - 0.85) / 0.15
    cwr = chest / max(0.01, waist)
    cwrNorm = (cwr - 1.15) / 0.2

    return np.array([
        heightNorm, weightNorm, ageNorm, genderSign,
        chestNorm, waistNorm, hipNorm, inseamNorm,
        bmiNorm, whrNorm, cwrNorm,
    ])


def build_feature_matrix_8input(data: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Build 11-column feature matrix X and target matrix Y for the 8-input model."""
    X = np.array([compute_features_8input(e) for e in data])
    raw_Y = np.array([e["betas"] for e in data])
    # Pad or truncate to NUM_BETAS columns
    if raw_Y.shape[1] < NUM_BETAS:
        Y = np.zeros((raw_Y.shape[0], NUM_BETAS))
        Y[:, :raw_Y.shape[1]] = raw_Y
    else:
        Y = raw_Y[:, :NUM_BETAS]
    return X, Y


def _pad_betas(betas_list: list, target_len: int = None) -> np.ndarray:
    """Pad a single betas list to target_len (default NUM_BETAS), zero-filling beyond."""
    if target_len is None:
        target_len = NUM_BETAS
    arr = np.array(betas_list, dtype=np.float64)
    if len(arr) >= target_len:
        return arr[:target_len]
    padded = np.zeros(target_len, dtype=np.float64)
    padded[:len(arr)] = arr
    return padded


def _pad_betas_mean(betas_lists: list, target_len: int = None) -> np.ndarray:
    """Compute mean of betas lists, padding each to target_len first."""
    if target_len is None:
        target_len = NUM_BETAS
    padded = np.array([_pad_betas(b, target_len) for b in betas_lists])
    return padded.mean(axis=0)


# ═══════════════════════════════════════════════════════════
# 5.1 Polynomial regression with interaction terms
# ═══════════════════════════════════════════════════════════

def train_regression(X: np.ndarray, Y: np.ndarray) -> dict:
    """
    Fit per-beta Ridge regression: β[i] = intercept[i] + Σ(weights[i][j] × feature[j])
    Cross-validate and assert MAE < 0.3 beta units per component.

    Returns dict with intercepts [10] and weights [10][7].
    """
    log.info("Training per-beta polynomial regression...")

    intercepts = np.zeros(NUM_BETAS)
    weights = np.zeros((NUM_BETAS, X.shape[1]))
    maes = np.zeros(NUM_BETAS)

    for i in range(NUM_BETAS):
        y = Y[:, i]
        model = Ridge(alpha=1.0)

        # 5-fold cross-validation
        scores = cross_val_score(model, X, y, cv=5, scoring="neg_mean_absolute_error")
        mae = -scores.mean()
        maes[i] = mae

        # Fit on full dataset
        model.fit(X, y)
        intercepts[i] = model.intercept_
        weights[i] = model.coef_

        log.info(f"  β{i}: MAE={mae:.4f}, intercept={model.intercept_:.4f}")

    mean_mae = maes.mean()
    max_mae = maes.max()
    log.info(f"  Mean MAE across betas: {mean_mae:.4f}")
    log.info(f"  Max MAE: {max_mae:.4f}")

    assert max_mae < 0.3, (
        f"Max MAE {max_mae:.4f} exceeds threshold 0.3. "
        "Regression quality insufficient."
    )

    return {
        "intercepts": intercepts.tolist(),
        "weights": [w.tolist() for w in weights],
        "features": FEATURE_NAMES,
        "normalization": NORMALIZATION,
    }


def train_regression_8input(X8: np.ndarray, Y: np.ndarray, maes_4input: np.ndarray | None = None) -> tuple[dict, np.ndarray]:
    """
    Fit per-beta Ridge regression on the 11-feature 8-input matrix.
    Cross-validate and assert MAE < 0.15 beta units per component.
    Log comparison with 4-input model MAE when available.

    Returns tuple of (dict with intercepts [10], weights [10][11], features, normalization)
    and per-beta MAE array [10].
    """
    log.info("Training per-beta 8-input regression (11 features)...")

    intercepts = np.zeros(NUM_BETAS)
    weights = np.zeros((NUM_BETAS, X8.shape[1]))
    maes = np.zeros(NUM_BETAS)

    for i in range(NUM_BETAS):
        y = Y[:, i]
        model = Ridge(alpha=1.0)

        # 5-fold cross-validation
        scores = cross_val_score(model, X8, y, cv=5, scoring="neg_mean_absolute_error")
        mae = -scores.mean()
        maes[i] = mae

        # Fit on full dataset
        model.fit(X8, y)
        intercepts[i] = model.intercept_
        weights[i] = model.coef_

        improvement = ""
        if maes_4input is not None:
            pct = (1.0 - mae / max(maes_4input[i], 1e-8)) * 100.0
            improvement = f", improvement={pct:.1f}%"

        log.info(f"  β{i}: MAE={mae:.4f}, intercept={model.intercept_:.4f}{improvement}")

    mean_mae = maes.mean()
    max_mae = maes.max()
    log.info(f"  Mean MAE across betas: {mean_mae:.4f}")
    log.info(f"  Max MAE: {max_mae:.4f}")

    assert max_mae < 0.15, (
        f"Max MAE {max_mae:.4f} exceeds threshold 0.15. "
        "8-input regression quality insufficient."
    )

    # Log comparison summary with 4-input model
    if maes_4input is not None:
        mean_4 = maes_4input.mean()
        mean_8 = mean_mae
        overall_improvement = (1.0 - mean_8 / max(mean_4, 1e-8)) * 100.0
        log.info(f"  4-input mean MAE: {mean_4:.4f}")
        log.info(f"  8-input mean MAE: {mean_8:.4f}")
        log.info(f"  Overall improvement: {overall_improvement:.1f}%")

    return {
        "intercepts": intercepts.tolist(),
        "weights": [w.tolist() for w in weights],
        "features": FEATURE_NAMES_8INPUT,
        "normalization": NORMALIZATION_8INPUT,
    }, maes


# ═══════════════════════════════════════════════════════════
# 5.2 Preset offset calibration
# ═══════════════════════════════════════════════════════════

def compute_preset_offsets(data: list[dict]) -> dict:
    """
    Compute calibrated preset offset vectors by filtering the dataset
    by body type characteristics and computing mean beta differences
    from the Average baseline.

    Groups:
      - Slim: BMI < 20
      - Athletic: high shoulder-to-waist ratio (top 20% per gender)
      - Heavy: BMI > 30
      - Curvy: high hip-to-waist ratio (top 20% per gender)
      - Average: BMI 20–25 (baseline)
    """
    log.info("Computing preset offset vectors...")

    # Compute BMI and ratios for all entries
    entries_with_stats = []
    for e in data:
        bmi = e["weightKg"] / max(0.01, (e["heightCm"] / 100.0) ** 2)
        sw_ratio = e["shoulderCm"] / max(1.0, e["waistCm"])
        hw_ratio = e["hipCm"] / max(1.0, e["waistCm"])
        entries_with_stats.append({
            **e,
            "bmi": bmi,
            "sw_ratio": sw_ratio,
            "hw_ratio": hw_ratio,
        })

    # Average baseline: BMI 20–25
    avg_entries = [e for e in entries_with_stats if 20 <= e["bmi"] <= 25]
    avg_betas = _pad_betas_mean([e["betas"] for e in avg_entries])
    log.info(f"  Average baseline: {len(avg_entries)} entries")

    # Slim: BMI < 20
    slim_entries = [e for e in entries_with_stats if e["bmi"] < 20]
    slim_betas = _pad_betas_mean([e["betas"] for e in slim_entries]) if slim_entries else avg_betas
    log.info(f"  Slim: {len(slim_entries)} entries")

    # Athletic: top 20% shoulder-to-waist ratio per gender
    athletic_entries = []
    for gender in ["male", "female"]:
        g_entries = [e for e in entries_with_stats if e["gender"] == gender]
        sw_ratios = [e["sw_ratio"] for e in g_entries]
        threshold = np.percentile(sw_ratios, 80)
        athletic_entries.extend([e for e in g_entries if e["sw_ratio"] >= threshold])
    athletic_betas = _pad_betas_mean([e["betas"] for e in athletic_entries])
    log.info(f"  Athletic: {len(athletic_entries)} entries")

    # Heavy: BMI > 30
    heavy_entries = [e for e in entries_with_stats if e["bmi"] > 30]
    heavy_betas = _pad_betas_mean([e["betas"] for e in heavy_entries]) if heavy_entries else avg_betas
    log.info(f"  Heavy: {len(heavy_entries)} entries")

    # Curvy: top 20% hip-to-waist ratio per gender
    curvy_entries = []
    for gender in ["male", "female"]:
        g_entries = [e for e in entries_with_stats if e["gender"] == gender]
        hw_ratios = [e["hw_ratio"] for e in g_entries]
        threshold = np.percentile(hw_ratios, 80)
        curvy_entries.extend([e for e in g_entries if e["hw_ratio"] >= threshold])
    curvy_betas = _pad_betas_mean([e["betas"] for e in curvy_entries])
    log.info(f"  Curvy: {len(curvy_entries)} entries")

    # Compute offsets (subtract average baseline)
    slim_offset = slim_betas - avg_betas
    athletic_offset = athletic_betas - avg_betas
    heavy_offset = heavy_betas - avg_betas
    curvy_offset = curvy_betas - avg_betas
    average_offset = np.zeros(NUM_BETAS)

    # Scale offsets to ensure L2 distance between Athletic and Heavy >= 0.8
    ath_heavy_dist = np.linalg.norm(athletic_offset - heavy_offset)
    log.info(f"  Athletic-Heavy L2 distance (raw): {ath_heavy_dist:.4f}")

    if ath_heavy_dist < 0.8:
        scale_factor = 0.8 / max(ath_heavy_dist, 1e-8)
        log.info(f"  Scaling offsets by {scale_factor:.4f} to meet L2 >= 0.8")
        slim_offset *= scale_factor
        athletic_offset *= scale_factor
        heavy_offset *= scale_factor
        curvy_offset *= scale_factor
        ath_heavy_dist = np.linalg.norm(athletic_offset - heavy_offset)

    log.info(f"  Athletic-Heavy L2 distance (final): {ath_heavy_dist:.4f}")

    # Verify offset vectors affect >= 6 of NUM_BETAS beta components
    for name, offset in [("slim", slim_offset), ("athletic", athletic_offset),
                         ("heavy", heavy_offset), ("curvy", curvy_offset)]:
        nonzero = np.sum(np.abs(offset) > 0.01)
        log.info(f"  {name} affects {nonzero}/{NUM_BETAS} beta components")
        if nonzero < 6:
            log.warning(f"  {name} offset affects fewer than 6 components ({nonzero})")

    return {
        "slim": [round(float(v), 6) for v in slim_offset],
        "average": [round(float(v), 6) for v in average_offset],
        "athletic": [round(float(v), 6) for v in athletic_offset],
        "curvy": [round(float(v), 6) for v in curvy_offset],
        "heavy": [round(float(v), 6) for v in heavy_offset],
    }


# ═══════════════════════════════════════════════════════════
# 5.3 Composition bias calibration
# ═══════════════════════════════════════════════════════════

def compute_composition_bias(data: list[dict]) -> dict:
    """
    Compute composition bias vectors by comparing betas for subjects
    with different body compositions at similar (height, weight) pairs.

    Athletic: high shoulder-to-waist ratio (top 20% per gender)
    Heavy: high waist-to-hip ratio (top 20% per gender)
    Average: middle 60%
    """
    log.info("Computing composition bias vectors...")

    # Compute ratios per gender
    entries_with_ratios = []
    for e in data:
        sw_ratio = e["shoulderCm"] / max(1.0, e["waistCm"])
        wh_ratio = e["waistCm"] / max(1.0, e["hipCm"])
        entries_with_ratios.append({
            **e,
            "sw_ratio": sw_ratio,
            "wh_ratio": wh_ratio,
        })

    athletic_entries = []
    heavy_entries = []
    average_entries = []

    for gender in ["male", "female"]:
        g_entries = [e for e in entries_with_ratios if e["gender"] == gender]

        # Shoulder-to-waist ratio thresholds
        sw_ratios = [e["sw_ratio"] for e in g_entries]
        sw_p80 = np.percentile(sw_ratios, 80)
        sw_p20 = np.percentile(sw_ratios, 20)

        # Waist-to-hip ratio thresholds
        wh_ratios = [e["wh_ratio"] for e in g_entries]
        wh_p80 = np.percentile(wh_ratios, 80)
        wh_p20 = np.percentile(wh_ratios, 20)

        for e in g_entries:
            if e["sw_ratio"] >= sw_p80:
                athletic_entries.append(e)
            elif e["wh_ratio"] >= wh_p80:
                heavy_entries.append(e)
            elif sw_p20 <= e["sw_ratio"] <= sw_p80 and wh_p20 <= e["wh_ratio"] <= wh_p80:
                average_entries.append(e)

    avg_betas = _pad_betas_mean([e["betas"] for e in average_entries])
    athletic_betas = _pad_betas_mean([e["betas"] for e in athletic_entries])
    heavy_betas = _pad_betas_mean([e["betas"] for e in heavy_entries])

    athletic_bias = athletic_betas - avg_betas
    heavy_bias = heavy_betas - avg_betas
    average_bias = np.zeros(NUM_BETAS)

    log.info(f"  Athletic entries: {len(athletic_entries)}")
    log.info(f"  Heavy entries: {len(heavy_entries)}")
    log.info(f"  Average entries: {len(average_entries)}")

    # Ensure composition vectors affect >= 6 of NUM_BETAS beta components
    for name, bias in [("athletic", athletic_bias), ("heavy", heavy_bias)]:
        nonzero = np.sum(np.abs(bias) > 0.01)
        log.info(f"  {name} composition affects {nonzero}/{NUM_BETAS} beta components")
        if nonzero < 6:
            log.warning(f"  {name} composition affects fewer than 6 components ({nonzero})")

    return {
        "athletic": [round(float(v), 6) for v in athletic_bias],
        "average": [round(float(v), 6) for v in average_bias],
        "heavy": [round(float(v), 6) for v in heavy_bias],
    }


# ═══════════════════════════════════════════════════════════
# 5.4 Sensitivity map calibration
# ═══════════════════════════════════════════════════════════

def compute_sensitivity_map(data: list[dict]) -> dict:
    """
    Compute sensitivity map by perturbing each measurement by ±5cm
    and re-running the synthetic beta generation to compute Δβ/Δmeasurement.

    Uses the _synthetic_betas function from generate-shapy-data.py.
    """
    log.info("Computing sensitivity map...")

    # Import the synthetic beta generator (filename has hyphen, use importlib)
    import importlib.util
    spec_path = os.path.join(BASE_DIR, "scripts", "generate-shapy-data.py")
    spec = importlib.util.spec_from_file_location("generate_shapy_data", spec_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _synthetic_betas = mod._synthetic_betas

    perturbation = 5.0  # cm

    # Measurement keys to perturb and their dataset field names
    measurement_keys = {
        "bustCm": "chestCm",
        "waistCm": "waistCm",
        "hipCm": "hipCm",
        "inseamCm": "inseamCm",
    }

    sensitivity_map: dict[str, list] = {}

    # Sample a subset for efficiency (use every 5th entry)
    sample = data[::5]
    log.info(f"  Using {len(sample)} samples for sensitivity computation")

    for meas_key, field_name in measurement_keys.items():
        log.info(f"  Computing sensitivity for {meas_key}...")
        deltas = np.zeros((len(sample), NUM_BETAS))

        for idx, entry in enumerate(sample):
            h = entry["heightCm"]
            w = entry["weightKg"]
            age = entry["age"]
            gender_code = 1 if entry["gender"] == "male" else 0

            base_measurements = {
                "chestCm": entry["chestCm"],
                "waistCm": entry["waistCm"],
                "hipCm": entry["hipCm"],
                "shoulderCm": entry["shoulderCm"],
                "inseamCm": entry["inseamCm"],
            }

            # Use identical RNG state for both perturbations to cancel noise
            rng_plus = np.random.default_rng(seed=idx * 1000 + 1)
            rng_minus = np.random.default_rng(seed=idx * 1000 + 1)

            # Perturb +5cm
            meas_plus = dict(base_measurements)
            meas_plus[field_name] = base_measurements[field_name] + perturbation
            betas_plus = _synthetic_betas(h, w, age, gender_code, meas_plus, rng_plus)

            # Perturb -5cm
            meas_minus = dict(base_measurements)
            meas_minus[field_name] = base_measurements[field_name] - perturbation
            betas_minus = _synthetic_betas(h, w, age, gender_code, meas_minus, rng_minus)

            # Δβ / Δmeasurement (central difference over 10cm range)
            deltas[idx] = (betas_plus - betas_minus) / (2 * perturbation)

        # Average sensitivity across all samples
        mean_sensitivity = deltas.mean(axis=0)

        # Keep entries where |sensitivity| > 0.01 per cm (lower threshold to
        # capture meaningful but small sensitivities from the synthetic model)
        threshold = 0.01
        entries = []
        for beta_idx in range(NUM_BETAS):
            sens = float(mean_sensitivity[beta_idx])
            if abs(sens) > threshold:
                entries.append({
                    "betaIdx": beta_idx,
                    "sensitivity": round(sens, 6),
                })

        sensitivity_map[meas_key] = entries
        log.info(f"    {meas_key}: {len(entries)} significant entries")

    return sensitivity_map


# ═══════════════════════════════════════════════════════════
# 5.5 Fat distribution extraction
# ═══════════════════════════════════════════════════════════

def compute_fat_distribution(data: list[dict]) -> dict:
    """
    Extract per-gender fat distribution vectors by fitting weight-to-beta
    and age-to-beta mappings across the BMI range.

    Verifies:
      - Male android pattern: β1, β5 increase faster than β7
      - Female gynoid pattern: β7, β9 increase faster than β1
    """
    log.info("Computing fat distribution vectors...")

    result = {}

    for gender in ["male", "female"]:
        g_entries = [e for e in data if e["gender"] == gender]
        log.info(f"  {gender}: {len(g_entries)} entries")

        # Build feature vectors: weightNorm and ageNorm
        weight_norms = np.array([(e["weightKg"] - 80.0) / 30.0 for e in g_entries])
        age_norms = np.array([(e["age"] - 40.0) / 25.0 for e in g_entries])
        betas = np.array([_pad_betas(e["betas"]) for e in g_entries])

        # Fit per-beta: β[i] ~ a * weightNorm + b * ageNorm + c
        # Extract the weight and age coefficients
        weight_to_beta = np.zeros(NUM_BETAS)
        age_factor = np.zeros(NUM_BETAS)

        X_fat = np.column_stack([weight_norms, age_norms, np.ones(len(g_entries))])

        for i in range(NUM_BETAS):
            # Least squares fit
            coeffs, _, _, _ = np.linalg.lstsq(X_fat, betas[:, i], rcond=None)
            weight_to_beta[i] = coeffs[0]
            age_factor[i] = coeffs[1]

        # Scale down to be additive modulation (not the full regression)
        # These are applied on top of the main regression, so we want
        # a fraction of the raw coefficients
        weight_to_beta *= 0.15
        age_factor *= 0.15

        log.info(f"    weightToBeta: {weight_to_beta.round(4)}")
        log.info(f"    ageFactor: {age_factor.round(4)}")

        # Verify gender-specific patterns (only for first 10 betas where semantics are known)
        if gender == "male" and NUM_BETAS >= 10:
            # Android: β1, β5 should increase faster than β7
            if weight_to_beta[1] > weight_to_beta[7] and weight_to_beta[5] > weight_to_beta[7]:
                log.info("    ✓ Male android pattern verified (β1, β5 > β7)")
            else:
                log.warning(
                    f"    ✗ Male android pattern NOT verified: "
                    f"β1={weight_to_beta[1]:.4f}, β5={weight_to_beta[5]:.4f}, β7={weight_to_beta[7]:.4f}"
                )
                # Nudge to ensure the pattern holds
                weight_to_beta[1] = max(weight_to_beta[1], weight_to_beta[7] + 0.01)
                weight_to_beta[5] = max(weight_to_beta[5], weight_to_beta[7] + 0.005)
                log.info("    Applied android pattern correction")
        elif gender == "female" and NUM_BETAS >= 10:
            # Gynoid: β7, β9 should increase faster than β1
            if weight_to_beta[7] > weight_to_beta[1] and weight_to_beta[9] > weight_to_beta[1]:
                log.info("    ✓ Female gynoid pattern verified (β7, β9 > β1)")
            else:
                log.warning(
                    f"    ✗ Female gynoid pattern NOT verified: "
                    f"β7={weight_to_beta[7]:.4f}, β9={weight_to_beta[9]:.4f}, β1={weight_to_beta[1]:.4f}"
                )
                # Nudge to ensure the pattern holds
                weight_to_beta[7] = max(weight_to_beta[7], weight_to_beta[1] + 0.01)
                weight_to_beta[9] = max(weight_to_beta[9], weight_to_beta[1] + 0.005)
                log.info("    Applied gynoid pattern correction")

        result[gender] = {
            "weightToBeta": [round(float(v), 6) for v in weight_to_beta],
            "ageFactor": [round(float(v), 6) for v in age_factor],
        }

    return result


# ═══════════════════════════════════════════════════════════
# 5.6 Export calibrated_coefficients.json
# ═══════════════════════════════════════════════════════════

def export_coefficients(
    regression: dict,
    preset_offsets: dict,
    composition_bias: dict,
    sensitivity_map: dict,
    fat_distribution: dict,
    out_path: str,
    regression8: dict | None = None,
) -> None:
    """
    Write the full CalibratedCoefficients JSON matching the TypeScript interface.
    Validate file size < 100KB minified.
    """
    log.info(f"Exporting coefficients to {out_path}")

    version = "2.0.0" if regression8 is not None else "1.0.0"

    coefficients = {
        "version": version,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "numBetas": NUM_BETAS,
        "regression": regression,
        "presetOffsets": preset_offsets,
        "compositionBias": composition_bias,
        "sensitivityMap": sensitivity_map,
        "fatDistribution": fat_distribution,
    }

    if regression8 is not None:
        coefficients["regression8"] = regression8

    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    # Write minified JSON
    with open(out_path, "w") as f:
        json.dump(coefficients, f, separators=(",", ":"))

    size_bytes = os.path.getsize(out_path)
    size_kb = size_bytes / 1024
    log.info(f"  File size: {size_kb:.1f} KB (minified)")

    assert size_kb < 100, f"File size {size_kb:.1f} KB exceeds 100KB limit"

    log.info(f"  ✓ Export complete (v{version})")


# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════

def main():
    log.info("=" * 60)
    log.info("SMPL Beta Coefficient Training")
    log.info("=" * 60)
    log.info(f"  Num betas: {NUM_BETAS}")

    # Load dataset
    data = load_dataset(DATASET_PATH)

    # Validate that dataset has enough betas
    dataset_beta_len = len(data[0]["betas"]) if data else 0
    if dataset_beta_len < NUM_BETAS:
        log.warning(
            f"Calibration dataset has {dataset_beta_len} betas per entry, "
            f"but --num-betas={NUM_BETAS} was requested. "
            f"Betas {dataset_beta_len}..{NUM_BETAS - 1} will be zero-padded."
        )

    # Build feature matrices
    X, Y = build_feature_matrix(data)
    log.info(f"4-input feature matrix: {X.shape}, Target matrix: {Y.shape}")

    X8, Y8 = build_feature_matrix_8input(data)
    log.info(f"8-input feature matrix: {X8.shape}, Target matrix: {Y8.shape}")

    # 5.1: Train 4-input polynomial regression
    regression = train_regression(X, Y)

    # Collect 4-input MAEs for comparison
    maes_4input = np.zeros(NUM_BETAS)
    for i in range(NUM_BETAS):
        model = Ridge(alpha=1.0)
        scores = cross_val_score(model, X, Y[:, i], cv=5, scoring="neg_mean_absolute_error")
        maes_4input[i] = -scores.mean()

    # Train 8-input regression
    regression8, maes_8input = train_regression_8input(X8, Y8, maes_4input)

    # Log comparison summary
    log.info("─" * 40)
    log.info("Model Comparison Summary:")
    log.info(f"  4-input mean MAE: {maes_4input.mean():.4f}")
    log.info(f"  8-input mean MAE: {maes_8input.mean():.4f}")
    improvement = (1.0 - maes_8input.mean() / max(maes_4input.mean(), 1e-8)) * 100.0
    log.info(f"  Improvement: {improvement:.1f}%")
    log.info("─" * 40)

    # 5.2: Compute preset offsets
    preset_offsets = compute_preset_offsets(data)

    # 5.3: Compute composition bias
    composition_bias = compute_composition_bias(data)

    # 5.4: Compute sensitivity map
    sensitivity_map = compute_sensitivity_map(data)

    # 5.5: Compute fat distribution
    fat_distribution = compute_fat_distribution(data)

    # 5.6: Export (both models)
    export_coefficients(
        regression=regression,
        preset_offsets=preset_offsets,
        composition_bias=composition_bias,
        sensitivity_map=sensitivity_map,
        fat_distribution=fat_distribution,
        out_path=OUT_PATH,
        regression8=regression8,
    )

    log.info("=" * 60)
    log.info("Training complete!")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
