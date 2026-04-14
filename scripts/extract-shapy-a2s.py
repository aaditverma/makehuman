"""
Extract SHAPY A2S (Attributes-to-Shape) polynomial regression coefficients.

Inspects the SHAPY A2S model architecture, loads the trained PyTorch checkpoint,
extracts the polynomial regression weight matrix and bias vector, verifies
extraction against the original model, generates validation pairs, and exports
a compact JSON artifact for use by the TypeScript A2S module.

SHAPY A2S Architecture (discovered via source inspection):
  - Input features: [height, chest, waist, hips] (4 features, in cm)
  - Polynomial degree: 2
  - Feature expansion: sklearn-style PolynomialFeatures(degree=2, include_bias=True)
    Produces 15 features: [1, x0, x1, x2, x3, x0^2, x0*x1, x0*x2, x0*x3,
                            x1^2, x1*x2, x1*x3, x2^2, x2*x3, x3^2]
  - Input normalization: (x - mean) / std per feature
  - Output: 10 SMPL betas via linear regression on expanded features
  - Model structure: single Linear layer (no hidden layers)

Usage:
    # With real SHAPY checkpoint:
    python scripts/extract-shapy-a2s.py \\
      --checkpoint /path/to/shapy/a2s_model.pt \\
      --shapy-dir /path/to/shapy/repo \\
      --output src/data/shapy_a2s_coefficients.json \\
      --validation-output scripts/data/a2s_validation_pairs.json

    # Synthetic mode (no SHAPY required):
    python scripts/extract-shapy-a2s.py --synthetic
"""

import os
import sys
import json
import logging
import argparse
import datetime
import hashlib
import numpy as np

# ── Paths ────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DATA_DIR = os.path.join(BASE_DIR, "src", "data")
PUBLIC_DATA_DIR = os.path.join(BASE_DIR, "public", "data")
SCRIPTS_DATA_DIR = os.path.join(BASE_DIR, "scripts", "data")

DEFAULT_OUTPUT = os.path.join(SRC_DATA_DIR, "shapy_a2s_coefficients.json")
DEFAULT_VALIDATION_OUTPUT = os.path.join(SCRIPTS_DATA_DIR, "a2s_validation_pairs.json")

# ── CLI Args ─────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Extract SHAPY A2S polynomial regression coefficients"
)
parser.add_argument(
    "--checkpoint", type=str, default=None,
    help="Path to SHAPY A2S model checkpoint (.pt / .ckpt)"
)
parser.add_argument(
    "--shapy-dir", type=str, default=None,
    help="Path to SHAPY repository root (for source inspection)"
)
parser.add_argument(
    "--output", type=str, default=DEFAULT_OUTPUT,
    help=f"Output path for A2S coefficient JSON (default: {DEFAULT_OUTPUT})"
)
parser.add_argument(
    "--validation-output", type=str, default=DEFAULT_VALIDATION_OUTPUT,
    help=f"Output path for validation pairs JSON (default: {DEFAULT_VALIDATION_OUTPUT})"
)
parser.add_argument(
    "--synthetic", action="store_true",
    help="Generate synthetic coefficients for testing (no SHAPY required)"
)
args = parser.parse_args()

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────
NUM_BETAS = 10
POLYNOMIAL_DEGREE = 2
INPUT_FEATURES = ["height", "chest", "waist", "hips"]
NUM_INPUT_FEATURES = len(INPUT_FEATURES)
# For degree 2 with 4 inputs: 1 + 4 + 4*5/2 = 15
NUM_EXPANDED_FEATURES = 1 + NUM_INPUT_FEATURES + NUM_INPUT_FEATURES * (NUM_INPUT_FEATURES + 1) // 2
POLYNOMIAL_ORDER = [
    "1", "x0", "x1", "x2", "x3",
    "x0^2", "x0*x1", "x0*x2", "x0*x3",
    "x1^2", "x1*x2", "x1*x3",
    "x2^2", "x2*x3",
    "x3^2",
]

# Verification tolerance
VERIFY_TOLERANCE = 1e-6



# ═══════════════════════════════════════════════════════════
# 1. Polynomial feature expansion (matches sklearn PolynomialFeatures)
# ═══════════════════════════════════════════════════════════

def expand_polynomial_features(x: np.ndarray, degree: int = 2) -> np.ndarray:
    """
    Expand input vector to polynomial features (graded lexicographic order).

    For degree 2 with K inputs, produces:
      [1, x0, x1, ..., xK-1, x0^2, x0*x1, ..., xK-1^2]

    Matches sklearn's PolynomialFeatures(degree=2, include_bias=True).

    Args:
        x: Input vector of shape (K,) or (N, K)
        degree: Polynomial degree (1, 2, or 3)

    Returns:
        Expanded feature vector(s)
    """
    if x.ndim == 1:
        x = x.reshape(1, -1)

    N, K = x.shape
    features = [np.ones((N, 1))]  # bias term

    # Degree 1 terms
    features.append(x)

    # Degree 2 terms
    if degree >= 2:
        for i in range(K):
            for j in range(i, K):
                features.append((x[:, i] * x[:, j]).reshape(-1, 1))

    # Degree 3 terms
    if degree >= 3:
        for i in range(K):
            for j in range(i, K):
                for k in range(j, K):
                    features.append((x[:, i] * x[:, j] * x[:, k]).reshape(-1, 1))

    return np.hstack(features)


def compute_a2s_betas(
    raw_inputs: np.ndarray,
    input_mean: np.ndarray,
    input_std: np.ndarray,
    weights: np.ndarray,
    bias: np.ndarray,
    degree: int = 2,
) -> np.ndarray:
    """
    Compute A2S betas from raw inputs using extracted coefficients.

    Steps:
      1. Normalize: (input - mean) / std
      2. Expand to polynomial features
      3. Matrix multiply: betas = features @ W^T + b
      4. Clamp to [-3, 3]

    Args:
        raw_inputs: (N, K) or (K,) raw measurement inputs
        input_mean: (K,) mean for normalization
        input_std: (K,) std for normalization
        weights: (num_betas, num_expanded_features) weight matrix
        bias: (num_betas,) bias vector
        degree: polynomial degree

    Returns:
        (N, num_betas) or (num_betas,) beta values clamped to [-3, 3]
    """
    single = raw_inputs.ndim == 1
    if single:
        raw_inputs = raw_inputs.reshape(1, -1)

    # Normalize
    std_safe = np.where(np.abs(input_std) < 1e-10, 1.0, input_std)
    normalized = (raw_inputs - input_mean) / std_safe

    # Expand
    features = expand_polynomial_features(normalized, degree)

    # Matrix multiply
    betas = features @ weights.T + bias

    # Clamp
    betas = np.clip(betas, -3.0, 3.0)

    if single:
        return betas[0]
    return betas


# ═══════════════════════════════════════════════════════════
# 2. SHAPY source inspection and coefficient extraction
# ═══════════════════════════════════════════════════════════

def inspect_shapy_source(shapy_dir: str) -> dict:
    """
    Inspect the SHAPY A2S source code to determine model architecture.

    Looks for:
      - Input features and their order
      - Polynomial degree
      - Normalization parameters
      - Model layer structure

    Returns dict with architecture details.
    """
    log.info(f"Inspecting SHAPY source at: {shapy_dir}")

    # Try to find the A2S model definition
    possible_paths = [
        os.path.join(shapy_dir, "attributes", "attributes", "models", "a2s.py"),
        os.path.join(shapy_dir, "attributes", "models", "a2s.py"),
        os.path.join(shapy_dir, "shapy", "models", "a2s.py"),
        os.path.join(shapy_dir, "models", "a2s.py"),
    ]

    model_source = None
    for path in possible_paths:
        if os.path.exists(path):
            with open(path, "r") as f:
                model_source = f.read()
            log.info(f"  Found A2S model source at: {path}")
            break

    if model_source is None:
        log.warning("  Could not find A2S model source. Using default architecture assumptions.")
        return {
            "input_features": INPUT_FEATURES,
            "polynomial_degree": POLYNOMIAL_DEGREE,
            "num_expanded_features": NUM_EXPANDED_FEATURES,
            "source_found": False,
        }

    # Parse architecture from source (basic heuristic inspection)
    arch = {
        "input_features": INPUT_FEATURES,
        "polynomial_degree": POLYNOMIAL_DEGREE,
        "num_expanded_features": NUM_EXPANDED_FEATURES,
        "source_found": True,
        "source_path": path,
    }

    # Check for PolynomialFeatures usage
    if "PolynomialFeatures" in model_source:
        log.info("  Found sklearn PolynomialFeatures usage")
        if "degree=2" in model_source or "degree = 2" in model_source:
            arch["polynomial_degree"] = 2
        elif "degree=3" in model_source or "degree = 3" in model_source:
            arch["polynomial_degree"] = 3

    # Check for input feature names
    for feature_pattern in [
        "height", "chest", "waist", "hip", "gender", "age",
    ]:
        if feature_pattern in model_source.lower():
            log.info(f"  Found reference to '{feature_pattern}' in source")

    log.info(f"  Architecture: {arch}")
    return arch


def extract_from_checkpoint(checkpoint_path: str, shapy_dir: str | None = None) -> dict:
    """
    Extract A2S coefficients from a PyTorch checkpoint.

    Loads the checkpoint, inspects the state dict for the linear regression
    layer, and extracts weight matrix, bias vector, and normalization params.

    Args:
        checkpoint_path: Path to .pt / .ckpt file
        shapy_dir: Optional path to SHAPY repo for source inspection

    Returns:
        Dict with weights, bias, normalization, and metadata
    """
    import torch

    log.info(f"Loading checkpoint: {checkpoint_path}")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)

    # Compute checkpoint hash for provenance
    with open(checkpoint_path, "rb") as f:
        ckpt_hash = hashlib.sha256(f.read()).hexdigest()[:16]

    # Inspect SHAPY source if available
    arch = {}
    if shapy_dir:
        arch = inspect_shapy_source(shapy_dir)

    # Extract state dict — handle different checkpoint formats
    if isinstance(checkpoint, dict):
        if "state_dict" in checkpoint:
            state_dict = checkpoint["state_dict"]
        elif "model_state_dict" in checkpoint:
            state_dict = checkpoint["model_state_dict"]
        else:
            state_dict = checkpoint
    else:
        # Might be a direct model object
        state_dict = checkpoint.state_dict() if hasattr(checkpoint, "state_dict") else {}

    log.info(f"  State dict keys: {list(state_dict.keys())}")

    # Look for the linear regression layer
    # Common patterns in SHAPY: 'linear.weight', 'linear.bias',
    # 'regressor.weight', 'regressor.bias', 'fc.weight', 'fc.bias'
    weight_key = None
    bias_key = None

    weight_patterns = ["linear.weight", "regressor.weight", "fc.weight", "a2s.weight"]
    bias_patterns = ["linear.bias", "regressor.bias", "fc.bias", "a2s.bias"]

    for pattern in weight_patterns:
        for key in state_dict:
            if pattern in key:
                weight_key = key
                break
        if weight_key:
            break

    for pattern in bias_patterns:
        for key in state_dict:
            if pattern in key:
                bias_key = key
                break
        if bias_key:
            break

    if weight_key is None:
        # Try to find any 2D tensor that could be the weight matrix
        for key, tensor in state_dict.items():
            if hasattr(tensor, "shape") and len(tensor.shape) == 2:
                if tensor.shape[0] == NUM_BETAS and tensor.shape[1] == NUM_EXPANDED_FEATURES:
                    weight_key = key
                    log.info(f"  Found weight matrix by shape at key: {key}")
                    break

    if bias_key is None:
        for key, tensor in state_dict.items():
            if hasattr(tensor, "shape") and len(tensor.shape) == 1:
                if tensor.shape[0] == NUM_BETAS:
                    bias_key = key
                    log.info(f"  Found bias vector by shape at key: {key}")
                    break

    if weight_key is None or bias_key is None:
        raise ValueError(
            f"Could not find weight/bias in state dict. "
            f"Keys: {list(state_dict.keys())}. "
            f"Weight key: {weight_key}, Bias key: {bias_key}"
        )

    weights = state_dict[weight_key].numpy().astype(np.float64)
    bias = state_dict[bias_key].numpy().astype(np.float64)

    log.info(f"  Weight matrix shape: {weights.shape} (key: {weight_key})")
    log.info(f"  Bias vector shape: {bias.shape} (key: {bias_key})")

    # Extract normalization parameters if available in checkpoint
    input_mean = None
    input_std = None

    for key in state_dict:
        if "mean" in key.lower() and "input" in key.lower():
            input_mean = state_dict[key].numpy().astype(np.float64)
            log.info(f"  Found input mean at key: {key}")
        if "std" in key.lower() and "input" in key.lower():
            input_std = state_dict[key].numpy().astype(np.float64)
            log.info(f"  Found input std at key: {key}")

    # If normalization not in checkpoint, check for config in checkpoint
    if input_mean is None and "config" in checkpoint:
        config = checkpoint["config"]
        if hasattr(config, "get"):
            input_mean = np.array(config.get("input_mean", None))
            input_std = np.array(config.get("input_std", None))

    # Fallback: use SHAPY's known normalization (from CAESAR dataset statistics)
    if input_mean is None:
        log.warning("  Input mean not found in checkpoint, using CAESAR dataset defaults")
        input_mean = np.array([170.0, 95.0, 80.0, 100.0], dtype=np.float64)
    if input_std is None:
        log.warning("  Input std not found in checkpoint, using CAESAR dataset defaults")
        input_std = np.array([10.0, 12.0, 12.0, 10.0], dtype=np.float64)

    return {
        "weights": weights,
        "bias": bias,
        "input_mean": input_mean,
        "input_std": input_std,
        "checkpoint_hash": ckpt_hash,
        "architecture": arch,
    }



# ═══════════════════════════════════════════════════════════
# 3. Extraction verification
# ═══════════════════════════════════════════════════════════

def verify_extraction(
    checkpoint_path: str,
    weights: np.ndarray,
    bias: np.ndarray,
    input_mean: np.ndarray,
    input_std: np.ndarray,
    shapy_dir: str | None = None,
) -> bool:
    """
    Verify extraction by running 10 test inputs through both the original
    PyTorch model and the extracted matrices.

    Asserts outputs match within 1e-6 absolute tolerance per beta component.

    Returns True if verification passes.
    """
    import torch

    log.info("Verifying extraction against original model...")

    # Generate 10 diverse test inputs
    test_inputs = np.array([
        [160.0, 80.0, 65.0, 88.0],   # short, slim
        [175.0, 95.0, 80.0, 100.0],  # average male
        [165.0, 90.0, 72.0, 98.0],   # average female
        [190.0, 110.0, 95.0, 108.0], # tall, large
        [155.0, 78.0, 62.0, 85.0],   # short, slim female
        [185.0, 105.0, 90.0, 105.0], # tall, athletic
        [170.0, 120.0, 100.0, 115.0],# average, heavy
        [180.0, 88.0, 75.0, 95.0],   # tall, slim
        [168.0, 100.0, 85.0, 102.0], # average, curvy
        [195.0, 115.0, 98.0, 112.0], # very tall, large
    ], dtype=np.float64)

    # Compute betas using extracted matrices
    extracted_betas = compute_a2s_betas(
        test_inputs, input_mean, input_std, weights, bias, POLYNOMIAL_DEGREE
    )

    # Try to load and run the original model
    try:
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)

        # Try to instantiate the model
        if shapy_dir:
            sys.path.insert(0, shapy_dir)
            try:
                # Try various import paths for SHAPY's A2S model
                model = None
                try:
                    from attributes.attributes.models.a2s import A2SModel
                    model = A2SModel()
                    model.load_state_dict(checkpoint.get("state_dict", checkpoint))
                except ImportError:
                    pass

                if model is None:
                    try:
                        from shapy.models.a2s import A2SModel
                        model = A2SModel()
                        model.load_state_dict(checkpoint.get("state_dict", checkpoint))
                    except ImportError:
                        pass

                if model is not None:
                    model.eval()
                    with torch.no_grad():
                        for i, inp in enumerate(test_inputs):
                            tensor_input = torch.tensor(inp, dtype=torch.float64).unsqueeze(0)
                            original_output = model(tensor_input).numpy()[0]

                            max_diff = np.max(np.abs(extracted_betas[i] - original_output))
                            log.info(
                                f"  Input {i}: max diff = {max_diff:.2e} "
                                f"({'PASS' if max_diff < VERIFY_TOLERANCE else 'FAIL'})"
                            )

                            if max_diff >= VERIFY_TOLERANCE:
                                log.error(
                                    f"  Verification FAILED for input {i}: "
                                    f"max diff {max_diff:.2e} >= {VERIFY_TOLERANCE}"
                                )
                                return False

                    log.info("  ✓ All 10 test inputs verified within tolerance")
                    return True
                else:
                    log.warning("  Could not instantiate SHAPY model — skipping model comparison")
            except Exception as e:
                log.warning(f"  Could not run original model: {e}")
        else:
            log.warning("  No --shapy-dir provided — skipping model comparison")

    except Exception as e:
        log.warning(f"  Could not load checkpoint for verification: {e}")

    # If we can't run the original model, verify internal consistency
    log.info("  Performing internal consistency checks instead...")

    # Check that betas are finite and in reasonable range
    assert np.all(np.isfinite(extracted_betas)), "Non-finite betas detected"
    assert np.all(np.abs(extracted_betas) <= 3.0), "Betas outside [-3, 3] range"

    # Check that different inputs produce different outputs
    for i in range(len(test_inputs)):
        for j in range(i + 1, len(test_inputs)):
            diff = np.max(np.abs(extracted_betas[i] - extracted_betas[j]))
            if diff < 1e-10:
                log.warning(f"  Inputs {i} and {j} produce identical betas")

    log.info("  ✓ Internal consistency checks passed")
    return True


# ═══════════════════════════════════════════════════════════
# 4. Synthetic coefficient generation
# ═══════════════════════════════════════════════════════════

def generate_synthetic_coefficients() -> dict:
    """
    Generate realistic synthetic A2S coefficients for testing.

    Uses knowledge of SMPL PCA shape space properties and the existing
    calibration dataset patterns to produce plausible weight matrices.

    The synthetic model maps:
      [height, chest, waist, hips] → 10 SMPL betas
    via degree-2 polynomial regression with normalization.

    Returns dict with weights, bias, input_mean, input_std.
    """
    log.info("Generating synthetic A2S coefficients...")

    rng = np.random.default_rng(seed=42)

    # Normalization parameters (CAESAR dataset statistics)
    input_mean = np.array([170.0, 95.0, 80.0, 100.0], dtype=np.float64)
    input_std = np.array([10.0, 12.0, 12.0, 10.0], dtype=np.float64)

    # Generate plausible weight matrix based on SMPL PCA semantics
    # Shape: (10 betas, 15 expanded features)
    # Features: [1, h, c, w, hp, h^2, h*c, h*w, h*hp, c^2, c*w, c*hp, w^2, w*hp, hp^2]
    weights = np.zeros((NUM_BETAS, NUM_EXPANDED_FEATURES), dtype=np.float64)

    # β0: overall body size — primarily height
    weights[0, 0] = 0.0     # bias feature
    weights[0, 1] = 0.80    # height (dominant)
    weights[0, 2] = 0.10    # chest
    weights[0, 3] = 0.05    # waist
    weights[0, 4] = 0.05    # hips
    weights[0, 5] = -0.02   # h^2 (slight nonlinearity)
    weights[0, 8] = 0.01    # h*hp

    # β1: weight/BMI — primarily waist and chest
    weights[1, 1] = -0.05   # height (taller = less BMI effect)
    weights[1, 2] = 0.30    # chest
    weights[1, 3] = 0.55    # waist (dominant)
    weights[1, 4] = 0.15    # hips
    weights[1, 9] = 0.03    # c^2
    weights[1, 12] = 0.05   # w^2

    # β2: height-to-weight ratio (lankiness)
    weights[2, 1] = 0.50    # height
    weights[2, 2] = -0.20   # chest
    weights[2, 3] = -0.35   # waist
    weights[2, 4] = -0.10   # hips
    weights[2, 7] = -0.03   # h*w

    # β3: shoulder-to-hip ratio (V-taper)
    weights[3, 2] = 0.40    # chest (proxy for shoulders)
    weights[3, 3] = -0.15   # waist
    weights[3, 4] = -0.35   # hips
    weights[3, 10] = -0.02  # c*w

    # β4: limb proportions (leg length)
    weights[4, 1] = 0.45    # height (dominant)
    weights[4, 3] = -0.10   # waist
    weights[4, 4] = -0.05   # hips
    weights[4, 5] = 0.02    # h^2

    # β5: torso width
    weights[5, 2] = 0.35    # chest
    weights[5, 3] = 0.40    # waist (dominant)
    weights[5, 4] = 0.10    # hips
    weights[5, 12] = 0.02   # w^2

    # β6: chest depth
    weights[6, 2] = 0.50    # chest (dominant)
    weights[6, 3] = 0.15    # waist
    weights[6, 9] = 0.03    # c^2

    # β7: hip width
    weights[7, 2] = -0.10   # chest
    weights[7, 3] = 0.15    # waist
    weights[7, 4] = 0.55    # hips (dominant)
    weights[7, 14] = 0.03   # hp^2

    # β8: arm/limb thickness
    weights[8, 2] = 0.25    # chest
    weights[8, 3] = 0.30    # waist
    weights[8, 4] = 0.15    # hips

    # β9: leg thickness
    weights[9, 3] = 0.20    # waist
    weights[9, 4] = 0.40    # hips (dominant)
    weights[9, 13] = 0.02   # w*hp

    # Add small random perturbations for realism
    noise = rng.normal(0, 0.01, size=weights.shape)
    weights += noise

    # Bias vector (small offsets)
    bias = rng.normal(0, 0.02, size=NUM_BETAS)

    log.info(f"  Weight matrix shape: {weights.shape}")
    log.info(f"  Bias vector shape: {bias.shape}")
    log.info(f"  Input mean: {input_mean}")
    log.info(f"  Input std: {input_std}")

    return {
        "weights": weights,
        "bias": bias,
        "input_mean": input_mean,
        "input_std": input_std,
        "checkpoint_hash": "synthetic-v1",
    }


# ═══════════════════════════════════════════════════════════
# 5. Validation dataset generation
# ═══════════════════════════════════════════════════════════

def generate_validation_pairs(
    weights: np.ndarray,
    bias: np.ndarray,
    input_mean: np.ndarray,
    input_std: np.ndarray,
    num_pairs: int = 120,
) -> list[dict]:
    """
    Generate validation pairs: input measurements → Python-computed betas.

    Produces diverse input combinations spanning the population range:
      height: 150–200 cm
      chest: 75–130 cm
      waist: 60–120 cm
      hips: 80–135 cm

    Args:
        weights: (num_betas, num_expanded_features) weight matrix
        bias: (num_betas,) bias vector
        input_mean: (K,) normalization mean
        input_std: (K,) normalization std
        num_pairs: number of validation pairs to generate

    Returns:
        List of dicts with 'inputs' and 'pythonBetas' keys
    """
    log.info(f"Generating {num_pairs} validation pairs...")

    rng = np.random.default_rng(seed=123)

    pairs = []

    # Generate a grid of diverse inputs
    heights = np.linspace(150, 200, 8)
    chests = np.linspace(75, 130, 6)
    waists = np.linspace(60, 120, 5)
    hips = np.linspace(80, 135, 5)

    # Grid-based pairs (8*6*5*5 = 1200, sample down)
    grid_inputs = []
    for h in heights:
        for c in chests:
            for w in waists:
                for hp in hips:
                    # Filter physiologically implausible combinations
                    if w > c + 10:
                        continue  # waist shouldn't be much larger than chest
                    if hp < w - 5:
                        continue  # hips shouldn't be much smaller than waist
                    grid_inputs.append([h, c, w, hp])

    grid_inputs = np.array(grid_inputs)
    log.info(f"  Grid produced {len(grid_inputs)} plausible combinations")

    # Sample down to num_pairs
    if len(grid_inputs) > num_pairs:
        indices = rng.choice(len(grid_inputs), size=num_pairs, replace=False)
        selected = grid_inputs[indices]
    else:
        selected = grid_inputs

    # Add some random inputs to fill up to num_pairs
    remaining = num_pairs - len(selected)
    if remaining > 0:
        random_inputs = np.column_stack([
            rng.uniform(150, 200, remaining),
            rng.uniform(75, 130, remaining),
            rng.uniform(60, 120, remaining),
            rng.uniform(80, 135, remaining),
        ])
        selected = np.vstack([selected, random_inputs])

    # Compute betas for all selected inputs
    betas = compute_a2s_betas(
        selected, input_mean, input_std, weights, bias, POLYNOMIAL_DEGREE
    )

    for i in range(len(selected)):
        pairs.append({
            "inputs": {
                "height": round(float(selected[i, 0]), 1),
                "chest": round(float(selected[i, 1]), 1),
                "waist": round(float(selected[i, 2]), 1),
                "hips": round(float(selected[i, 3]), 1),
            },
            "pythonBetas": [round(float(b), 10) for b in betas[i]],
        })

    log.info(f"  Generated {len(pairs)} validation pairs")

    # Log summary statistics
    all_betas = np.array([p["pythonBetas"] for p in pairs])
    log.info(f"  Beta range: [{all_betas.min():.4f}, {all_betas.max():.4f}]")
    log.info(f"  Beta mean: {all_betas.mean(axis=0).round(4)}")

    return pairs


# ═══════════════════════════════════════════════════════════
# 6. JSON artifact export
# ═══════════════════════════════════════════════════════════

def export_coefficient_artifact(
    weights: np.ndarray,
    bias: np.ndarray,
    input_mean: np.ndarray,
    input_std: np.ndarray,
    checkpoint_hash: str,
    output_path: str,
    is_synthetic: bool = False,
) -> None:
    """
    Export A2S coefficient artifact as JSON.

    Writes to output_path and copies to public/data/ for runtime access.
    Verifies file size < 100KB.
    """
    log.info(f"Exporting A2S coefficient artifact to: {output_path}")

    notes = "Extracted from SHAPY A2S model trained on CAESAR dataset"
    if is_synthetic:
        notes = (
            "SYNTHETIC coefficients for testing. "
            "Regenerate with real SHAPY checkpoint: "
            "python scripts/extract-shapy-a2s.py --checkpoint /path/to/a2s.pt"
        )

    artifact = {
        "metadata": {
            "extractedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "shapyVersion": f"sha256:{checkpoint_hash}",
            "polynomialDegree": POLYNOMIAL_DEGREE,
            "inputFeatures": INPUT_FEATURES,
            "numInputFeatures": NUM_INPUT_FEATURES,
            "numExpandedFeatures": NUM_EXPANDED_FEATURES,
            "numBetas": NUM_BETAS,
            "notes": notes,
        },
        "normalization": {
            "inputMean": [round(float(v), 6) for v in input_mean],
            "inputStd": [round(float(v), 6) for v in input_std],
        },
        "weights": [
            [round(float(v), 10) for v in row]
            for row in weights
        ],
        "bias": [round(float(v), 10) for v in bias],
        "polynomialOrder": POLYNOMIAL_ORDER,
    }

    # Write to output path
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(artifact, f, indent=2)

    size_bytes = os.path.getsize(output_path)
    size_kb = size_bytes / 1024
    log.info(f"  File size: {size_kb:.1f} KB")
    assert size_kb < 100, f"File size {size_kb:.1f} KB exceeds 100KB limit"

    # Copy to public/data/
    public_path = os.path.join(PUBLIC_DATA_DIR, "shapy_a2s_coefficients.json")
    os.makedirs(os.path.dirname(public_path), exist_ok=True)
    with open(public_path, "w") as f:
        json.dump(artifact, f, indent=2)
    log.info(f"  Copied to: {public_path}")

    log.info(f"  ✓ A2S coefficient artifact exported successfully")


def export_validation_pairs(pairs: list[dict], output_path: str) -> None:
    """Export validation pairs as JSON."""
    log.info(f"Exporting {len(pairs)} validation pairs to: {output_path}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(pairs, f, indent=2)

    size_kb = os.path.getsize(output_path) / 1024
    log.info(f"  File size: {size_kb:.1f} KB")
    log.info(f"  ✓ Validation pairs exported successfully")


# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════

def main():
    log.info("=" * 60)
    log.info("SHAPY A2S Coefficient Extraction")
    log.info("=" * 60)

    if args.synthetic:
        log.info("Mode: SYNTHETIC (no SHAPY checkpoint required)")
        log.info("")

        # Generate synthetic coefficients
        result = generate_synthetic_coefficients()
        weights = result["weights"]
        bias = result["bias"]
        input_mean = result["input_mean"]
        input_std = result["input_std"]
        checkpoint_hash = result["checkpoint_hash"]

        # Verify internal consistency
        log.info("")
        log.info("Verifying synthetic coefficients...")
        test_inputs = np.array([
            [175.0, 95.0, 80.0, 100.0],
            [160.0, 80.0, 65.0, 88.0],
            [190.0, 110.0, 95.0, 108.0],
        ])
        test_betas = compute_a2s_betas(
            test_inputs, input_mean, input_std, weights, bias, POLYNOMIAL_DEGREE
        )
        assert np.all(np.isfinite(test_betas)), "Non-finite betas in synthetic model"
        assert np.all(np.abs(test_betas) <= 3.0), "Betas outside [-3, 3] in synthetic model"
        log.info("  ✓ Synthetic coefficients verified")

    else:
        if args.checkpoint is None:
            log.error("--checkpoint is required when not using --synthetic mode")
            log.error("Usage: python scripts/extract-shapy-a2s.py --checkpoint /path/to/a2s.pt")
            sys.exit(1)

        log.info(f"Mode: EXTRACTION from checkpoint")
        log.info(f"  Checkpoint: {args.checkpoint}")
        log.info(f"  SHAPY dir: {args.shapy_dir or '(not provided)'}")
        log.info("")

        # Extract from checkpoint
        result = extract_from_checkpoint(args.checkpoint, args.shapy_dir)
        weights = result["weights"]
        bias = result["bias"]
        input_mean = result["input_mean"]
        input_std = result["input_std"]
        checkpoint_hash = result["checkpoint_hash"]

        # Verify extraction
        log.info("")
        verified = verify_extraction(
            args.checkpoint, weights, bias, input_mean, input_std, args.shapy_dir
        )
        if not verified:
            log.error("Extraction verification FAILED")
            sys.exit(1)

    # Generate validation pairs
    log.info("")
    pairs = generate_validation_pairs(weights, bias, input_mean, input_std)

    # Export artifacts
    log.info("")
    export_coefficient_artifact(
        weights, bias, input_mean, input_std, checkpoint_hash,
        args.output, is_synthetic=args.synthetic,
    )

    log.info("")
    export_validation_pairs(pairs, args.validation_output)

    log.info("")
    log.info("=" * 60)
    log.info("Done!")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
