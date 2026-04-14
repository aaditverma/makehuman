"""
Blender script: Load SMPL model from pickle, create mesh with shape key
morph targets (10 beta PCs), subdivide, apply skin texture, export as GLB.

This replaces the MakeHuman model with an SMPL-based avatar that responds
directly to beta parameters as morph targets.

Usage:
  blender --background --python scripts/generate-smpl-model.py -- \
    --smpl-pkl "C:\path\to\basicmodel_m_lbs_10_207_0_v1.1.0.pkl" \
    --subdivisions 2 \
    --texture public/models/textures/young_lightskinned_male_diffuse.png

Blender path (Windows):
  "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"
"""

import bpy
import math
import os
import pickle
import sys
import time

import numpy as np

# ─── CLI Args ─────────────────────────────────────────────────────────────────

argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

import argparse
parser = argparse.ArgumentParser(description="Generate SMPL GLB model with morph targets")
parser.add_argument("--smpl-pkl", required=True, help="Path to SMPL .pkl file")
parser.add_argument("--subdivisions", type=int, default=2, help="Subdivision levels (default: 2)")
parser.add_argument("--texture", default=None, help="Path to skin texture image")
parser.add_argument("--out", default=None, help="Output GLB path (default: public/models/human-smpl.glb)")
parser.add_argument("--num-shapes", type=int, default=10, help="Number of shape PCs to export (default: 10)")
args = parser.parse_args(argv)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SMPL_PKL = args.smpl_pkl if os.path.isabs(args.smpl_pkl) else os.path.join(BASE_DIR, args.smpl_pkl)
SUBDIVISIONS = args.subdivisions
NUM_SHAPES = args.num_shapes
TEXTURE_PATH = args.texture
if TEXTURE_PATH and not os.path.isabs(TEXTURE_PATH):
    TEXTURE_PATH = os.path.join(BASE_DIR, TEXTURE_PATH)
OUT_PATH = args.out or os.path.join(BASE_DIR, "public", "models", "human-smpl.glb")

print("=" * 60)
print("  SMPL Model Generator")
print("=" * 60)
print(f"  SMPL pickle:   {SMPL_PKL}")
print(f"  Subdivisions:  {SUBDIVISIONS}")
print(f"  Shape PCs:     {NUM_SHAPES}")
print(f"  Texture:       {TEXTURE_PATH or 'none'}")
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
        """Convert to dense numpy array."""
        # Try to reconstruct from CSC format data
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
        # Stub scipy sparse matrices — SMPL pickle references scipy.sparse.csc.csc_matrix
        if module.startswith('scipy.sparse'):
            import importlib
            try:
                mod = importlib.import_module(module)
                return getattr(mod, name)
            except (ImportError, AttributeError):
                # If scipy not available, return a stub that stores the data
                return _ScipyStub
        return super().find_class(module, name)

print("\n[1/6] Loading SMPL pickle...")
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
            print(f"  Converted '{key}' → numpy {x.shape}")

v_template = np.array(smpl_data['v_template'], dtype=np.float64)  # (6890, 3)
faces = np.array(smpl_data['f'], dtype=np.int32)                   # (13776, 3)
shapedirs = np.array(smpl_data['shapedirs'])                        # (6890, 3, 300)

print(f"  Template: {v_template.shape}, Faces: {faces.shape}, ShapeDirs: {shapedirs.shape}")
print(f"  Loaded in {time.time() - t0:.1f}s")

# ─── Coordinate Transform ────────────────────────────────────────────────────
# SMPL native is Y-up. Blender uses Z-up internally.
# We need to convert Y-up → Z-up for Blender: (x, y, z) → (x, z, -y)
# Then export_yup=True will convert back to Y-up for the GLB.

print("  Converting Y-up (SMPL) → Z-up (Blender)")
v_blender = v_template.copy()
v_blender[:, 0] = v_template[:, 0]   # X stays
v_blender[:, 1] = -v_template[:, 2]  # Blender Y = -SMPL Z (forward)
v_blender[:, 2] = v_template[:, 1]   # Blender Z = SMPL Y (up)

# Same transform for shape dirs
sd_blender = shapedirs.copy()
sd_blender[:, 0, :] = shapedirs[:, 0, :]   # X stays
sd_blender[:, 1, :] = -shapedirs[:, 2, :]  # Blender Y = -SMPL Z
sd_blender[:, 2, :] = shapedirs[:, 1, :]   # Blender Z = SMPL Y

# Shift feet to Z=0 in Blender space (Z is up in Blender)
z_min = v_blender[:, 2].min()
v_blender[:, 2] -= z_min
print(f"  Shifted Z by {-z_min:.4f}, feet now at Z=0")

# Center X/Y in Blender space
cx = v_blender[:, 0].mean()
cy = v_blender[:, 1].mean()
v_blender[:, 0] -= cx
v_blender[:, 1] -= cy

# Use blender-space coords from here on
v_template = v_blender
shapedirs = sd_blender

print(f"  Vertex ranges (Blender Z-up): X=[{v_template[:,0].min():.3f}, {v_template[:,0].max():.3f}] "
      f"Y=[{v_template[:,1].min():.3f}, {v_template[:,1].max():.3f}] "
      f"Z=[{v_template[:,2].min():.3f}, {v_template[:,2].max():.3f}]")


# ─── Create Blender Mesh ─────────────────────────────────────────────────────

print("\n[2/6] Creating Blender mesh...")
bpy.ops.wm.read_factory_settings(use_empty=True)

mesh = bpy.data.meshes.new("SMPL_Body")
obj = bpy.data.objects.new("SMPL_Body", mesh)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

# Create mesh from SMPL data
verts_list = [tuple(v) for v in v_template]
faces_list = [tuple(f) for f in faces]
mesh.from_pydata(verts_list, [], faces_list)
mesh.update()

print(f"  Created mesh: {len(mesh.vertices)} verts, {len(mesh.polygons)} faces")

# Fix normals and smooth shading
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()
print("  Applied smooth shading")

# ─── Subdivide FIRST (before shape keys) ─────────────────────────────────────

print(f"\n[3/6] Subdividing {SUBDIVISIONS}x (before shape keys)...")
t0 = time.time()

sub = obj.modifiers.new(name="Subdivision", type='SUBSURF')
sub.levels = SUBDIVISIONS
sub.render_levels = SUBDIVISIONS
bpy.ops.object.modifier_apply(modifier=sub.name)
bpy.ops.object.shade_smooth()

subdivided_vert_count = len(mesh.vertices)
print(f"  Now {subdivided_vert_count:,} vertices, {len(mesh.polygons):,} faces")
print(f"  Subdivision took {time.time() - t0:.1f}s")

# ─── Add Shape Keys (SMPL Beta PCs as Morph Targets) ─────────────────────────
# We need to interpolate the SMPL shape displacements onto the subdivided mesh.
# Strategy: for each subdivided vertex, find the nearest original SMPL vertex
# and use its displacement. This works because subdivision preserves the original
# vertices and adds new ones between them.

print(f"\n[4/6] Adding {NUM_SHAPES} shape key morph targets to subdivided mesh...")

# Get subdivided vertex positions
subdiv_coords = np.array([(v.co.x, v.co.y, v.co.z) for v in mesh.vertices])

# Build KD-tree from original SMPL vertices for nearest-neighbor lookup
from mathutils import kdtree as kd_module

kd = kd_module.KDTree(len(v_template))
for i, v in enumerate(v_template):
    kd.insert((v[0], v[1], v[2]), i)
kd.balance()

# For each subdivided vertex, find nearest original SMPL vertex
print("  Building vertex correspondence map...")
nearest_smpl_idx = np.zeros(subdivided_vert_count, dtype=np.int32)
for vi in range(subdivided_vert_count):
    co = subdiv_coords[vi]
    _, idx, _ = kd.find((co[0], co[1], co[2]))
    nearest_smpl_idx[vi] = idx

# Basis shape key
obj.shape_key_add(name="Basis", from_mix=False)

BETA_SCALE = 3.0  # morph influence 1.0 = beta value 3.0

for pc_idx in range(NUM_SHAPES):
    name = f"Beta{pc_idx}"
    sk = obj.shape_key_add(name=name, from_mix=False)
    
    # shapedirs is (6890, 3, N) — extract PC at index pc_idx
    smpl_displacements = shapedirs[:, :, pc_idx] * BETA_SCALE  # (6890, 3)
    
    for vi in range(subdivided_vert_count):
        smpl_vi = nearest_smpl_idx[vi]
        sk.data[vi].co.x = subdiv_coords[vi, 0] + smpl_displacements[smpl_vi, 0]
        sk.data[vi].co.y = subdiv_coords[vi, 1] + smpl_displacements[smpl_vi, 1]
        sk.data[vi].co.z = subdiv_coords[vi, 2] + smpl_displacements[smpl_vi, 2]
    
    disp_mag = np.linalg.norm(smpl_displacements, axis=1)
    print(f"  + {name}: max displacement {disp_mag.max()*1000:.1f}mm, "
          f"mean {disp_mag.mean()*1000:.1f}mm")

print(f"  Total shape keys: {len(obj.data.shape_keys.key_blocks)}")


# ─── UV Unwrap + Texture ──────────────────────────────────────────────────────

print("\n[5/6] UV unwrapping and applying material...")

# Smart UV project for texture mapping
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')
print("  UV unwrapped (smart project)")

# Create material
mat = bpy.data.materials.new(name="SMPL_Skin")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links

# Clear default nodes
for node in nodes:
    nodes.remove(node)

# Create shader nodes
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
bsdf.location = (0, 0)
bsdf.inputs['Roughness'].default_value = 0.6
bsdf.inputs['Metallic'].default_value = 0.0

# Try Sheen if available (Blender 4.0+)
try:
    bsdf.inputs['Sheen Weight'].default_value = 0.12
except KeyError:
    try:
        bsdf.inputs['Sheen'].default_value = 0.12
    except KeyError:
        pass

output = nodes.new('ShaderNodeOutputMaterial')
output.location = (300, 0)
links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

# Add texture if provided
if TEXTURE_PATH and os.path.exists(TEXTURE_PATH):
    print(f"  Loading texture: {TEXTURE_PATH}")
    tex_node = nodes.new('ShaderNodeTexImage')
    tex_node.location = (-400, 0)
    img = bpy.data.images.load(TEXTURE_PATH)
    tex_node.image = img
    links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
    print(f"  Texture applied: {img.size[0]}x{img.size[1]}")
else:
    # Default skin color
    bsdf.inputs['Base Color'].default_value = (0.76, 0.60, 0.48, 1.0)
    print("  No texture — using default skin color")

obj.data.materials.append(mat)

# ─── Export GLB ───────────────────────────────────────────────────────────────

print(f"\n[6/6] Exporting GLB → {OUT_PATH}")
t0 = time.time()

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

bpy.ops.export_scene.gltf(
    filepath=OUT_PATH,
    export_format='GLB',
    use_selection=True,
    export_apply=False,
    export_morph=True,
    export_morph_normal=True,
    export_morph_tangent=False,
    export_skins=False,
    export_animations=False,
    export_yup=True,  # Convert Blender Z-up back to GLB Y-up
    export_normals=True,
    export_image_format='AUTO',
)

file_size = os.path.getsize(OUT_PATH)
print(f"  Written: {OUT_PATH}")
print(f"  Size: {file_size:,} bytes ({file_size / 1024 / 1024:.1f} MB)")
print(f"  Export took {time.time() - t0:.1f}s")

# Summary
print(f"\n{'=' * 60}")
print(f"  SMPL Model Generation Complete")
print(f"{'=' * 60}")
print(f"  Vertices:     {len(mesh.vertices):,}")
print(f"  Faces:        {len(mesh.polygons):,}")
print(f"  Shape keys:   {len(obj.data.shape_keys.key_blocks)} (Basis + {NUM_SHAPES} betas)")
print(f"  Subdivisions: {SUBDIVISIONS}")
print(f"  File size:    {file_size / 1024 / 1024:.1f} MB")
print(f"  Output:       {OUT_PATH}")
