"""
export-smpl-assets.py — Convert SMPL model files to browser-compatible formats.

Produces:
  1. smpl_model.bin       — SMPL template, blend shapes, faces, joint regressor, landmarks
  2. smpl_regressor.onnx  — Measurement-to-beta regression model (PyTorch → ONNX)
  3. smpl_landmarks.json  — Vertex index → anatomical landmark name
  4. smpl_to_makehuman.bin — Nearest-vertex correspondence map (SMPL → MakeHuman)

Prerequisites:
  - SMPL model files from https://smpl.is.tue.mpg.de/ (register & download)
    Expected: basicModel_neutral_lbs_10_207_0_v1.0.0.pkl  (or male/female variants)
  - Python 3.9+, numpy, torch, onnx, scipy (for correspondence map)
  - Optional: trimesh (for MakeHuman mesh loading)

Usage:
  python scripts/export-smpl-assets.py --smpl-pkl path/to/SMPL_NEUTRAL.pkl --out public/models/smpl/
  python scripts/export-smpl-assets.py --smpl-pkl path/to/SMPL_NEUTRAL.pkl --makehuman-glb public/models/human-male.glb --out public/models/smpl/

Binary format for smpl_model.bin (must match loadSmplModel() in smplForwardPass.ts):
  Header (16 bytes):
    magic:         uint32  — 0x534D504C ("SMPL")
    version:       uint16  — 1
    vertexCount:   uint16  — 6890
    faceCount:     uint16  — 13776
    shapeCount:    uint16  — 10
    landmarkCount: uint16
    reserved:      uint16  — 0
  Template vertices:    Float32[vertexCount × 3]
  Shape blend shapes:   Float32[shapeCount × vertexCount × 3]
  Face indices:         Uint16[faceCount × 3]
  Joint regressor:      Float32[24 × vertexCount]
  Landmark pairs:       Uint16[landmarkCount × 2]  — (vertexIndex, nameStringOffset)
  Landmark name strings: null-terminated UTF-8

Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
"""

import argparse
import gzip
import json
import os
import pickle
import struct
import sys

import numpy as np

# ─── Constants ────────────────────────────────────────────────────────────────

SMPL_MAGIC = 0x534D504C       # "SMPL" in ASCII
SMPL_VERSION = 1
EXPECTED_VERTEX_COUNT = 6890
EXPECTED_FACE_COUNT = 13776
EXPECTED_SHAPE_COUNT = 10
EXPECTED_JOINT_COUNT = 24

# SMPL vertex indices for anatomical landmarks.
# These are well-known indices from the SMPL model topology.
# Sources: SMPL documentation, smplify codebase, body_25 mapping.
SMPL_LANDMARKS = {
    "left_shoulder":  3011,
    "right_shoulder": 6470,
    "navel":          3500,
    "left_hip":       1799,
    "right_hip":      5262,
    "left_knee":      1085,
    "right_knee":     4530,
    "left_ankle":     3327,
    "right_ankle":    6728,
    "neck_base":      3068,
    "chest_center":   3076,
    "waist_center":   3504,
    "hip_center":     1769,
}

# Maximum combined gzipped size for all outputs (bytes)
MAX_BUNDLE_GZIPPED = 15 * 1024 * 1024  # 15 MB


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Export SMPL model to browser-compatible binary formats."
    )
    parser.add_argument(
        "--smpl-pkl", required=True,
        help="Path to SMPL .pkl file (e.g. basicModel_neutral_lbs_10_207_0_v1.0.0.pkl)"
    )
    parser.add_argument(
        "--out", default="public/models/smpl/",
        help="Output directory (default: public/models/smpl/)"
    )
    parser.add_argument(
        "--makehuman-glb", default=None,
        help="Optional: path to MakeHuman GLB for correspondence map"
    )
    parser.add_argument(
        "--landmarks-json", default=None,
        help="Optional: custom landmarks JSON (overrides built-in SMPL landmarks)"
    )
    parser.add_argument(
        "--skip-onnx", action="store_true",
        help="Skip ONNX regressor export (useful if PyTorch not available)"
    )
    parser.add_argument(
        "--skip-correspondence", action="store_true",
        help="Skip SMPL-to-MakeHuman correspondence map"
    )
    return parser.parse_args()


# ─── SMPL Model Loading ──────────────────────────────────────────────────────

def load_smpl_pkl(pkl_path: str) -> dict:
    """Load SMPL model from pickle file.

    The SMPL pickle contains (among others):
      - 'v_template': (6890, 3) mean shape vertices
      - 'shapedirs':  (6890, 3, 10) shape blend shapes (PCA components)
      - 'f':          (13776, 3) face indices
      - 'J_regressor': sparse (24, 6890) joint regressor
      - 'posedirs':   (6890, 3, 207) pose blend shapes (not used here)
      - 'weights':    (6890, 24) skinning weights (not used here)
    """
    print(f"[load] Reading SMPL pickle: {pkl_path}")
    if not os.path.exists(pkl_path):
        print(f"ERROR: SMPL pickle not found: {pkl_path}")
        print("Download from https://smpl.is.tue.mpg.de/ (registration required)")
        sys.exit(1)

    # Custom unpickler that stubs out chumpy (which is hard to install on Python 3.10+)
    # chumpy arrays are just numpy arrays with autodiff — we only need the .r (value) attribute
    class _ChumpyStub:
        """Stub for chumpy.Ch objects — extracts numpy data from serialized state."""
        def __init__(self, *args, **kwargs):
            pass
        def __array__(self, dtype=None, copy=None):
            # Try to return the underlying numpy data
            x = self.__dict__.get('x', None)
            if x is not None and isinstance(x, np.ndarray):
                return np.array(x, dtype=dtype) if dtype else x
            return np.zeros(0, dtype=dtype or np.float64)
        def __setstate__(self, state):
            if isinstance(state, dict):
                self.__dict__.update(state)
            elif isinstance(state, np.ndarray):
                self.__dict__['x'] = state

    class _ChumpyModule:
        """Fake chumpy module that returns stubs for any attribute."""
        Ch = _ChumpyStub
        def __getattr__(self, name):
            return _ChumpyStub

    class SmplUnpickler(pickle.Unpickler):
        """Custom unpickler that redirects chumpy imports to stubs."""
        def find_class(self, module, name):
            if module.startswith('chumpy'):
                return _ChumpyStub
            return super().find_class(module, name)

    with open(pkl_path, "rb") as f:
        try:
            data = SmplUnpickler(f, encoding="latin1").load()
        except Exception as e:
            print(f"  First attempt failed ({e}), trying standard pickle...")
            f.seek(0)
            try:
                data = pickle.load(f, encoding="latin1")
            except Exception:
                f.seek(0)
                data = pickle.load(f)

    # Convert any chumpy stubs or special objects to plain numpy arrays
    for key in list(data.keys()):
        val = data[key]
        if hasattr(val, 'r') and isinstance(getattr(val, 'r', None), np.ndarray):
            # chumpy object with .r attribute — extract the raw numpy value
            data[key] = np.array(val.r)
            print(f"  Converted chumpy '{key}' via .r → numpy {data[key].shape}")
        elif isinstance(val, _ChumpyStub):
            # Our stub — extract the 'x' field
            x = val.__dict__.get('x', None)
            if x is not None and isinstance(x, np.ndarray):
                data[key] = x
                print(f"  Converted chumpy stub '{key}' via .x → numpy {data[key].shape}")
            else:
                data[key] = np.array(val)
                print(f"  Converted chumpy stub '{key}' via __array__ → numpy {data[key].shape}")
        elif hasattr(val, 'toarray'):
            # scipy sparse matrix — keep as-is, handled later
            pass
        elif not isinstance(val, (np.ndarray, dict, list, str, int, float, type(None))):
            try:
                data[key] = np.array(val)
                print(f"  Converted '{key}' ({type(val).__name__}) → numpy {data[key].shape}")
            except Exception:
                pass

    print(f"  Keys: {list(data.keys())}")
    return data


def validate_smpl_data(data: dict):
    """Validate SMPL model shapes before export."""
    errors = []

    v_template = np.array(data["v_template"])
    if v_template.shape != (EXPECTED_VERTEX_COUNT, 3):
        errors.append(
            f"v_template shape {v_template.shape}, expected ({EXPECTED_VERTEX_COUNT}, 3)"
        )

    shapedirs = np.array(data["shapedirs"])
    if shapedirs.ndim == 3:
        # shapedirs is (6890, 3, N) where N >= 10
        if shapedirs.shape[0] != EXPECTED_VERTEX_COUNT or shapedirs.shape[1] != 3:
            errors.append(
                f"shapedirs shape {shapedirs.shape}, expected ({EXPECTED_VERTEX_COUNT}, 3, N)"
            )
        if shapedirs.shape[2] < EXPECTED_SHAPE_COUNT:
            errors.append(
                f"shapedirs has {shapedirs.shape[2]} components, need at least {EXPECTED_SHAPE_COUNT}"
            )
    else:
        errors.append(f"shapedirs has {shapedirs.ndim} dimensions, expected 3")

    faces = np.array(data["f"])
    if faces.shape != (EXPECTED_FACE_COUNT, 3):
        errors.append(
            f"faces shape {faces.shape}, expected ({EXPECTED_FACE_COUNT}, 3)"
        )

    # J_regressor can be sparse or dense
    j_reg = data.get("J_regressor")
    if j_reg is not None:
        if hasattr(j_reg, "toarray"):
            j_dense = j_reg.toarray()
        else:
            j_dense = np.array(j_reg)
        if j_dense.shape != (EXPECTED_JOINT_COUNT, EXPECTED_VERTEX_COUNT):
            errors.append(
                f"J_regressor shape {j_dense.shape}, expected ({EXPECTED_JOINT_COUNT}, {EXPECTED_VERTEX_COUNT})"
            )
    else:
        errors.append("J_regressor not found in SMPL data")

    if errors:
        print("ERROR: SMPL model validation failed:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print("[validate] SMPL model shapes OK")


# ─── Coordinate Transform ────────────────────────────────────────────────────

def transform_to_yup(vertices: np.ndarray) -> np.ndarray:
    """Transform SMPL vertices to Y-up, Z-negative=front convention.

    SMPL native: Y-up already in most distributions, but some use Z-up.
    We ensure: Y-up, Z-negative = front (belly), feet near Y=0.

    If the model is already Y-up (max extent along Y), we just ensure
    feet are near Y=0. If Z-up, we rotate -90° around X.
    """
    y_range = vertices[:, 1].max() - vertices[:, 1].min()
    z_range = vertices[:, 2].max() - vertices[:, 2].min()

    if z_range > y_range * 1.5:
        # Z-up → rotate -90° around X: (x, y, z) → (x, -z, y)
        print("[transform] Detected Z-up, rotating to Y-up")
        rotated = vertices.copy()
        rotated[:, 1] = -vertices[:, 2]
        rotated[:, 2] = vertices[:, 1]
        vertices = rotated

    # Shift so feet are near Y=0
    y_min = vertices[:, 1].min()
    if abs(y_min) > 0.01:
        print(f"[transform] Shifting Y by {-y_min:.4f} to place feet at Y=0")
        vertices[:, 1] -= y_min

    # Verify centroid is near X=0, Z=0
    cx = vertices[:, 0].mean()
    cz = vertices[:, 2].mean()
    if abs(cx) > 0.05 or abs(cz) > 0.05:
        print(f"[transform] Centering X/Z (was cx={cx:.4f}, cz={cz:.4f})")
        vertices[:, 0] -= cx
        vertices[:, 2] -= cz

    return vertices


# ─── Binary Export: smpl_model.bin ────────────────────────────────────────────

def export_smpl_model_bin(data: dict, landmarks: dict, out_path: str):
    """Export SMPL model to binary format matching smplForwardPass.ts loader.

    Binary layout:
      Header (16 bytes):
        magic:         uint32  — 0x534D504C
        version:       uint16  — 1
        vertexCount:   uint16  — 6890
        faceCount:     uint16  — 13776
        shapeCount:    uint16  — 10
        landmarkCount: uint16
        reserved:      uint16  — 0
      Template vertices:    Float32[6890 × 3]
      Shape blend shapes:   Float32[10 × 6890 × 3]
      Face indices:         Uint16[13776 × 3]
      Joint regressor:      Float32[24 × 6890]
      Landmark pairs:       Uint16[landmarkCount × 2]
      Landmark name strings: null-terminated UTF-8
    """
    print(f"\n[export] Writing smpl_model.bin → {out_path}")

    # Prepare arrays
    v_template = np.array(data["v_template"], dtype=np.float64)
    v_template = transform_to_yup(v_template)
    v_template_f32 = v_template.astype(np.float32).flatten()

    shapedirs = np.array(data["shapedirs"])  # (6890, 3, N)
    # Take first 10 components, reshape to (10, 6890, 3)
    shapes_10 = shapedirs[:, :, :EXPECTED_SHAPE_COUNT]  # (6890, 3, 10)
    shapes_10 = np.transpose(shapes_10, (2, 0, 1))       # (10, 6890, 3)

    # Apply same coordinate transform to blend shapes
    y_range = v_template[:, 1].max() - v_template[:, 1].min()
    z_range_orig = np.array(data["v_template"])[:, 2].max() - np.array(data["v_template"])[:, 2].min()
    y_range_orig = np.array(data["v_template"])[:, 1].max() - np.array(data["v_template"])[:, 1].min()

    if z_range_orig > y_range_orig * 1.5:
        # Same rotation for blend shapes: (dx, dy, dz) → (dx, -dz, dy)
        rotated_shapes = shapes_10.copy()
        rotated_shapes[:, :, 1] = -shapes_10[:, :, 2]
        rotated_shapes[:, :, 2] = shapes_10[:, :, 1]
        shapes_10 = rotated_shapes

    shapes_f32 = shapes_10.astype(np.float32).flatten()

    faces = np.array(data["f"], dtype=np.int32)
    if faces.max() > 65535:
        print("WARNING: Face indices exceed uint16 range, clamping")
    faces_u16 = faces.astype(np.uint16).flatten()

    j_reg = data["J_regressor"]
    if hasattr(j_reg, "toarray"):
        j_dense = j_reg.toarray()
    else:
        j_dense = np.array(j_reg)
    j_dense_f32 = j_dense.astype(np.float32).flatten()

    # Build landmark string table
    landmark_names = sorted(landmarks.keys())
    landmark_count = len(landmark_names)

    # Build null-terminated string table
    string_table = bytearray()
    name_offsets = {}
    for name in landmark_names:
        name_offsets[name] = len(string_table)
        string_table.extend(name.encode("utf-8"))
        string_table.append(0)  # null terminator

    # Build landmark pairs: (vertexIndex, nameStringOffset) as uint16
    landmark_pairs = np.zeros(landmark_count * 2, dtype=np.uint16)
    for i, name in enumerate(landmark_names):
        vertex_idx = landmarks[name]
        if vertex_idx > 65535:
            print(f"WARNING: Landmark '{name}' vertex index {vertex_idx} exceeds uint16")
        landmark_pairs[i * 2] = vertex_idx
        landmark_pairs[i * 2 + 1] = name_offsets[name]

    # Compute sizes
    header_bytes = 16
    template_bytes = len(v_template_f32) * 4
    shapes_bytes = len(shapes_f32) * 4
    faces_bytes = len(faces_u16) * 2
    joint_bytes = len(j_dense_f32) * 4
    landmark_pair_bytes = len(landmark_pairs) * 2
    string_bytes = len(string_table)
    total_bytes = (header_bytes + template_bytes + shapes_bytes +
                   faces_bytes + joint_bytes + landmark_pair_bytes + string_bytes)

    print(f"  Template vertices:  {template_bytes:>10,} bytes ({EXPECTED_VERTEX_COUNT} × 3 float32)")
    print(f"  Shape blend shapes: {shapes_bytes:>10,} bytes ({EXPECTED_SHAPE_COUNT} × {EXPECTED_VERTEX_COUNT} × 3 float32)")
    print(f"  Face indices:       {faces_bytes:>10,} bytes ({EXPECTED_FACE_COUNT} × 3 uint16)")
    print(f"  Joint regressor:    {joint_bytes:>10,} bytes ({EXPECTED_JOINT_COUNT} × {EXPECTED_VERTEX_COUNT} float32)")
    print(f"  Landmark pairs:     {landmark_pair_bytes:>10,} bytes ({landmark_count} × 2 uint16)")
    print(f"  Landmark strings:   {string_bytes:>10,} bytes")
    print(f"  Total:              {total_bytes:>10,} bytes ({total_bytes / 1024 / 1024:.2f} MB)")

    # Write binary
    with open(out_path, "wb") as f:
        # Header (16 bytes, little-endian)
        f.write(struct.pack("<I", SMPL_MAGIC))                # magic uint32
        f.write(struct.pack("<H", SMPL_VERSION))              # version uint16
        f.write(struct.pack("<H", EXPECTED_VERTEX_COUNT))     # vertexCount uint16
        f.write(struct.pack("<H", EXPECTED_FACE_COUNT))       # faceCount uint16
        f.write(struct.pack("<H", EXPECTED_SHAPE_COUNT))      # shapeCount uint16
        f.write(struct.pack("<H", landmark_count))            # landmarkCount uint16
        f.write(struct.pack("<H", 0))                         # reserved uint16

        # Data sections
        f.write(v_template_f32.tobytes())
        f.write(shapes_f32.tobytes())
        f.write(faces_u16.tobytes())
        f.write(j_dense_f32.tobytes())
        f.write(landmark_pairs.tobytes())
        f.write(bytes(string_table))

    file_size = os.path.getsize(out_path)
    print(f"  Written: {out_path} ({file_size:,} bytes)")
    return out_path


# ─── ONNX Regressor Export ────────────────────────────────────────────────────

def export_regressor_onnx(out_path: str):
    """Export a measurement-to-beta regression model as ONNX.

    The model takes 9 inputs:
      [heightCm, weightKg, age, gender(0=male,1=female), bodyComposition(0=athletic,1=average,2=heavy),
       bustCm(-1=missing), waistCm(-1=missing), hipCm(-1=missing), inseamCm(-1=missing)]
    and produces 10 SMPL beta values.

    Body composition encoding:
      athletic=0 → muscular, low body fat
      average=1  → moderate
      heavy=2    → higher body fat, softer

    This trains a small feedforward network on synthetic data generated from
    known SMPL shape space properties. In production, replace with a model
    trained on real SMPL registration data (e.g., from CAESAR or similar).
    """
    print(f"\n[onnx] Exporting regressor → {out_path}")

    try:
        import torch
        import torch.nn as nn
    except ImportError:
        print("WARNING: PyTorch not available, skipping ONNX export.")
        print("  Install: pip install torch onnx")
        print("  The runtime will use the lookup table fallback instead.")
        return None

    class MeasurementToBeta(nn.Module):
        """Small feedforward network: 9 inputs → 10 betas."""
        def __init__(self):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(9, 64),
                nn.ReLU(),
                nn.Linear(64, 32),
                nn.ReLU(),
                nn.Linear(32, 10),
            )

        def forward(self, x):
            return self.net(x)

    def generate_synthetic_training_data(n_samples: int = 10000):
        """Generate synthetic training pairs (measurements → betas).

        Uses known SMPL shape space properties:
          β0 ≈ overall size (height + weight)
          β1 ≈ BMI / weight
          β2 ≈ height-to-weight ratio
          β3 ≈ shoulder-to-hip ratio (gender-dimorphic)
          β4 ≈ limb proportions
          β5 ≈ torso width
          β6 ≈ chest depth
          β7 ≈ hip width
          β8 ≈ arm thickness
          β9 ≈ leg thickness

        Body composition shifts betas along muscular↔soft axis.
        """
        rng = np.random.default_rng(42)

        heights = rng.uniform(140, 210, n_samples)
        weights = rng.uniform(40, 150, n_samples)
        ages = rng.uniform(18, 80, n_samples)
        genders = rng.choice([0.0, 1.0], n_samples)  # 0=male, 1=female
        body_comps = rng.choice([0.0, 1.0, 2.0], n_samples)  # athletic/average/heavy

        # Optional measurements (-1 = missing, ~50% provided)
        mask = rng.random((n_samples, 4)) > 0.5
        busts = np.where(mask[:, 0], rng.uniform(75, 130, n_samples), -1.0)
        waists = np.where(mask[:, 1], rng.uniform(60, 120, n_samples), -1.0)
        hips = np.where(mask[:, 2], rng.uniform(80, 130, n_samples), -1.0)
        inseams = np.where(mask[:, 3], rng.uniform(65, 95, n_samples), -1.0)

        inputs = np.column_stack([
            heights, weights, ages, genders, body_comps,
            busts, waists, hips, inseams,
        ]).astype(np.float32)

        # Generate target betas using the same heuristic as smplRegressor.ts lookupRegress
        betas = np.zeros((n_samples, 10), dtype=np.float32)

        h_norm = (heights - 175) / 20
        w_norm = (weights - 80) / 30
        a_norm = (ages - 40) / 25
        g_sign = np.where(genders == 0, 1.0, -1.0)
        bmi = weights / np.maximum(0.01, (heights / 100) ** 2)
        bmi_norm = (bmi - 25) / 8
        comp_bias = body_comps - 1  # athletic=-1, average=0, heavy=1

        betas[:, 0] = h_norm * 1.5 + w_norm * 0.8 + g_sign * 0.3
        betas[:, 1] = bmi_norm * 2.0 + w_norm * 0.5 + comp_bias * 0.3
        betas[:, 2] = (h_norm - w_norm) * 1.2 + g_sign * 0.2
        betas[:, 3] = g_sign * 0.8 - comp_bias * 0.6
        betas[:, 4] = h_norm * 0.4 - a_norm * 0.1
        betas[:, 5] = bmi_norm * 0.8 + comp_bias * 0.5
        betas[:, 6] = bmi_norm * 0.5 + g_sign * 0.3 - comp_bias * 0.4
        betas[:, 7] = -g_sign * 0.5 + bmi_norm * 0.4 + comp_bias * 0.3
        betas[:, 8] = bmi_norm * 0.3 - comp_bias * 0.5 + g_sign * 0.2
        betas[:, 9] = bmi_norm * 0.4 + comp_bias * 0.3 + a_norm * 0.1

        # Override with direct measurements where provided
        for i in range(n_samples):
            if inseams[i] > 0:
                betas[i, 4] = (inseams[i] - 80) / 12
            if waists[i] > 0:
                center = 88 if genders[i] == 0 else 78
                betas[i, 5] = (waists[i] - center) / 15 * 1.2 + comp_bias[i] * 0.4
            if busts[i] > 0:
                center = 100 if genders[i] == 0 else 92
                betas[i, 6] = (busts[i] - center) / 12 - comp_bias[i] * 0.3
            if hips[i] > 0:
                center = 100 if genders[i] == 0 else 102
                betas[i, 7] = (hips[i] - center) / 12 + comp_bias[i] * 0.2

        # Age effects
        betas[:, 1] += a_norm * 0.2
        betas[:, 5] += a_norm * 0.15

        # Clamp
        betas = np.clip(betas, -3, 3)

        return inputs, betas

    # Generate training data
    print("  Generating synthetic training data...")
    X_train, y_train = generate_synthetic_training_data(10000)
    X_val, y_val = generate_synthetic_training_data(2000)

    X_train_t = torch.from_numpy(X_train)
    y_train_t = torch.from_numpy(y_train)
    X_val_t = torch.from_numpy(X_val)
    y_val_t = torch.from_numpy(y_val)

    # Train
    model = MeasurementToBeta()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    loss_fn = nn.MSELoss()

    print("  Training regression model...")
    batch_size = 256
    n_epochs = 100
    best_val_loss = float("inf")
    best_state = None

    for epoch in range(n_epochs):
        model.train()
        perm = torch.randperm(len(X_train_t))
        epoch_loss = 0.0
        n_batches = 0

        for i in range(0, len(X_train_t), batch_size):
            idx = perm[i:i + batch_size]
            pred = model(X_train_t[idx])
            loss = loss_fn(pred, y_train_t[idx])
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
            n_batches += 1

        # Validation
        model.eval()
        with torch.no_grad():
            val_pred = model(X_val_t)
            val_loss = loss_fn(val_pred, y_val_t).item()

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

        if (epoch + 1) % 20 == 0:
            print(f"    Epoch {epoch+1}/{n_epochs}: train_loss={epoch_loss/n_batches:.6f}, val_loss={val_loss:.6f}")

    # Restore best model
    if best_state:
        model.load_state_dict(best_state)
    print(f"  Best validation loss: {best_val_loss:.6f}")

    # Export to ONNX
    model.eval()
    dummy_input = torch.randn(1, 9)

    try:
        torch.onnx.export(
            model,
            dummy_input,
            out_path,
            input_names=["input"],
            output_names=["betas"],
            dynamic_axes={"input": {0: "batch"}, "betas": {0: "batch"}},
            opset_version=13,
        )
        file_size = os.path.getsize(out_path)
        print(f"  Written: {out_path} ({file_size:,} bytes, {file_size/1024:.1f} KB)")
        return out_path
    except Exception as e:
        print(f"WARNING: ONNX export failed: {e}")
        print("  The runtime will use the lookup table fallback instead.")
        return None


# ─── Landmarks JSON ───────────────────────────────────────────────────────────

def export_landmarks_json(landmarks: dict, out_path: str):
    """Export landmark map as JSON."""
    print(f"\n[landmarks] Writing → {out_path}")
    with open(out_path, "w") as f:
        json.dump(landmarks, f, indent=2, sort_keys=True)
    file_size = os.path.getsize(out_path)
    print(f"  Written: {out_path} ({file_size:,} bytes)")
    return out_path


# ─── SMPL-to-MakeHuman Correspondence Map ────────────────────────────────────

def export_correspondence_map(smpl_vertices: np.ndarray, makehuman_glb_path: str, out_path: str):
    """Compute nearest-vertex correspondence from SMPL to MakeHuman mesh.

    For each SMPL vertex, find the nearest MakeHuman vertex by Euclidean distance.
    Output: binary file with uint32 array of MakeHuman vertex indices (one per SMPL vertex).

    Format:
      Header (8 bytes):
        magic:       uint32 — 0x534D4D48 ("SMMH")
        vertexCount: uint32 — 6890
      Data:
        Uint32[6890] — MakeHuman vertex index for each SMPL vertex
    """
    print(f"\n[correspondence] Computing SMPL → MakeHuman map")

    try:
        import trimesh
    except ImportError:
        print("WARNING: trimesh not available, skipping correspondence map.")
        print("  Install: pip install trimesh")
        return None

    if not os.path.exists(makehuman_glb_path):
        print(f"WARNING: MakeHuman GLB not found: {makehuman_glb_path}")
        return None

    print(f"  Loading MakeHuman mesh: {makehuman_glb_path}")
    scene = trimesh.load(makehuman_glb_path)
    if isinstance(scene, trimesh.Scene):
        # Get the largest mesh from the scene
        meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            print("WARNING: No meshes found in MakeHuman GLB")
            return None
        mh_mesh = max(meshes, key=lambda m: len(m.vertices))
    else:
        mh_mesh = scene

    mh_verts = np.array(mh_mesh.vertices, dtype=np.float64)
    print(f"  MakeHuman mesh: {len(mh_verts)} vertices")

    # Use scipy KDTree for fast nearest-neighbor lookup
    try:
        from scipy.spatial import cKDTree
    except ImportError:
        print("WARNING: scipy not available, using brute-force nearest neighbor")
        # Brute force fallback
        correspondence = np.zeros(len(smpl_vertices), dtype=np.uint32)
        for i, sv in enumerate(smpl_vertices):
            dists = np.linalg.norm(mh_verts - sv, axis=1)
            correspondence[i] = np.argmin(dists)
            if (i + 1) % 1000 == 0:
                print(f"    {i+1}/{len(smpl_vertices)} vertices mapped")
    else:
        print("  Building KD-tree...")
        tree = cKDTree(mh_verts)
        print("  Querying nearest neighbors...")
        distances, indices = tree.query(smpl_vertices)
        correspondence = indices.astype(np.uint32)
        avg_dist = distances.mean()
        max_dist = distances.max()
        print(f"  Average distance: {avg_dist:.6f}m, max: {max_dist:.6f}m")

    # Write binary
    SMMH_MAGIC = 0x534D4D48
    with open(out_path, "wb") as f:
        f.write(struct.pack("<I", SMMH_MAGIC))
        f.write(struct.pack("<I", len(smpl_vertices)))
        f.write(correspondence.tobytes())

    file_size = os.path.getsize(out_path)
    print(f"  Written: {out_path} ({file_size:,} bytes)")
    return out_path


# ─── Bundle Size Validation ──────────────────────────────────────────────────

def validate_bundle_size(out_dir: str):
    """Check that the combined gzipped size of all outputs is under 15MB."""
    print(f"\n[validate] Checking bundle size...")
    total_raw = 0
    total_gzipped = 0

    for fname in os.listdir(out_dir):
        fpath = os.path.join(out_dir, fname)
        if not os.path.isfile(fpath):
            continue
        raw_size = os.path.getsize(fpath)
        total_raw += raw_size

        # Compute gzipped size
        with open(fpath, "rb") as f:
            data = f.read()
        gz_data = gzip.compress(data, compresslevel=9)
        gz_size = len(gz_data)
        total_gzipped += gz_size

        ratio = gz_size / max(1, raw_size) * 100
        print(f"  {fname}: {raw_size:,} bytes → {gz_size:,} gzipped ({ratio:.0f}%)")

    print(f"  Total raw:     {total_raw:,} bytes ({total_raw / 1024 / 1024:.2f} MB)")
    print(f"  Total gzipped: {total_gzipped:,} bytes ({total_gzipped / 1024 / 1024:.2f} MB)")

    if total_gzipped > MAX_BUNDLE_GZIPPED:
        print(f"WARNING: Bundle exceeds {MAX_BUNDLE_GZIPPED / 1024 / 1024:.0f}MB gzipped limit!")
    else:
        print(f"  ✓ Under {MAX_BUNDLE_GZIPPED / 1024 / 1024:.0f}MB gzipped limit")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # Resolve paths
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(base_dir, args.out)
    os.makedirs(out_dir, exist_ok=True)

    print("=" * 60)
    print("  SMPL Asset Export Pipeline")
    print("=" * 60)
    print(f"  SMPL pickle: {args.smpl_pkl}")
    print(f"  Output dir:  {out_dir}")

    # Load and validate SMPL model
    smpl_data = load_smpl_pkl(args.smpl_pkl)
    validate_smpl_data(smpl_data)

    # Load custom landmarks if provided, otherwise use built-in
    if args.landmarks_json:
        print(f"[landmarks] Loading custom landmarks: {args.landmarks_json}")
        with open(args.landmarks_json) as f:
            landmarks = json.load(f)
    else:
        landmarks = SMPL_LANDMARKS.copy()

    # 1. Export smpl_model.bin
    bin_path = os.path.join(out_dir, "smpl_model.bin")
    export_smpl_model_bin(smpl_data, landmarks, bin_path)

    # 2. Export smpl_regressor.onnx
    if not args.skip_onnx:
        onnx_path = os.path.join(out_dir, "smpl_regressor.onnx")
        export_regressor_onnx(onnx_path)
    else:
        print("\n[onnx] Skipped (--skip-onnx)")

    # 3. Export smpl_landmarks.json
    json_path = os.path.join(out_dir, "smpl_landmarks.json")
    export_landmarks_json(landmarks, json_path)

    # 4. Export smpl_to_makehuman.bin correspondence map
    if not args.skip_correspondence and args.makehuman_glb:
        v_template = np.array(smpl_data["v_template"], dtype=np.float64)
        v_template = transform_to_yup(v_template)
        corr_path = os.path.join(out_dir, "smpl_to_makehuman.bin")
        mh_path = os.path.join(base_dir, args.makehuman_glb)
        export_correspondence_map(v_template, mh_path, corr_path)
    elif not args.makehuman_glb:
        print("\n[correspondence] Skipped (no --makehuman-glb provided)")
    else:
        print("\n[correspondence] Skipped (--skip-correspondence)")

    # Validate bundle size
    validate_bundle_size(out_dir)

    print("\n" + "=" * 60)
    print("  Export complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
