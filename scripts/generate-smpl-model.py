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

# ─── Create Armature and Pose into A-Pose ─────────────────────────────────────
# Use SMPL's actual skeleton (24 joints) and skinning weights for proper posing.
# SMPL joint indices: 0=pelvis, 1=left_hip, 2=right_hip, ..., 16=left_shoulder,
# 17=right_shoulder, 18=left_elbow, 19=right_elbow, 20=left_wrist, 21=right_wrist

print("  Creating armature for A-pose...")

# Load skinning weights and joint regressor
skin_weights = np.array(smpl_data['weights'], dtype=np.float64)  # (6890, 24)
j_regressor = smpl_data.get('J_regressor')
if hasattr(j_regressor, 'toarray'):
    j_regressor = j_regressor.toarray()
j_regressor = np.array(j_regressor, dtype=np.float64)  # (24, 6890)

# Compute joint positions from template vertices (in Blender Z-up space)
joint_positions = j_regressor @ v_template  # (24, 3)

# SMPL joint names (standard 24-joint skeleton)
SMPL_JOINT_NAMES = [
    'pelvis', 'left_hip', 'right_hip', 'spine1', 'left_knee', 'right_knee',
    'spine2', 'left_ankle', 'right_ankle', 'spine3', 'left_foot', 'right_foot',
    'neck', 'left_collar', 'right_collar', 'head', 'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_hand', 'right_hand',
]

# SMPL kinematic tree (parent indices)
kintree = np.array(smpl_data['kintree_table'], dtype=np.int32)  # (2, 24)
parents = kintree[0]  # parent joint index for each joint

# Create armature
arm_data = bpy.data.armatures.new("SMPL_Armature")
arm_obj = bpy.data.objects.new("SMPL_Armature", arm_data)
bpy.context.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)

# Enter edit mode to create bones
bpy.ops.object.mode_set(mode='EDIT')

bones = {}
for i, name in enumerate(SMPL_JOINT_NAMES):
    bone = arm_data.edit_bones.new(name)
    jpos = joint_positions[i]
    bone.head = (jpos[0], jpos[1], jpos[2])
    # Tail points toward child or slightly up
    bone.tail = (jpos[0], jpos[1], jpos[2] + 0.05)
    bones[name] = bone

# Set parent relationships
for i, name in enumerate(SMPL_JOINT_NAMES):
    if i == 0:
        continue  # pelvis has no parent
    parent_idx = parents[i]
    if parent_idx >= 0 and parent_idx < len(SMPL_JOINT_NAMES):
        bones[name].parent = bones[SMPL_JOINT_NAMES[parent_idx]]
        # Point parent tail toward this child
        bones[SMPL_JOINT_NAMES[parent_idx]].tail = bones[name].head

bpy.ops.object.mode_set(mode='OBJECT')

# Parent mesh to armature with vertex groups
obj.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.parent_set(type='ARMATURE_NAME')

# Assign skinning weights
for ji, jname in enumerate(SMPL_JOINT_NAMES):
    if jname not in obj.vertex_groups:
        vg = obj.vertex_groups.new(name=jname)
    else:
        vg = obj.vertex_groups[jname]
    
    for vi in range(len(v_template)):
        w = skin_weights[vi, ji]
        if w > 0.001:
            vg.add([vi], float(w), 'REPLACE')

# Add armature modifier
arm_mod = obj.modifiers.new(name="Armature", type='ARMATURE')
arm_mod.object = arm_obj

# Pose into A-pose: rotate shoulders down ~35 degrees
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode='POSE')

ARM_ANGLE_DEG = 35

# Left shoulder (joint 16) — rotate around local Y axis (forward in Blender)
left_shoulder = arm_obj.pose.bones.get('left_shoulder')
if left_shoulder:
    left_shoulder.rotation_mode = 'XYZ'
    left_shoulder.rotation_euler = (0, math.radians(ARM_ANGLE_DEG), 0)

# Right shoulder (joint 17) — rotate opposite direction
right_shoulder = arm_obj.pose.bones.get('right_shoulder')
if right_shoulder:
    right_shoulder.rotation_mode = 'XYZ'
    right_shoulder.rotation_euler = (0, math.radians(-ARM_ANGLE_DEG), 0)

bpy.ops.object.mode_set(mode='OBJECT')

# Apply the pose as rest pose
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')

# Apply armature modifier to bake the pose into the mesh
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
arm_obj.select_set(False)
bpy.ops.object.modifier_apply(modifier=arm_mod.name)

# Remove armature (we only needed it for posing)
bpy.data.objects.remove(arm_obj, do_unlink=True)
bpy.data.armatures.remove(arm_data)

# Update v_template to match the posed mesh (for shape key computation)
for vi, v in enumerate(mesh.vertices):
    v_template[vi] = [v.co.x, v.co.y, v.co.z]

mesh.update()
print(f"  Arms posed into A-pose ({ARM_ANGLE_DEG}° down) using SMPL skeleton")

# ─── Add Shape Keys on base mesh, then subdivide via workaround ───────────────
# Blender cannot apply a subdivision modifier to a mesh with shape keys.
# Workaround: for each shape key, we create a separate subdivided mesh to get
# the smooth interpolated positions, then transfer those positions back.
#
# Strategy:
#   1. Add shape keys on the 6,890-vertex base mesh
#   2. For each shape key, create a temp copy with that shape key active,
#      subdivide it, read the subdivided positions
#   3. Create the final subdivided mesh with shape keys from the temp data

print(f"\n[3/6] Computing smooth shape key displacements via subdivision...")
t0 = time.time()

BETA_SCALE = 3.0  # morph influence 1.0 = beta value 3.0
base_vert_count = len(v_template)

# First, create a subdivided version of the base mesh to get the target vertex count
# and the subdivided basis positions
temp_obj = obj.copy()
temp_obj.data = obj.data.copy()
bpy.context.collection.objects.link(temp_obj)
bpy.context.view_layer.objects.active = temp_obj
temp_obj.select_set(True)
obj.select_set(False)

sub = temp_obj.modifiers.new(name="Subdivision", type='SUBSURF')
sub.levels = SUBDIVISIONS
sub.render_levels = SUBDIVISIONS
bpy.ops.object.modifier_apply(modifier=sub.name)

subdivided_vert_count = len(temp_obj.data.vertices)
basis_subdiv_coords = np.array([(v.co.x, v.co.y, v.co.z) for v in temp_obj.data.vertices])
print(f"  Subdivided basis: {subdivided_vert_count:,} vertices")

# Now compute subdivided positions for each shape key direction
# by temporarily deforming the base mesh and subdividing
shape_key_data = {}  # name → subdivided coords (N, 3)

for pc_idx in range(NUM_SHAPES):
    for direction, sign, suffix in [(+1, -BETA_SCALE, ""), (-1, BETA_SCALE, "Neg")]:
        name = f"Beta{pc_idx}{suffix}"
        
        # Create a temp mesh with the deformed positions
        # NOTE: signs are flipped because SMPL's PCA convention has the opposite
        # direction from what we want (positive beta = larger body).
        deformed_verts = v_template + shapedirs[:, :, pc_idx] * sign
        
        temp2_mesh = bpy.data.meshes.new(f"temp_{name}")
        temp2_obj = bpy.data.objects.new(f"temp_{name}", temp2_mesh)
        bpy.context.collection.objects.link(temp2_obj)
        
        verts_list2 = [tuple(v) for v in deformed_verts]
        faces_list2 = [tuple(f) for f in faces]
        temp2_mesh.from_pydata(verts_list2, [], faces_list2)
        temp2_mesh.update()
        
        # Subdivide
        bpy.context.view_layer.objects.active = temp2_obj
        temp2_obj.select_set(True)
        sub2 = temp2_obj.modifiers.new(name="Subdivision", type='SUBSURF')
        sub2.levels = SUBDIVISIONS
        sub2.render_levels = SUBDIVISIONS
        bpy.ops.object.modifier_apply(modifier=sub2.name)
        
        shape_key_data[name] = np.array([(v.co.x, v.co.y, v.co.z) for v in temp2_obj.data.vertices])
        
        # Clean up temp object
        bpy.data.objects.remove(temp2_obj, do_unlink=True)
        bpy.data.meshes.remove(temp2_mesh)
        
        disp = shape_key_data[name] - basis_subdiv_coords
        disp_mag = np.linalg.norm(disp, axis=1)
        print(f"  + {name}: max displacement {disp_mag.max()*1000:.1f}mm, "
              f"mean {disp_mag.mean()*1000:.1f}mm")

print(f"  Shape key computation took {time.time() - t0:.1f}s")

# ─── Build final subdivided mesh with shape keys ─────────────────────────────

print(f"\n[4/6] Building final mesh with {NUM_SHAPES * 2} smooth shape keys...")

# Remove the original low-res object, use the subdivided temp as our base
bpy.data.objects.remove(obj, do_unlink=True)
bpy.data.meshes.remove(mesh)

obj = temp_obj
mesh = obj.data
obj.name = "SMPL_Body"
mesh.name = "SMPL_Body"
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

# Fix normals and smooth shading on subdivided mesh
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()

# Add shape keys to the subdivided mesh
obj.shape_key_add(name="Basis", from_mix=False)

for pc_idx in range(NUM_SHAPES):
    for suffix in ["", "Neg"]:
        name = f"Beta{pc_idx}{suffix}"
        sk = obj.shape_key_add(name=name, from_mix=False)
        coords = shape_key_data[name]
        for vi in range(subdivided_vert_count):
            sk.data[vi].co.x = coords[vi, 0]
            sk.data[vi].co.y = coords[vi, 1]
            sk.data[vi].co.z = coords[vi, 2]

print(f"  Final mesh: {subdivided_vert_count:,} vertices, {len(mesh.polygons):,} faces")
print(f"  Shape keys: {len(obj.data.shape_keys.key_blocks)}")


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
print(f"  Shape keys:   {len(obj.data.shape_keys.key_blocks)} (Basis + {NUM_SHAPES} positive + {NUM_SHAPES} negative)")
print(f"  Subdivisions: {SUBDIVISIONS}")
print(f"  File size:    {file_size / 1024 / 1024:.1f} MB")
print(f"  Output:       {OUT_PATH}")
