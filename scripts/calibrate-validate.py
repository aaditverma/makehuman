"""
Calibration-mode validation: ANSUR II round-trip bias correction.

Replicates the TypeScript pipeline in Python:
  input measurements → calibrated betas → SMPL forward pass → extract measurements → compare

Processes 50+ curated ANSUR II subjects spanning BMI 18–35, both genders, ages 20–55.
Computes per-measurement bias (mean signed error) and scale factor.
If bias exceeds 2cm, outputs correction factors as JSON patch.

Output: scripts/data/correction_factors.json

Usage:
    python scripts/calibrate-validate.py
"""

import os
import json
import struct
import math
import logging
import numpy as np
import pandas as pd

# ── Paths ────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "data")
OUT_DIR = os.path.join(BASE_DIR, "scripts", "data")

MALE_CSV = os.path.join(DATA_DIR, "ansur2_male.csv")
FEMALE_CSV = os.path.join(DATA_DIR, "ansur2_female.csv")
COEFFICIENTS_PATH = os.path.join(DATA_DIR, "calibrated_coefficients.json")
SMPL_MODEL_PATH = os.path.join(BASE_DIR, "public", "models", "smpl", "smpl_model.bin")
LANDMARKS_PATH = os.path.join(BASE_DIR, "public", "models", "smpl", "smpl_landmarks.json")
OUT_PATH = os.path.join(OUT_DIR, "correction_factors.json")

# ── Constants (must match TypeScript) ────────────────────
SMPL_MAGIC = 0x534D504C
SMPL_VERTEX_COUNT = 6890
SMPL_FACE_COUNT = 13776
SMPL_SHAPE_COUNT = 10
SMPL_JOINT_COUNT = 24
SMPL_HEADER_BYTES = 16

NUM_BETAS = 10
BIAS_THRESHOLD_CM = 2.0
MIN_SUBJECTS = 50

# Measurement extraction constants (match measurementExtractor.ts)
BAND_HALF_WIDTH = 0.015  # 1.5cm in meters
TORSO_X_LIMIT = 0.18     # meters

HEIGHT_FRACTIONS = {
    "neck": 0.85,
    "shoulder": 0.77,
    "chest": 0.68,
    "bicep": 0.62,
    "waist": 0.58,
    "hip": 0.50,
    "wrist": 0.48,
    "thigh": 0.36,
    "calf": 0.18,
}

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════
# 1. SMPL Model Binary Parsing (mirrors parseSmplBinary in TS)
# ═══════════════════════════════════════════════════════════

class SmplModelData:
    """Parsed SMPL model data from binary file."""

    def __init__(
        self,
        template_vertices: np.ndarray,
        shape_blend_shapes: np.ndarray,
        face_indices: np.ndarray,
        joint_regressor: np.ndarray,
        landmark_vertex_indices: dict[str, int],
    ):
        self.template_vertices = template_vertices      # (6890, 3) float32
        self.shape_blend_shapes = shape_blend_shapes    # (10, 6890, 3) float32
        self.face_indices = face_indices                # (13776, 3) uint16
        self.joint_regressor = joint_regressor          # (24, 6890) float32
        self.landmark_vertex_indices = landmark_vertex_indices


def parse_smpl_binary(path: str) -> SmplModelData:
    """
    Parse SMPL binary file matching the TypeScript parseSmplBinary() layout.

    Binary layout:
      Header (16 bytes):
        magic:         uint32 LE
        version:       uint16 LE
        vertexCount:   uint16 LE
        faceCount:     uint16 LE
        shapeCount:    uint16 LE
        landmarkCount: uint16 LE
        reserved:      uint16 LE
      Data sections:
        Template vertices:  float32[vertexCount × 3]
        Shape blend shapes: float32[shapeCount × vertexCount × 3]
        Face indices:       uint16[faceCount × 3]
        Joint regressor:    float32[24 × vertexCount]
        Landmark pairs:     uint16[landmarkCount × 2]
        Landmark strings:   null-terminated UTF-8
    """
    log.info(f"Loading SMPL model from {path}")

    with open(path, "rb") as f:
        data = f.read()

    buf = memoryview(data)
    offset = 0

    # Parse header
    magic, version, vertex_count, face_count, shape_count, landmark_count, _ = struct.unpack_from(
        "<IHHHHHh", data, offset
    )
    offset = SMPL_HEADER_BYTES

    assert magic == SMPL_MAGIC, f"Invalid magic: 0x{magic:08X}"
    assert vertex_count == SMPL_VERTEX_COUNT, f"Unexpected vertex count: {vertex_count}"
    assert face_count == SMPL_FACE_COUNT, f"Unexpected face count: {face_count}"
    assert shape_count == SMPL_SHAPE_COUNT, f"Unexpected shape count: {shape_count}"

    log.info(f"  Header: v{version}, {vertex_count} verts, {face_count} faces, "
             f"{shape_count} shapes, {landmark_count} landmarks")

    # Template vertices: float32[vertexCount × 3]
    n_template = vertex_count * 3
    template_vertices = np.frombuffer(data, dtype=np.float32, count=n_template, offset=offset)
    template_vertices = template_vertices.reshape(vertex_count, 3).copy()
    offset += n_template * 4

    # Shape blend shapes: float32[shapeCount × vertexCount × 3]
    n_blend = shape_count * vertex_count * 3
    shape_blend_shapes = np.frombuffer(data, dtype=np.float32, count=n_blend, offset=offset)
    shape_blend_shapes = shape_blend_shapes.reshape(shape_count, vertex_count, 3).copy()
    offset += n_blend * 4

    # Face indices: uint16[faceCount × 3]
    n_faces = face_count * 3
    face_indices = np.frombuffer(data, dtype=np.uint16, count=n_faces, offset=offset)
    face_indices = face_indices.reshape(face_count, 3).copy()
    offset += n_faces * 2

    # Joint regressor: float32[24 × vertexCount]
    n_joints = SMPL_JOINT_COUNT * vertex_count
    joint_regressor = np.frombuffer(data, dtype=np.float32, count=n_joints, offset=offset)
    joint_regressor = joint_regressor.reshape(SMPL_JOINT_COUNT, vertex_count).copy()
    offset += n_joints * 4

    # Landmark pairs: uint16[landmarkCount × 2]
    n_landmark_pairs = landmark_count * 2
    landmark_pairs = np.frombuffer(data, dtype=np.uint16, count=n_landmark_pairs, offset=offset)
    landmark_pairs = landmark_pairs.reshape(landmark_count, 2).copy()
    offset += n_landmark_pairs * 2

    # Landmark name strings: null-terminated UTF-8
    string_table = data[offset:]
    landmark_vertex_indices = {}
    for i in range(landmark_count):
        vertex_idx = int(landmark_pairs[i, 0])
        name_offset = int(landmark_pairs[i, 1])
        # Find null terminator
        end = name_offset
        while end < len(string_table) and string_table[end] != 0:
            end += 1
        name = string_table[name_offset:end].decode("utf-8")
        landmark_vertex_indices[name] = vertex_idx

    log.info(f"  Landmarks: {list(landmark_vertex_indices.keys())}")

    return SmplModelData(
        template_vertices=template_vertices,
        shape_blend_shapes=shape_blend_shapes,
        face_indices=face_indices,
        joint_regressor=joint_regressor,
        landmark_vertex_indices=landmark_vertex_indices,
    )


# ═══════════════════════════════════════════════════════════
# 2. Calibrated Beta Regression (mirrors lookupRegress in TS)
# ═══════════════════════════════════════════════════════════

def compute_calibrated_betas(
    coeffs: dict,
    height_cm: float,
    weight_kg: float,
    age: float,
    gender: str,
) -> np.ndarray:
    """
    Replicate the calibrated lookupRegress() path from smplRegressor.ts.

    Computes: β[i] = intercept[i] + Σ(weights[i][j] × feature[j])
    Then applies fat distribution modulation.
    """
    reg = coeffs["regression"]
    norm = reg["normalization"]

    # Compute normalized features
    height_norm = (height_cm - norm["heightNorm"]["center"]) / norm["heightNorm"]["range"]
    weight_norm = (weight_kg - norm["weightNorm"]["center"]) / norm["weightNorm"]["range"]
    age_norm = (age - norm["ageNorm"]["center"]) / norm["ageNorm"]["range"]
    gender_sign = 1.0 if gender == "male" else -1.0
    bmi = weight_kg / max(0.01, (height_cm / 100.0) ** 2)
    bmi_norm = (bmi - norm["bmiNorm"]["center"]) / norm["bmiNorm"]["range"]
    hw_interaction = height_norm * weight_norm
    bmi_sq = bmi_norm * bmi_norm

    features = np.array([height_norm, weight_norm, age_norm, gender_sign, bmi_norm, hw_interaction, bmi_sq])

    # Compute betas: β[i] = intercept[i] + Σ(weights[i][j] × feature[j])
    intercepts = np.array(reg["intercepts"])
    weights = np.array(reg["weights"])
    betas = intercepts + weights @ features

    # Apply fat distribution modulation
    fat_dist = coeffs["fatDistribution"][gender]
    weight_to_beta = np.array(fat_dist["weightToBeta"])
    age_factor = np.array(fat_dist["ageFactor"])
    betas += weight_to_beta * weight_norm + age_factor * age_norm

    # Clamp to [-3, 3]
    betas = np.clip(betas, -3.0, 3.0)

    return betas


# ═══════════════════════════════════════════════════════════
# 3. SMPL Forward Pass (mirrors computeSmplVertices in TS)
# ═══════════════════════════════════════════════════════════

def compute_smpl_vertices(model: SmplModelData, betas: np.ndarray) -> np.ndarray:
    """
    V = T + Σ(βᵢ × Sᵢ)

    Returns (6890, 3) float32 vertex positions.
    """
    vertices = model.template_vertices.copy()
    for i in range(NUM_BETAS):
        if betas[i] != 0:
            vertices += betas[i] * model.shape_blend_shapes[i]
    return vertices


# ═══════════════════════════════════════════════════════════
# 4. Measurement Extraction (mirrors measurementExtractor.ts)
# ═══════════════════════════════════════════════════════════

def _compute_body_height(vertices: np.ndarray) -> tuple[float, float, float]:
    """Returns (min_y, max_y, height)."""
    min_y = vertices[:, 1].min()
    max_y = vertices[:, 1].max()
    return float(min_y), float(max_y), float(max_y - min_y)


def _get_landmark_y(model: SmplModelData, vertices: np.ndarray, name: str) -> float | None:
    """Get Y-coordinate of a named landmark vertex."""
    idx = model.landmark_vertex_indices.get(name)
    if idx is None:
        return None
    return float(vertices[idx, 1])


def _resolve_height(
    model: SmplModelData,
    vertices: np.ndarray,
    landmark_name: str | None,
    fraction_key: str,
    body_min_y: float,
    body_height: float,
) -> float:
    """Resolve Y-height for a measurement using landmark or fallback fraction."""
    if landmark_name:
        y = _get_landmark_y(model, vertices, landmark_name)
        if y is not None:
            return y
    fraction = HEIGHT_FRACTIONS.get(fraction_key, 0.5)
    return body_min_y + fraction * body_height


def _collect_band_vertices(
    vertices: np.ndarray,
    target_y: float,
    half_width: float,
) -> np.ndarray:
    """Collect vertices within a horizontal band. Returns Nx2 array of (x, z)."""
    mask = np.abs(vertices[:, 1] - target_y) <= half_width
    return vertices[mask][:, [0, 2]]  # x, z columns


def _filter_torso(points: np.ndarray, x_limit: float) -> np.ndarray:
    """Filter to torso-only by excluding large |x| values."""
    if len(points) == 0:
        return points
    mask = np.abs(points[:, 0]) <= x_limit
    return points[mask]


def _filter_left_side(points: np.ndarray) -> np.ndarray:
    """Filter to left side of body (positive x in SMPL)."""
    if len(points) == 0:
        return points
    mask = points[:, 0] > 0.02
    return points[mask]


def _compute_perimeter(points: np.ndarray) -> float:
    """Sort points by angle around centroid and compute polygon perimeter (meters)."""
    if len(points) < 3:
        return 0.0

    cx = points[:, 0].mean()
    cz = points[:, 1].mean()

    angles = np.arctan2(points[:, 1] - cz, points[:, 0] - cx)
    order = np.argsort(angles)
    sorted_pts = points[order]

    # Sum distances between consecutive points (closed polygon)
    diffs = np.diff(sorted_pts, axis=0, append=sorted_pts[:1])
    perimeter = float(np.sqrt((diffs ** 2).sum(axis=1)).sum())
    return perimeter


def _measure_circumference(
    vertices: np.ndarray,
    target_y: float,
    mode: str,
) -> float:
    """Measure circumference at a given Y-height. Returns cm."""
    points = _collect_band_vertices(vertices, target_y, BAND_HALF_WIDTH)

    if mode == "torso":
        points = _filter_torso(points, TORSO_X_LIMIT)
    elif mode == "left":
        points = _filter_left_side(points)

    perimeter_m = _compute_perimeter(points)
    return perimeter_m * 100.0  # meters to cm


def _measure_shoulder(
    model: SmplModelData,
    vertices: np.ndarray,
    shoulder_y: float,
) -> float:
    """Measure shoulder width (distance between landmarks, in cm)."""
    left_idx = model.landmark_vertex_indices.get("left_shoulder")
    right_idx = model.landmark_vertex_indices.get("right_shoulder")

    if left_idx is not None and right_idx is not None:
        diff = vertices[left_idx] - vertices[right_idx]
        dist = float(np.linalg.norm(diff))
        return dist * 100.0  # meters to cm

    # Fallback: circumference × 0.45
    circ = _measure_circumference(vertices, shoulder_y, "torso")
    return circ * 0.45


def _measure_inseam(
    model: SmplModelData,
    vertices: np.ndarray,
    hip_y: float,
    body_min_y: float,
    body_height: float,
) -> float:
    """Measure inseam (crotch to ankle vertical distance, in cm)."""
    ankle_idx = model.landmark_vertex_indices.get("left_ankle")
    if ankle_idx is not None:
        ankle_y = float(vertices[ankle_idx, 1])
    else:
        ankle_y = body_min_y + 0.05 * body_height

    crotch_y = body_min_y + 0.45 * body_height
    inseam_m = abs(crotch_y - ankle_y)
    return inseam_m * 100.0


def extract_measurements(model: SmplModelData, vertices: np.ndarray) -> dict[str, float]:
    """
    Extract body measurements from SMPL mesh vertices.
    Mirrors extractMeasurements() in measurementExtractor.ts.
    """
    min_y, max_y, body_height = _compute_body_height(vertices)

    chest_y = _resolve_height(model, vertices, "chest_center", "chest", min_y, body_height)
    waist_y = _resolve_height(model, vertices, "waist_center", "waist", min_y, body_height)
    hip_y = _resolve_height(model, vertices, "hip_center", "hip", min_y, body_height)
    shoulder_y = _resolve_height(model, vertices, "left_shoulder", "shoulder", min_y, body_height)

    chest_cm = _measure_circumference(vertices, chest_y, "torso")
    waist_cm = _measure_circumference(vertices, waist_y, "torso")
    hip_cm = _measure_circumference(vertices, hip_y, "torso")
    shoulder_cm = _measure_shoulder(model, vertices, shoulder_y)
    inseam_cm = _measure_inseam(model, vertices, hip_y, min_y, body_height)

    return {
        "chestCm": chest_cm,
        "waistCm": waist_cm,
        "hipCm": hip_cm,
        "shoulderCm": shoulder_cm,
        "inseamCm": inseam_cm,
    }


# ═══════════════════════════════════════════════════════════
# 5. ANSUR II Loading and Subject Curation
# ═══════════════════════════════════════════════════════════

def load_ansur_subjects(csv_path: str, gender: str) -> list[dict]:
    """Load ANSUR II subjects from CSV. Returns list of subject dicts."""
    df = pd.read_csv(csv_path, encoding="latin-1")
    df.columns = [c.lower() for c in df.columns]

    subjects = []
    for _, row in df.iterrows():
        try:
            stature_mm = float(row["stature"])
            weight_hg = float(row["weightkg"])
            age = int(row["age"])
            chest_mm = float(row["chestcircumference"])
            waist_mm = float(row["waistcircumference"])
            hip_mm = float(row["buttockcircumference"])
            crotch_mm = float(row["crotchheight"])
        except (ValueError, KeyError):
            continue

        if any(math.isnan(v) for v in [stature_mm, weight_hg, age, chest_mm, waist_mm, hip_mm, crotch_mm]):
            continue

        height_cm = stature_mm / 10.0
        weight_kg = weight_hg / 10.0
        bmi = weight_kg / max(0.01, (height_cm / 100.0) ** 2)

        subjects.append({
            "id": str(row.get("subjectid", f"{gender}_{len(subjects)}")),
            "gender": gender,
            "age": age,
            "heightCm": height_cm,
            "weightKg": weight_kg,
            "bmi": bmi,
            "chestCm": chest_mm / 10.0,
            "waistCm": waist_mm / 10.0,
            "hipCm": hip_mm / 10.0,
            "inseamCm": crotch_mm / 10.0,
        })

    return subjects


def curate_subjects(
    males: list[dict],
    females: list[dict],
    min_count: int = MIN_SUBJECTS,
) -> list[dict]:
    """
    Curate 50+ subjects spanning BMI 18–35, both genders, ages 20–55.
    Evenly samples across BMI range for balanced coverage.
    """
    def filter_valid(subjects: list[dict]) -> list[dict]:
        return [
            s for s in subjects
            if 18 <= s["bmi"] <= 35 and 20 <= s["age"] <= 55
        ]

    valid_males = filter_valid(males)
    valid_females = filter_valid(females)

    # Sort by BMI for even spread
    valid_males.sort(key=lambda s: s["bmi"])
    valid_females.sort(key=lambda s: s["bmi"])

    half = min_count // 2
    male_count = half
    female_count = min_count - half

    def sample_evenly(arr: list[dict], n: int) -> list[dict]:
        if len(arr) <= n:
            return arr
        stride = len(arr) / n
        return [arr[int(i * stride)] for i in range(n)]

    curated = sample_evenly(valid_males, male_count) + sample_evenly(valid_females, female_count)

    log.info(f"Curated {len(curated)} subjects "
             f"({sum(1 for s in curated if s['gender'] == 'male')} male, "
             f"{sum(1 for s in curated if s['gender'] == 'female')} female)")

    bmi_vals = [s["bmi"] for s in curated]
    age_vals = [s["age"] for s in curated]
    log.info(f"  BMI range: {min(bmi_vals):.1f} – {max(bmi_vals):.1f}")
    log.info(f"  Age range: {min(age_vals)} – {max(age_vals)}")

    return curated


# ═══════════════════════════════════════════════════════════
# 6. Bias Computation and Correction Factor Generation
# ═══════════════════════════════════════════════════════════

MEASUREMENT_KEYS = ["chestCm", "waistCm", "hipCm", "inseamCm"]

# Map measurement keys to the beta indices from the sensitivity map
# that are most relevant for bias correction
MEASUREMENT_BETA_INDICES = {
    "chestCm": [5, 6, 8],
    "waistCm": [1, 3],
    "hipCm": [7, 9],
    "inseamCm": [4],
}


def compute_bias_and_scale(
    subjects: list[dict],
    model: SmplModelData,
    coeffs: dict,
) -> dict[str, dict]:
    """
    Run the full round-trip pipeline for each subject and compute
    per-measurement bias (mean signed error) and scale factor.

    Returns dict keyed by measurement name with:
      - signed_errors: list of (extracted - ground_truth)
      - bias: mean signed error
      - scale_factor: mean(extracted / ground_truth)
      - abs_errors: list of |extracted - ground_truth|
      - mean_abs_error: mean absolute error
      - median_abs_error: median absolute error
      - p90_abs_error: 90th percentile absolute error
      - within_3cm: percentage within 3cm
      - within_5cm: percentage within 5cm
    """
    results = {key: {"signed_errors": [], "ratios": [], "abs_errors": []} for key in MEASUREMENT_KEYS}

    for i, subject in enumerate(subjects):
        # Compute calibrated betas (base regression only, no preset/composition)
        betas = compute_calibrated_betas(
            coeffs,
            subject["heightCm"],
            subject["weightKg"],
            subject["age"],
            subject["gender"],
        )

        # SMPL forward pass
        vertices = compute_smpl_vertices(model, betas)

        # Extract measurements
        extracted = extract_measurements(model, vertices)

        # Compare with ground truth
        for key in MEASUREMENT_KEYS:
            gt = subject[key]
            ext = extracted[key]
            signed_error = ext - gt
            abs_error = abs(signed_error)
            ratio = ext / max(gt, 0.01)

            results[key]["signed_errors"].append(signed_error)
            results[key]["abs_errors"].append(abs_error)
            results[key]["ratios"].append(ratio)

    # Compute statistics
    stats = {}
    for key in MEASUREMENT_KEYS:
        signed = np.array(results[key]["signed_errors"])
        abs_errs = np.array(results[key]["abs_errors"])
        ratios = np.array(results[key]["ratios"])

        sorted_abs = np.sort(abs_errs)
        n = len(sorted_abs)

        stats[key] = {
            "bias": float(signed.mean()),
            "scale_factor": float(ratios.mean()),
            "mean_abs_error": float(abs_errs.mean()),
            "median_abs_error": float(np.median(abs_errs)),
            "p90_abs_error": float(sorted_abs[min(int(n * 0.9), n - 1)]),
            "within_3cm": float((abs_errs <= 3.0).sum() / n * 100),
            "within_5cm": float((abs_errs <= 5.0).sum() / n * 100),
            "signed_errors": results[key]["signed_errors"],
        }

    return stats


def generate_correction_factors(
    stats: dict[str, dict],
    coeffs: dict,
) -> dict | None:
    """
    If any measurement has bias > 2cm, generate correction factors.

    Returns CorrectionFactors dict or None if no corrections needed.

    CorrectionFactors format:
    {
      "biasCorrections": {
        "chestCm": { "betaAdjustments": [{ "betaIdx": 0, "adjustment": 0.1 }, ...] },
        ...
      },
      "scaleCorrections": {
        "chestCm": 1.05,
        ...
      }
    }
    """
    needs_correction = False
    for key in MEASUREMENT_KEYS:
        if abs(stats[key]["bias"]) > BIAS_THRESHOLD_CM:
            needs_correction = True
            break

    if not needs_correction:
        log.info("No measurements exceed bias threshold of 2cm. No corrections needed.")
        return None

    bias_corrections = {}
    scale_corrections = {}

    sens_map = coeffs.get("sensitivityMap", {})

    for key in MEASUREMENT_KEYS:
        bias = stats[key]["bias"]
        scale = stats[key]["scale_factor"]

        if abs(bias) > BIAS_THRESHOLD_CM:
            log.info(f"  {key}: bias={bias:.2f}cm, scale={scale:.4f} — generating correction")

            # Compute beta adjustments to counteract the bias
            # Use the sensitivity map to distribute the correction across relevant betas
            adjustments = []
            sens_entries = sens_map.get(key, [])

            if sens_entries:
                # Distribute correction proportionally to sensitivity magnitudes
                total_sens = sum(abs(e["sensitivity"]) for e in sens_entries)
                for entry in sens_entries:
                    beta_idx = entry["betaIdx"]
                    sensitivity = entry["sensitivity"]
                    # Adjustment = -bias * (sensitivity_share / sensitivity)
                    # This nudges the beta to reduce the extracted measurement by `bias`
                    if abs(sensitivity) > 1e-8 and total_sens > 1e-8:
                        share = abs(sensitivity) / total_sens
                        adjustment = -bias * share / (sensitivity * 100.0)  # sensitivity is per-cm in model units
                        adjustments.append({
                            "betaIdx": beta_idx,
                            "adjustment": round(adjustment, 6),
                        })
            else:
                # Fallback: use the default beta indices for this measurement
                beta_indices = MEASUREMENT_BETA_INDICES.get(key, [])
                for beta_idx in beta_indices:
                    adjustment = -bias / (len(beta_indices) * 5.0)  # heuristic scaling
                    adjustments.append({
                        "betaIdx": beta_idx,
                        "adjustment": round(adjustment, 6),
                    })

            bias_corrections[key] = {"betaAdjustments": adjustments}
            scale_corrections[key] = round(1.0 / scale, 6) if abs(scale) > 1e-8 else 1.0

    return {
        "biasCorrections": bias_corrections,
        "scaleCorrections": scale_corrections,
    }


# ═══════════════════════════════════════════════════════════
# 7. Report and Main
# ═══════════════════════════════════════════════════════════

def print_report(stats: dict[str, dict], subjects: list[dict]) -> None:
    """Print a formatted validation summary report."""
    n_male = sum(1 for s in subjects if s["gender"] == "male")
    n_female = len(subjects) - n_male

    print()
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║     Calibration-Mode Validation: Bias Correction Report    ║")
    print("╠══════════════════════════════════════════════════════════════╣")
    print(f"║  Subjects: {len(subjects):>4}  (Male: {n_male}, Female: {n_female})" +
          " " * (60 - 30 - len(str(len(subjects))) - len(str(n_male)) - len(str(n_female))) + "║")
    print("╠══════════════════════════════════════════════════════════════╣")
    print("║  Measurement │  Bias  │ Scale  │  MAE   │ P90    │ ≤5cm   ║")
    print("╠══════════════════════════════════════════════════════════════╣")

    for key in MEASUREMENT_KEYS:
        s = stats[key]
        name = key.replace("Cm", "").capitalize()
        bias_str = f"{s['bias']:+.1f}"
        scale_str = f"{s['scale_factor']:.3f}"
        mae_str = f"{s['mean_abs_error']:.1f}"
        p90_str = f"{s['p90_abs_error']:.1f}"
        w5_str = f"{s['within_5cm']:.0f}%"
        flag = " ⚠" if abs(s["bias"]) > BIAS_THRESHOLD_CM else "  "

        print(f"║  {name:<12}│ {bias_str:>5}  │ {scale_str:>5}  │ {mae_str:>5}  │ {p90_str:>5}  │ {w5_str:>5} {flag}║")

    print("╚══════════════════════════════════════════════════════════════╝")
    print()


def main():
    log.info("=" * 60)
    log.info("Calibration-Mode Validation: ANSUR II Bias Correction")
    log.info("=" * 60)

    # 1. Load calibrated coefficients
    log.info(f"Loading coefficients from {COEFFICIENTS_PATH}")
    with open(COEFFICIENTS_PATH) as f:
        coeffs = json.load(f)
    log.info(f"  Version: {coeffs.get('version', 'unknown')}")

    # 2. Load SMPL model binary
    model = parse_smpl_binary(SMPL_MODEL_PATH)

    # 3. Load ANSUR II subjects
    log.info("Loading ANSUR II subjects...")
    males = load_ansur_subjects(MALE_CSV, "male")
    females = load_ansur_subjects(FEMALE_CSV, "female")
    log.info(f"  Males: {len(males)}, Females: {len(females)}")

    # 4. Curate subjects
    subjects = curate_subjects(males, females, min_count=MIN_SUBJECTS)
    assert len(subjects) >= MIN_SUBJECTS, (
        f"Only {len(subjects)} subjects curated, need at least {MIN_SUBJECTS}"
    )

    # 5. Compute bias and scale
    log.info("Running round-trip pipeline for all subjects...")
    stats = compute_bias_and_scale(subjects, model, coeffs)

    # 6. Print report
    print_report(stats, subjects)

    # 7. Generate correction factors if needed
    corrections = generate_correction_factors(stats, coeffs)

    if corrections is not None:
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(OUT_PATH, "w") as f:
            json.dump(corrections, f, indent=2)
        log.info(f"Correction factors written to {OUT_PATH}")

        # Log details
        for key, corr in corrections["biasCorrections"].items():
            log.info(f"  {key}:")
            for adj in corr["betaAdjustments"]:
                log.info(f"    β{adj['betaIdx']}: {adj['adjustment']:+.6f}")
        for key, scale in corrections["scaleCorrections"].items():
            log.info(f"  {key} scale correction: {scale:.6f}")
    else:
        log.info("All measurements within bias threshold. No correction file generated.")

    log.info("=" * 60)
    log.info("Calibration validation complete.")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
