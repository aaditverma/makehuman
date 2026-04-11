"""
Blender script: Import MakeHuman FBX, generate body-shape morph targets, export GLB.
Run via: blender --background --python scripts/create-body-shapes.py
"""
import bpy
import bmesh
import os
import math

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "models", "human-base.fbx")
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "models", "human-morphs.glb")

# ── Clean scene ──────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)

# ── Import FBX ───────────────────────────────────────────
bpy.ops.import_scene.fbx(filepath=SRC, use_anim=False)

# Find the mesh object
mesh_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        mesh_obj = obj
        break

if mesh_obj is None:
    raise RuntimeError("No mesh found in FBX")

print(f"Found mesh: {mesh_obj.name}, verts: {len(mesh_obj.data.vertices)}")

# ── Ensure we have a basis shape key ─────────────────────
if mesh_obj.data.shape_keys is None:
    mesh_obj.shape_key_add(name="Basis", from_mix=False)

basis = mesh_obj.data.shape_keys.key_blocks["Basis"]

# ── Helper: vertex group regions ─────────────────────────
# We'll classify vertices by their Z height (up axis) and X spread
# MakeHuman models are typically Y-up or Z-up depending on export
# Let's detect the up axis by checking the bounding box

verts = mesh_obj.data.vertices
coords = [(v.co.x, v.co.y, v.co.z) for v in verts]
xs = [c[0] for c in coords]
ys = [c[1] for c in coords]
zs = [c[2] for c in coords]

y_range = max(ys) - min(ys)
z_range = max(zs) - min(zs)

# Determine up axis (the one with the largest range is likely height)
if y_range > z_range:
    UP = 1  # Y-up
    FORWARD = 2
    print("Detected Y-up orientation")
else:
    UP = 2  # Z-up
    FORWARD = 1
    print("Detected Z-up orientation")

SIDE = 0  # X is always side-to-side

height_min = min(c[UP] for c in coords)
height_max = max(c[UP] for c in coords)
height_range = height_max - height_min

def normalized_height(co):
    """Returns 0 (feet) to 1 (head) for a vertex."""
    return (co[UP] - height_min) / max(0.0001, height_range)

def distance_from_center(co):
    """Radial distance from the vertical center axis."""
    return math.sqrt(co[SIDE]**2 + co[FORWARD]**2)

# ── Shape key generators ─────────────────────────────────
# Each function takes basis coords and returns modified coords

def make_heavier(coords):
    """Expand torso and limbs outward — simulates weight gain."""
    result = []
    for co in coords:
        h = normalized_height(co)
        # More expansion in torso (0.3-0.7 height), less at extremities
        torso_factor = max(0, 1.0 - abs(h - 0.5) * 3.0)
        limb_factor = 0.3
        factor = torso_factor * 0.7 + limb_factor * 0.3
        
        dist = distance_from_center(co)
        expand = factor * 0.15 * max(0.1, dist)
        
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        new_co[FORWARD] += co[FORWARD] * expand * 0.8  # less front-to-back
        result.append(new_co)
    return result

def make_thinner(coords):
    """Contract torso and limbs inward — simulates weight loss."""
    result = []
    for co in coords:
        h = normalized_height(co)
        torso_factor = max(0, 1.0 - abs(h - 0.5) * 3.0)
        limb_factor = 0.25
        factor = torso_factor * 0.7 + limb_factor * 0.3
        
        dist = distance_from_center(co)
        contract = factor * 0.12 * max(0.1, dist)
        
        new_co = list(co)
        new_co[SIDE] -= co[SIDE] * contract
        new_co[FORWARD] -= co[FORWARD] * contract * 0.8
        result.append(new_co)
    return result

def make_muscular(coords):
    """Expand chest, shoulders, arms, thighs — simulates muscle."""
    result = []
    for co in coords:
        h = normalized_height(co)
        dist = distance_from_center(co)
        
        # Chest/shoulder area (0.55-0.75 height)
        chest = max(0, 1.0 - abs(h - 0.65) * 5.0)
        # Upper arm area (0.5-0.65 height, far from center)
        arm = max(0, 1.0 - abs(h - 0.58) * 6.0) * min(1, max(0, dist - 0.1) * 4)
        # Thigh area (0.25-0.45 height)
        thigh = max(0, 1.0 - abs(h - 0.35) * 5.0)
        
        factor = max(chest * 0.5, arm * 0.4, thigh * 0.3)
        expand = factor * 0.12 * max(0.1, dist)
        
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        new_co[FORWARD] += co[FORWARD] * expand * 0.9
        result.append(new_co)
    return result

def make_taller(coords):
    """Stretch vertically, mostly legs and torso."""
    result = []
    for co in coords:
        h = normalized_height(co)
        # Scale up from feet, more stretch in legs and torso
        stretch = h * 0.08  # 8% taller at top
        new_co = list(co)
        new_co[UP] += stretch * height_range
        result.append(new_co)
    return result

def make_shorter(coords):
    """Compress vertically."""
    result = []
    for co in coords:
        h = normalized_height(co)
        compress = h * 0.08
        new_co = list(co)
        new_co[UP] -= compress * height_range
        result.append(new_co)
    return result

def make_wider_shoulders(coords):
    """Expand shoulder area side-to-side."""
    result = []
    for co in coords:
        h = normalized_height(co)
        shoulder = max(0, 1.0 - abs(h - 0.72) * 6.0)
        expand = shoulder * 0.10
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        result.append(new_co)
    return result

def make_wider_hips(coords):
    """Expand hip area side-to-side."""
    result = []
    for co in coords:
        h = normalized_height(co)
        hip = max(0, 1.0 - abs(h - 0.42) * 6.0)
        expand = hip * 0.10
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        result.append(new_co)
    return result

def make_bigger_chest(coords):
    """Expand chest area."""
    result = []
    for co in coords:
        h = normalized_height(co)
        chest = max(0, 1.0 - abs(h - 0.65) * 6.0)
        dist = distance_from_center(co)
        expand = chest * 0.10 * max(0.1, dist)
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        new_co[FORWARD] += co[FORWARD] * expand * 1.2  # more depth
        result.append(new_co)
    return result

def make_bigger_stomach(coords):
    """Expand stomach/belly area, mostly forward."""
    result = []
    for co in coords:
        h = normalized_height(co)
        belly = max(0, 1.0 - abs(h - 0.48) * 5.0)
        # Only expand forward-facing vertices
        fwd = max(0, co[FORWARD]) / max(0.001, abs(co[FORWARD]) + 0.001)
        expand = belly * 0.12
        new_co = list(co)
        new_co[FORWARD] += expand * (0.5 + fwd * 0.5) * max(0.05, abs(co[FORWARD]))
        new_co[SIDE] += co[SIDE] * expand * 0.3
        result.append(new_co)
    return result

def make_longer_legs(coords):
    """Stretch legs, keep torso same."""
    result = []
    for co in coords:
        h = normalized_height(co)
        if h < 0.5:
            stretch = (0.5 - h) * 0.12
            new_co = list(co)
            new_co[UP] -= stretch * height_range
            result.append(new_co)
        else:
            result.append(list(co))
    return result

def make_longer_arms(coords):
    """Extend arm vertices downward."""
    result = []
    for co in coords:
        h = normalized_height(co)
        dist = distance_from_center(co)
        # Arms: mid height, far from center
        arm_region = max(0, 1.0 - abs(h - 0.55) * 4.0) * min(1, max(0, dist - 0.12) * 5)
        new_co = list(co)
        new_co[UP] -= arm_region * 0.04 * height_range
        result.append(new_co)
    return result

def make_thicker_neck(coords):
    """Expand neck area."""
    result = []
    for co in coords:
        h = normalized_height(co)
        neck = max(0, 1.0 - abs(h - 0.82) * 10.0)
        expand = neck * 0.08
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        new_co[FORWARD] += co[FORWARD] * expand
        result.append(new_co)
    return result

# ── Create all shape keys ────────────────────────────────
shapes = {
    "Heavier": make_heavier,
    "Thinner": make_thinner,
    "Muscular": make_muscular,
    "Taller": make_taller,
    "Shorter": make_shorter,
    "WiderShoulders": make_wider_shoulders,
    "WiderHips": make_wider_hips,
    "BiggerChest": make_bigger_chest,
    "BiggerStomach": make_bigger_stomach,
    "LongerLegs": make_longer_legs,
    "LongerArms": make_longer_arms,
    "ThickerNeck": make_thicker_neck,
}

for name, fn in shapes.items():
    sk = mesh_obj.shape_key_add(name=name, from_mix=False)
    modified = fn(coords)
    for i, v in enumerate(sk.data):
        v.co.x = modified[i][0]
        v.co.y = modified[i][1]
        v.co.z = modified[i][2]
    print(f"Created shape key: {name}")

print(f"\nTotal shape keys: {len(mesh_obj.data.shape_keys.key_blocks)}")

# ── Export as GLB ────────────────────────────────────────
# Select only the mesh for export
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj

bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format='GLB',
    use_selection=True,
    export_apply=False,
    export_morph=True,
    export_morph_normal=False,
    export_morph_tangent=False,
    export_skins=True,
    export_animations=False,
)

print(f"\nExported to: {DST}")
print("Done!")
