"""
Blender script: Take the male MakeHuman base, sculpt it into a female base shape,
generate morph targets, and export as GLB.
Run via: blender --background --python scripts/create-female-model.py
"""
import bpy
import math
import os

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "models", "human-morphs.glb")
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "models", "human-morphs-female.glb")

# ── Clean scene ──────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)

# ── Import FBX ───────────────────────────────────────────
bpy.ops.import_scene.gltf(filepath=SRC)

mesh_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        mesh_obj = obj
        break

if mesh_obj is None:
    raise RuntimeError("No mesh found in FBX")

print(f"Found mesh: {mesh_obj.name}, verts: {len(mesh_obj.data.vertices)}")

verts = mesh_obj.data.vertices
coords = [(v.co.x, v.co.y, v.co.z) for v in verts]

# Detect orientation
ys = [c[1] for c in coords]
zs = [c[2] for c in coords]
y_range = max(ys) - min(ys)
z_range = max(zs) - min(zs)

if y_range > z_range:
    UP = 1; FORWARD = 2
else:
    UP = 2; FORWARD = 1
SIDE = 0

height_min = min(c[UP] for c in coords)
height_max = max(c[UP] for c in coords)
height_range = height_max - height_min

def nh(co):
    return (co[UP] - height_min) / max(0.0001, height_range)

def dist(co):
    return math.sqrt(co[SIDE]**2 + co[FORWARD]**2)

# ── Transform base mesh to female proportions ────────────
# Narrower shoulders, wider hips, smaller waist, bust area
female_coords = []
for co in coords:
    h = nh(co)
    d = dist(co)
    new_co = list(co)

    # Narrower shoulders (h ~ 0.7-0.8)
    shoulder = max(0, 1.0 - abs(h - 0.75) * 8.0)
    new_co[SIDE] -= co[SIDE] * shoulder * 0.08

    # Wider hips (h ~ 0.4-0.5)
    hip = max(0, 1.0 - abs(h - 0.43) * 6.0)
    new_co[SIDE] += co[SIDE] * hip * 0.10

    # Narrower waist (h ~ 0.52-0.58)
    waist = max(0, 1.0 - abs(h - 0.55) * 8.0)
    new_co[SIDE] -= co[SIDE] * waist * 0.06
    new_co[FORWARD] -= co[FORWARD] * waist * 0.04

    # Bust area (h ~ 0.62-0.68, forward-facing)
    bust = max(0, 1.0 - abs(h - 0.65) * 10.0)
    fwd_bias = max(0, co[FORWARD]) / max(0.001, abs(co[FORWARD]) + 0.001)
    new_co[FORWARD] += bust * fwd_bias * 0.03 * max(0.05, abs(co[FORWARD]))

    # Slightly shorter overall (scale ~0.96)
    new_co[UP] = height_min + (new_co[UP] - height_min) * 0.96

    female_coords.append(new_co)

# Apply female base shape to mesh
for i, v in enumerate(verts):
    v.co.x = female_coords[i][0]
    v.co.y = female_coords[i][1]
    v.co.z = female_coords[i][2]

print("Applied female base proportions")

# ── Re-read coords after female transform ────────────────
coords = [(v.co.x, v.co.y, v.co.z) for v in verts]
height_min = min(c[UP] for c in coords)
height_max = max(c[UP] for c in coords)
height_range = height_max - height_min

def nh2(co):
    return (co[UP] - height_min) / max(0.0001, height_range)

# ── Create shape keys (same set as male) ─────────────────
if mesh_obj.data.shape_keys is None:
    mesh_obj.shape_key_add(name="Basis", from_mix=False)

def make_shape(name, fn):
    sk = mesh_obj.shape_key_add(name=name, from_mix=False)
    modified = fn(coords)
    for i, v in enumerate(sk.data):
        v.co.x = modified[i][0]
        v.co.y = modified[i][1]
        v.co.z = modified[i][2]
    print(f"Created shape key: {name}")

def heavier(coords):
    result = []
    for co in coords:
        h = nh2(co)
        torso = max(0, 1.0 - abs(h - 0.5) * 3.0)
        factor = torso * 0.7 + 0.3 * 0.3
        d = dist(co)
        expand = factor * 0.15 * max(0.1, d)
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        new_co[FORWARD] += co[FORWARD] * expand * 0.8
        result.append(new_co)
    return result

def thinner(coords):
    result = []
    for co in coords:
        h = nh2(co)
        torso = max(0, 1.0 - abs(h - 0.5) * 3.0)
        factor = torso * 0.7 + 0.25 * 0.3
        d = dist(co)
        contract = factor * 0.12 * max(0.1, d)
        new_co = list(co)
        new_co[SIDE] -= co[SIDE] * contract
        new_co[FORWARD] -= co[FORWARD] * contract * 0.8
        result.append(new_co)
    return result

def muscular(coords):
    result = []
    for co in coords:
        h = nh2(co)
        d = dist(co)
        chest = max(0, 1.0 - abs(h - 0.65) * 5.0)
        arm = max(0, 1.0 - abs(h - 0.58) * 6.0) * min(1, max(0, d - 0.1) * 4)
        thigh = max(0, 1.0 - abs(h - 0.35) * 5.0)
        factor = max(chest * 0.4, arm * 0.35, thigh * 0.3)
        expand = factor * 0.10 * max(0.1, d)
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        new_co[FORWARD] += co[FORWARD] * expand * 0.9
        result.append(new_co)
    return result

def taller(coords):
    result = []
    for co in coords:
        h = nh2(co)
        new_co = list(co)
        new_co[UP] += h * 0.08 * height_range
        result.append(new_co)
    return result

def shorter(coords):
    result = []
    for co in coords:
        h = nh2(co)
        new_co = list(co)
        new_co[UP] -= h * 0.08 * height_range
        result.append(new_co)
    return result

def wider_shoulders(coords):
    result = []
    for co in coords:
        h = nh2(co)
        s = max(0, 1.0 - abs(h - 0.72) * 6.0)
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * s * 0.10
        result.append(new_co)
    return result

def wider_hips(coords):
    result = []
    for co in coords:
        h = nh2(co)
        hip = max(0, 1.0 - abs(h - 0.42) * 6.0)
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * hip * 0.12
        result.append(new_co)
    return result

def bigger_chest(coords):
    result = []
    for co in coords:
        h = nh2(co)
        chest = max(0, 1.0 - abs(h - 0.65) * 6.0)
        d = dist(co)
        fwd = max(0, co[FORWARD]) / max(0.001, abs(co[FORWARD]) + 0.001)
        expand = chest * 0.12 * max(0.1, d)
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand * 0.6
        new_co[FORWARD] += expand * (0.5 + fwd * 0.8) * max(0.05, abs(co[FORWARD]))
        result.append(new_co)
    return result

def bigger_stomach(coords):
    result = []
    for co in coords:
        h = nh2(co)
        belly = max(0, 1.0 - abs(h - 0.48) * 5.0)
        fwd = max(0, co[FORWARD]) / max(0.001, abs(co[FORWARD]) + 0.001)
        expand = belly * 0.12
        new_co = list(co)
        new_co[FORWARD] += expand * (0.5 + fwd * 0.5) * max(0.05, abs(co[FORWARD]))
        new_co[SIDE] += co[SIDE] * expand * 0.3
        result.append(new_co)
    return result

def longer_legs(coords):
    result = []
    for co in coords:
        h = nh2(co)
        if h < 0.5:
            new_co = list(co)
            new_co[UP] -= (0.5 - h) * 0.12 * height_range
            result.append(new_co)
        else:
            result.append(list(co))
    return result

def longer_arms(coords):
    result = []
    for co in coords:
        h = nh2(co)
        d = dist(co)
        arm = max(0, 1.0 - abs(h - 0.55) * 4.0) * min(1, max(0, d - 0.12) * 5)
        new_co = list(co)
        new_co[UP] -= arm * 0.04 * height_range
        result.append(new_co)
    return result

def thicker_neck(coords):
    result = []
    for co in coords:
        h = nh2(co)
        neck = max(0, 1.0 - abs(h - 0.82) * 10.0)
        expand = neck * 0.07
        new_co = list(co)
        new_co[SIDE] += co[SIDE] * expand
        new_co[FORWARD] += co[FORWARD] * expand
        result.append(new_co)
    return result

shapes = {
    "Heavier": heavier, "Thinner": thinner, "Muscular": muscular,
    "Taller": taller, "Shorter": shorter,
    "WiderShoulders": wider_shoulders, "WiderHips": wider_hips,
    "BiggerChest": bigger_chest, "BiggerStomach": bigger_stomach,
    "LongerLegs": longer_legs, "LongerArms": longer_arms, "ThickerNeck": thicker_neck,
}

for name, fn in shapes.items():
    make_shape(name, fn)

print(f"\nTotal shape keys: {len(mesh_obj.data.shape_keys.key_blocks)}")

# ── Export ────────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj

bpy.ops.export_scene.gltf(
    filepath=DST, export_format='GLB', use_selection=True,
    export_apply=False, export_morph=True, export_morph_normal=False,
    export_morph_tangent=False, export_skins=True, export_animations=False,
)

print(f"\nExported to: {DST}")
print("Done!")
