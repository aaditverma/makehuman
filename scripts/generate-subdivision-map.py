"""
Generate subdivision mapping binary for SMPL base mesh → subdivided mesh.

Loads the SMPL base mesh (6,890 vertices, 13,776 faces), applies Catmull-Clark
subdivision (2 levels), and computes barycentric coordinates mapping each
subdivided vertex back to a base mesh triangle.

Output: smpl_subdiv_map.bin

Binary format (must match parseSubdivisionMap() in subdivisionMapper.ts):
  Header (16 bytes):
    magic:           uint32 — 0x53554244 ("SUBD")
    version:         uint16 — 1
    reserved:        uint16 — 0
    baseVertCount:   uint32 — 6890
    subdivVertCount: uint32 — ~165,000

  Per-vertex data (subdivVertCount × 16 bytes):
    faceIdx:  uint32  — index into base mesh face array
    bary0:    float32 — barycentric weight for vertex 0 of face
    bary1:    float32 — barycentric weight for vertex 1 of face
    bary2:    float32 — barycentric weight for vertex 2 of face

Usage (Blender):
  blender --background --python scripts/generate-subdivision-map.py -- \
    --smpl-pkl "path/to/basicmodel_m_lbs_10_207_0_v1.1.0.pkl" \
    --out public/models/smpl/smpl_subdiv_map.bin

Blender path (Windows):
  "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe"
"""

import bpy
import math
import os
import pickle
import struct
import sys
import time

import numpy as np

# ─── Constants ────────────────────────────────────────────────────────────────

SUBDIV_MAGIC = 0x53554244   # "SUBD" in ASCII
SUBDIV_VERSION = 1
EXPECTED_VERTEX_COUNT = 6890
EXPECTED_FACE_COUNT = 13776

# ─── CLI Args ─────────────────────────────────────────────────────────────────

argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

import argparse
parser = argparse.ArgumentParser(description="Generate SMPL subdivision mapping binary")
parser.add_argument("--smpl-pkl", required=True, help="Path to SMPL .pkl file")
parser.add_argument("--subdivisions", type=int, default=2, help="Subdivision levels (default: 2)")
parser.add_argument("--out", default=None, help="Output binary path (default: public/models/smpl/smpl_subdiv_map.bin)")
args = parser.parse_args(argv)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SMPL_PKL = args.smpl_pkl if os.path.isabs(args.smpl_pkl) else os.path.join(BASE_DIR, args.smpl_pkl)
SUBDIVISIONS = args.subdivisions
OUT_PATH = args.out or os.path.join(BASE_DIR, "public", "models", "smpl", "smpl_subdiv_map.bin")

print("=" * 60)
print("  SMPL Subdivision Map Generator")
print("=" * 60)
print(f"  SMPL pickle:   {SMPL_PKL}")
print(f"  Subdivisions:  {SUBDIVISIONS}")
print(f"  Output:        {OUT_PATH}")


# ─── Load SMPL Pickle (chumpy-free) ──────────────────────────────────────────

class _ChumpyStub:
    """Stub for chumpy.Ch objects."""
    def __init__(self, *args, **kwargs):
        pass
    def __array__(self, dtype=None, copy=None):
        x = self.__dict__.get('x', None)
        if x is not None and isinstance(x, np.ndarray):
            return np.array(x, dtype=dtype) if dtype else x
        return np.zeros(0, dtype=dtype or np.float64)
    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
        elif isinstance(state, np.ndarray):
            self.__dict__['x'] = state

class _ScipyStub:
    """Stub for scipy.sparse matrices when scipy is not available."""
    def __init__(self, *args, **kwargs):
        self._data = None
        self._shape = None
    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
    def toarray(self):
        data = self.__dict__.get('data', None)
        indices = self.__dict__.get('indices', None)
        indptr = self.__dict__.get('indptr', None)
        shape = self.__dict__.get('_shape', None)
        if data is not None and indices is not None and indptr is not None and shape is not None:
            result = np.zeros(shape, dtype=data.dtype)
            for col in range(shape[1]):
                for idx in range(indptr[col], indptr[col + 1]):
                    result[indices[idx], col] = data[idx]
            return result
        return np.zeros((0, 0))

class SmplUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module.startswith('chumpy'):
            return _ChumpyStub
        if module.startswith('scipy.sparse'):
            import importlib
            try:
                mod = importlib.import_module(module)
                return getattr(mod, name)
            except (ImportError, AttributeError):
                return _ScipyStub
        return super().find_class(module, name)

print("\n[1/4] Loading SMPL pickle...")
t0 = time.time()

with open(SMPL_PKL, "rb") as f:
    smpl_data = SmplUnpickler(f, encoding="latin1").load()

# Convert chumpy stubs to numpy
for key in list(smpl_data.keys()):
    val = smpl_data[key]
    if isinstance(val, _ChumpyStub):
        x = val.__dict__.get('x', None)
        if x is not None and isinstance(x, np.ndarray):
            smpl_data[key] = x

v_template = np.array(smpl_data['v_template'], dtype=np.float64)  # (6890, 3)
faces = np.array(smpl_data['f'], dtype=np.int32)                   # (13776, 3)

print(f"  Template: {v_template.shape}, Faces: {faces.shape}")
print(f"  Loaded in {time.time() - t0:.1f}s")

assert v_template.shape == (EXPECTED_VERTEX_COUNT, 3), \
    f"Expected {EXPECTED_VERTEX_COUNT} vertices, got {v_template.shape[0]}"
assert faces.shape == (EXPECTED_FACE_COUNT, 3), \
    f"Expected {EXPECTED_FACE_COUNT} faces, got {faces.shape[0]}"


# ─── Create Blender Mesh and Subdivide ────────────────────────────────────────

print("\n[2/4] Creating mesh and applying subdivision...")
bpy.ops.wm.read_factory_settings(use_empty=True)

mesh = bpy.data.meshes.new("SMPL_Base")
obj = bpy.data.objects.new("SMPL_Base", mesh)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

verts_list = [tuple(v) for v in v_template]
faces_list = [tuple(f) for f in faces]
mesh.from_pydata(verts_list, [], faces_list)
mesh.update()

print(f"  Base mesh: {len(mesh.vertices)} verts, {len(mesh.polygons)} faces")

# Apply Catmull-Clark subdivision
sub = obj.modifiers.new(name="Subdivision", type='SUBSURF')
sub.levels = SUBDIVISIONS
sub.render_levels = SUBDIVISIONS
bpy.ops.object.modifier_apply(modifier=sub.name)

subdiv_vert_count = len(mesh.vertices)
subdiv_face_count = len(mesh.polygons)
print(f"  Subdivided mesh: {subdiv_vert_count:,} verts, {subdiv_face_count:,} faces")

# Extract subdivided vertex positions
subdiv_verts = np.array([(v.co.x, v.co.y, v.co.z) for v in mesh.vertices], dtype=np.float64)


# ─── Compute Barycentric Mapping ─────────────────────────────────────────────

print("\n[3/4] Computing barycentric mapping...")
t0 = time.time()

# For each subdivided vertex, find the nearest base mesh face and compute
# barycentric coordinates.

# Precompute face data for the base mesh
base_face_verts = v_template[faces]  # (13776, 3, 3) — face vertices
base_face_centers = base_face_verts.mean(axis=1)  # (13776, 3) — face centroids

# Build a KD-tree of face centroids for fast nearest-face lookup
from mathutils import Vector  # Blender's math library

def compute_barycentric(p, a, b, c):
    """Compute barycentric coordinates of point p with respect to triangle (a, b, c).
    
    Returns (u, v, w) such that p ≈ u*a + v*b + w*c.
    Uses the method from "Real-Time Collision Detection" by Christer Ericson.
    """
    v0 = b - a
    v1 = c - a
    v2 = p - a
    
    d00 = np.dot(v0, v0)
    d01 = np.dot(v0, v1)
    d11 = np.dot(v1, v1)
    d20 = np.dot(v2, v0)
    d21 = np.dot(v2, v1)
    
    denom = d00 * d11 - d01 * d01
    if abs(denom) < 1e-12:
        # Degenerate triangle — return equal weights
        return 1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0
    
    inv_denom = 1.0 / denom
    v = (d11 * d20 - d01 * d21) * inv_denom
    w = (d00 * d21 - d01 * d20) * inv_denom
    u = 1.0 - v - w
    
    return u, v, w


# For efficiency, use a spatial approach: for each subdivided vertex,
# find the K nearest face centroids, then pick the face with the best
# barycentric coordinates (closest to valid range [0,1]).

from scipy.spatial import cKDTree

print("  Building face centroid KD-tree...")
face_tree = cKDTree(base_face_centers)

K_CANDIDATES = 8  # number of candidate faces to check per vertex

face_indices = np.zeros(subdiv_vert_count, dtype=np.uint32)
bary_coords = np.zeros((subdiv_vert_count, 3), dtype=np.float32)
max_error = 0.0

for vi in range(subdiv_vert_count):
    p = subdiv_verts[vi]
    
    # Find K nearest face centroids
    _, candidate_face_idxs = face_tree.query(p, k=K_CANDIDATES)
    
    best_face = 0
    best_bary = (1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0)
    best_dist = float('inf')
    
    for fi in candidate_face_idxs:
        a = v_template[faces[fi, 0]]
        b = v_template[faces[fi, 1]]
        c = v_template[faces[fi, 2]]
        
        u, v, w = compute_barycentric(p, a, b, c)
        
        # Clamp to valid range for distance computation
        u_c = max(0.0, min(1.0, u))
        v_c = max(0.0, min(1.0, v))
        w_c = max(0.0, min(1.0, w))
        s = u_c + v_c + w_c
        if s > 0:
            u_c /= s
            v_c /= s
            w_c /= s
        
        # Compute reconstructed point
        recon = u_c * a + v_c * b + w_c * c
        dist = np.linalg.norm(p - recon)
        
        if dist < best_dist:
            best_dist = dist
            best_face = fi
            best_bary = (u_c, v_c, w_c)
    
    face_indices[vi] = best_face
    bary_coords[vi, 0] = best_bary[0]
    bary_coords[vi, 1] = best_bary[1]
    bary_coords[vi, 2] = best_bary[2]
    
    if best_dist > max_error:
        max_error = best_dist
    
    if (vi + 1) % 10000 == 0:
        print(f"    {vi + 1:,}/{subdiv_vert_count:,} vertices mapped...")

elapsed = time.time() - t0
print(f"  Mapping complete in {elapsed:.1f}s")
print(f"  Max barycentric reconstruction error: {max_error:.6f}m ({max_error * 1000:.3f}mm)")

# Verify barycentric weight sums
bary_sums = bary_coords.sum(axis=1)
max_sum_error = np.abs(bary_sums - 1.0).max()
print(f"  Max barycentric weight sum error: {max_sum_error:.8f}")


# ─── Export Binary ────────────────────────────────────────────────────────────

print(f"\n[4/4] Exporting binary → {OUT_PATH}")

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

with open(OUT_PATH, "wb") as f:
    # Header (16 bytes)
    f.write(struct.pack("<I", SUBDIV_MAGIC))           # magic uint32
    f.write(struct.pack("<H", SUBDIV_VERSION))         # version uint16
    f.write(struct.pack("<H", 0))                      # reserved uint16
    f.write(struct.pack("<I", EXPECTED_VERTEX_COUNT))   # baseVertCount uint32
    f.write(struct.pack("<I", subdiv_vert_count))       # subdivVertCount uint32
    
    # Per-vertex data (16 bytes each)
    for vi in range(subdiv_vert_count):
        f.write(struct.pack("<I", int(face_indices[vi])))
        f.write(struct.pack("<f", float(bary_coords[vi, 0])))
        f.write(struct.pack("<f", float(bary_coords[vi, 1])))
        f.write(struct.pack("<f", float(bary_coords[vi, 2])))

file_size = os.path.getsize(OUT_PATH)

# Summary
print(f"\n{'=' * 60}")
print(f"  Subdivision Map Generation Complete")
print(f"{'=' * 60}")
print(f"  Base vertices:     {EXPECTED_VERTEX_COUNT:,}")
print(f"  Base faces:        {EXPECTED_FACE_COUNT:,}")
print(f"  Subdiv vertices:   {subdiv_vert_count:,}")
print(f"  Subdivision levels: {SUBDIVISIONS}")
print(f"  File size:         {file_size:,} bytes ({file_size / 1024 / 1024:.2f} MB)")
print(f"  Max bary error:    {max_error:.6f}m ({max_error * 1000:.3f}mm)")
print(f"  Output:            {OUT_PATH}")
