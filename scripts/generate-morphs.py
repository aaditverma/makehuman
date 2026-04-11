"""
Blender script: Import MakeHuman FBX (with skeleton + pose),
generate body-shape morph targets with precise region isolation, export as GLB.

Usage: blender --background --python scripts/generate-morphs.py -- male
"""
import bpy, math, os, sys, mathutils

argv = sys.argv
argv = argv[argv.index("--") + 1:]
variant = argv[0] if argv else "male"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE_DIR, "public", "models", f"{variant}-base.fbx")
DST = os.path.join(BASE_DIR, "public", "models", f"human-{variant}.glb")

print(f"=== Generating {variant} model with morph targets ===")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC, use_anim=False)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

mesh_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and len(obj.data.vertices) > 1000:
        mesh_obj = obj
        break

if not mesh_obj:
    raise RuntimeError("No mesh found")

print(f"Mesh: {mesh_obj.name}, verts: {len(mesh_obj.data.vertices)}")

# Fix orientation: -Y up → +Z up
rot = mathutils.Matrix.Rotation(-math.pi/2, 4, 'X')
for v in mesh_obj.data.vertices:
    v.co = rot @ v.co
mesh_obj.data.update()

for obj in bpy.context.scene.objects:
    if obj.type == 'ARMATURE':
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        for bone in obj.data.edit_bones:
            bone.head = rot @ bone.head
            bone.tail = rot @ bone.tail
        bpy.ops.object.mode_set(mode='OBJECT')

# Fix mesh normals and smooth shading
bpy.context.view_layer.objects.active = mesh_obj
mesh_obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()

# Enable smooth normals
try:
    mesh_obj.data.use_auto_smooth = True
    mesh_obj.data.auto_smooth_angle = math.radians(60)
except AttributeError:
    # Blender 4.1+ removed use_auto_smooth, smooth shading is enough
    pass

print("Fixed normals and applied smooth shading")

# Subdivide for smoother surface
print("Subdividing mesh...")
bpy.context.view_layer.objects.active = mesh_obj
mesh_obj.select_set(True)
sub = mesh_obj.modifiers.new(name="Sub", type='SUBSURF')
sub.levels = 2
sub.render_levels = 2
bpy.ops.object.modifier_apply(modifier=sub.name)
bpy.ops.object.shade_smooth()
print(f"  Now {len(mesh_obj.data.vertices)} vertices")

# Keep the existing skin texture material (don't paint vertex colors)
print("  Preserving skin texture material")

verts = mesh_obj.data.vertices
coords = [(v.co.x, v.co.y, v.co.z) for v in verts]

UP = 2; FORWARD = 1; SIDE = 0

h_min = min(c[UP] for c in coords)
h_max = max(c[UP] for c in coords)
h_range = h_max - h_min

# Compute body width at each height to find the torso boundary
# This helps distinguish torso verts from arm verts at the same height
height_bins = {}
for co in coords:
    h = int((co[UP] - h_min) / h_range * 100)
    d = abs(co[SIDE])
    if h not in height_bins:
        height_bins[h] = []
    height_bins[h].append(d)

# For each height bin, find the median X distance (torso width)
torso_width_at_height = {}
for h, dists in height_bins.items():
    dists.sort()
    # The torso boundary is roughly at the 60th percentile of X distances
    idx = int(len(dists) * 0.6)
    torso_width_at_height[h] = dists[idx] if idx < len(dists) else dists[-1]

def nh(co):
    return (co[UP] - h_min) / max(0.0001, h_range)

def dist(co):
    return math.sqrt(co[SIDE]**2 + co[FORWARD]**2)

def is_torso(co):
    """Is this vertex on the torso (not arms)?"""
    h = int(nh(co) * 100)
    tw = torso_width_at_height.get(h, 0.15)
    return abs(co[SIDE]) <= tw * 1.1

def is_arm(co):
    """Is this vertex on an arm (far from center, mid height)?"""
    h = nh(co)
    return h > 0.45 and h < 0.78 and not is_torso(co)

def is_leg(co):
    """Is this vertex on a leg?"""
    h = nh(co)
    return h < 0.48

def is_crotch(co):
    """Is this vertex in the dense crotch/inner thigh zone? Dampen all morphs here."""
    h = nh(co)
    d = dist(co)
    return h > 0.40 and h < 0.52 and d < 0.12

def is_hand(co):
    """Hand vertices: at arm height, very far from body center."""
    h = nh(co)
    d = dist(co)
    # Hands are the furthest points from center at mid-height
    return h > 0.35 and h < 0.55 and d > 0.20

def extremity_dampen(co):
    """Returns dampening factor for hands, feet, head, crotch. 1.0 = no dampen."""
    h = nh(co)
    if h < 0.05 or h > 0.85:
        return 0.1  # head and feet
    if is_hand(co):
        return 0.3  # hands get 30% effect
    if is_crotch(co):
        d = dist(co)
        h_factor = 1.0 - smooth(0.46, 0.03, h)
        d_factor = min(1.0, d / 0.12)
        return max(h_factor, d_factor) * 0.3
    return 1.0

print(f"Height range: {h_min:.3f} to {h_max:.3f} ({h_range:.3f})")

if mesh_obj.data.shape_keys is None:
    mesh_obj.shape_key_add(name="Basis", from_mix=False)

def add_shape(name, fn):
    sk = mesh_obj.shape_key_add(name=name, from_mix=False)
    modified = fn(coords)
    
    # Apply displacement
    for i, v in enumerate(sk.data):
        v.co.x = modified[i][0]
        v.co.y = modified[i][1]
        v.co.z = modified[i][2]
    
    # Smooth the shape key displacement using vertex neighbor averaging
    # This prevents spiky artifacts by blending each vertex's displacement with its neighbors
    basis_coords = coords
    displacements = [(modified[i][0] - basis_coords[i][0],
                      modified[i][1] - basis_coords[i][1],
                      modified[i][2] - basis_coords[i][2]) for i in range(len(coords))]
    
    # Build adjacency from mesh edges
    edges = mesh_obj.data.edges
    neighbors = [[] for _ in range(len(coords))]
    for e in edges:
        neighbors[e.vertices[0]].append(e.vertices[1])
        neighbors[e.vertices[1]].append(e.vertices[0])
    
    # 6 passes of Laplacian smoothing — balanced between smooth and visible
    for _ in range(6):
        new_disp = []
        for i in range(len(displacements)):
            if not neighbors[i]:
                new_disp.append(displacements[i])
                continue
            # Average with neighbors (0.55 self + 0.45 neighbor)
            nx = sum(displacements[n][0] for n in neighbors[i]) / len(neighbors[i])
            ny = sum(displacements[n][1] for n in neighbors[i]) / len(neighbors[i])
            nz = sum(displacements[n][2] for n in neighbors[i]) / len(neighbors[i])
            new_disp.append((
                displacements[i][0] * 0.55 + nx * 0.45,
                displacements[i][1] * 0.55 + ny * 0.45,
                displacements[i][2] * 0.55 + nz * 0.45,
            ))
        displacements = new_disp
    
    # Apply smoothed displacements back
    for i, v in enumerate(sk.data):
        v.co.x = basis_coords[i][0] + displacements[i][0]
        v.co.y = basis_coords[i][1] + displacements[i][1]
        v.co.z = basis_coords[i][2] + displacements[i][2]
    
    print(f"  + {name} (smoothed)")

SCALE = 0.03  # conservative to prevent folding at any influence level

def smooth(center, width, h):
    """Smooth Gaussian-like falloff — no hard edges."""
    return math.exp(-((h - center) ** 2) / (2 * width * width))

# ── Shape generators with corrected height bands ─────────
# Body map (from vertex analysis):
#   Feet:       h 0.00-0.05
#   Calves:     h 0.15-0.25
#   Thighs:     h 0.30-0.42
#   Crotch:     h 0.42-0.48 (dense geometry!)
#   Hips/Butt:  h 0.48-0.55
#   Belly:      h 0.52-0.60
#   Waist:      h 0.56-0.62
#   Chest:      h 0.62-0.72
#   Shoulders:  h 0.74-0.80
#   Neck:       h 0.82-0.88
#   FORWARD = positive Y (nose/belly direction)

def heavier(coords):
    """Clean uniform expansion — every vertex moves outward from center axis."""
    out = []
    for co in coords:
        d = dist(co)
        h = nh(co)
        # Smooth weight from head to toe — more in torso, less at extremities
        w = smooth(0.55, 0.25, h)
        # Dampen hands/wrists (h ~0.50-0.55, far from center, low height for arms)
        # and feet (h < 0.05) and head (h > 0.85)
        if h < 0.05 or h > 0.85:
            w *= 0.1  # barely move head and feet
        w *= extremity_dampen(co)  # reduce in crotch zone
        e = w * SCALE * 5.0  # bigger range for extreme weights
        c = list(co)
        if d > 0.005:
            c[SIDE] += co[SIDE] / d * e * d
            c[FORWARD] += co[FORWARD] / d * e * d * 0.7
        out.append(c)
    return out

def thinner(coords):
    """Clean uniform contraction — every vertex moves inward toward center axis."""
    out = []
    for co in coords:
        d = dist(co)
        h = nh(co)
        w = smooth(0.55, 0.25, h)
        if h < 0.05 or h > 0.85:
            w *= 0.1
        w *= extremity_dampen(co)
        e = w * SCALE * 4.0  # bigger range for extreme thinness
        c = list(co)
        if d > 0.005:
            c[SIDE] -= co[SIDE] / d * e * d
            c[FORWARD] -= co[FORWARD] / d * e * d * 0.7
        out.append(c)
    return out

def muscular(coords):
    out = []
    for co in coords:
        d = dist(co)
        chest = smooth(0.68, 0.06, nh(co)) if is_torso(co) else 0
        thigh = smooth(0.36, 0.06, nh(co)) if is_leg(co) else 0
        factor = max(chest, thigh) * 0.6
        e = factor * SCALE * 2.5
        c = list(co)
        if d > 0.01:
            c[SIDE] += co[SIDE] * e
            c[FORWARD] += co[FORWARD] * e * 0.8
        out.append(c)
    return out

def taller(coords):
    out = []
    for co in coords:
        c = list(co)
        if not is_arm(co):
            c[UP] += nh(co) * SCALE * 2.0 * h_range
        out.append(c)
    return out

def shorter(coords):
    out = []
    for co in coords:
        c = list(co)
        if not is_arm(co):
            c[UP] -= nh(co) * SCALE * 2.0 * h_range
        out.append(c)
    return out

def wider_shoulders(coords):
    out = []
    for co in coords:
        h = nh(co)
        s = smooth(0.77, 0.03, h)  # tight band at shoulder height
        if is_leg(co): s = 0
        c = list(co)
        c[SIDE] += co[SIDE] * s * SCALE * 2.5
        out.append(c)
    return out

def wider_hips(coords):
    """Hips at h=0.48-0.55, smooth falloff, torso only."""
    out = []
    for co in coords:
        h = nh(co)
        hip = smooth(0.51, 0.03, h)  # centered on hip, tight
        if is_arm(co): hip = 0
        if h < 0.42: hip = 0
        hip *= extremity_dampen(co)
        c = list(co)
        c[SIDE] += co[SIDE] * hip * SCALE * 2.5
        out.append(c)
    return out

def bigger_chest(coords):
    """Chest at h=0.65-0.72, torso front only."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        chest = smooth(0.68, 0.04, h)
        if is_arm(co): chest = 0
        e = chest * SCALE * 2.5
        c = list(co)
        if d > 0.01 and chest > 0.01:
            c[SIDE] += co[SIDE] * e * 0.5
            if co[FORWARD] < 0:  # front only
                c[FORWARD] += co[FORWARD] * e * 1.0
        out.append(c)
    return out

def bigger_stomach(coords):
    """Belly at h=0.50-0.60, front-facing torso only, wider coverage."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        belly = smooth(0.55, 0.05, h)  # wider Gaussian, centered lower
        if is_arm(co): belly = 0
        # Don't require is_torso — belly can extend to sides
        e = belly * SCALE * 6.0
        c = list(co)
        if belly > 0.01 and d > 0.01:
            if co[FORWARD] < 0:  # FRONT only
                c[FORWARD] -= e * abs(co[FORWARD]) * 3.5
            c[SIDE] += co[SIDE] * e * 0.4
        out.append(c)
    return out

def longer_legs(coords):
    out = []
    for co in coords:
        h = nh(co)
        c = list(co)
        if is_leg(co) and not is_arm(co) and h < 0.42:
            stretch = smooth(0.25, 0.12, h)
            c[UP] -= stretch * SCALE * 2.0 * h_range
        out.append(c)
    return out

def longer_arms(coords):
    out = []
    for co in coords:
        c = list(co)
        if is_arm(co):
            arm = smooth(0.58, 0.08, nh(co))
            c[UP] -= arm * SCALE * 1.5 * h_range
        out.append(c)
    return out

def thicker_neck(coords):
    """Neck at h=0.83-0.88, very tight, center only."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        neck = smooth(0.855, 0.02, h)
        if d > 0.07 or is_arm(co): neck *= 0.1
        e = neck * SCALE * 2.0
        c = list(co)
        c[SIDE] += co[SIDE] * e
        c[FORWARD] += co[FORWARD] * e
        out.append(c)
    return out

def thicker_upper_arms(coords):
    """Bicep/tricep — arm verts only, h=0.58-0.70."""
    out = []
    for co in coords:
        c = list(co)
        if is_arm(co):
            h = nh(co)
            arm = smooth(0.64, 0.04, h)
            e = arm * SCALE * 2.5
            c[SIDE] += co[SIDE] * e
            c[FORWARD] += co[FORWARD] * e
        out.append(c)
    return out

def thicker_thighs(coords):
    """Upper leg only, h=0.30-0.42."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if h > 0.28 and h < 0.44 and d > 0.01 and not is_arm(co):
            thigh = smooth(0.36, 0.04, h)
            e = thigh * SCALE * 2.5 * extremity_dampen(co)
            c[SIDE] += co[SIDE] * e
            c[FORWARD] += co[FORWARD] * e
        out.append(c)
    return out

def thicker_calves(coords):
    """Lower leg, h=0.10-0.25."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if h > 0.08 and h < 0.27 and d > 0.01:
            calf = smooth(0.18, 0.04, h)
            e = calf * SCALE * 2.0
            c[SIDE] += co[SIDE] * e
            c[FORWARD] += co[FORWARD] * e
        out.append(c)
    return out

def longer_torso(coords):
    """Stretch torso above waist, torso verts only."""
    out = []
    for co in coords:
        h = nh(co)
        c = list(co)
        if h > 0.50 and is_torso(co):
            stretch = smooth(0.65, 0.1, h)
            c[UP] += stretch * SCALE * 1.5 * h_range
        out.append(c)
    return out

def wider_back(coords):
    """Back/lats — BACK-facing torso verts, wider coverage h=0.55-0.75."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        # Back: behind center line, not arms
        if not is_arm(co) and co[FORWARD] > 0.01 and d > 0.01 and h > 0.50 and h < 0.78:
            back = smooth(0.64, 0.06, h)
            e = back * SCALE * 2.5
            c[SIDE] += co[SIDE] * e * 0.8
            c[FORWARD] += abs(co[FORWARD]) * e * 1.5  # push backward
        out.append(c)
    return out

def deeper_chest(coords):
    """Chest depth — FRONT-facing torso verts (FORWARD > 0), h=0.63-0.72."""
    out = []
    for co in coords:
        h = nh(co)
        c = list(co)
        if is_torso(co) and co[FORWARD] < -0.01:
            chest = smooth(0.68, 0.04, h)
            e = chest * SCALE * 2.5
            c[FORWARD] += co[FORWARD] * e * 1.5  # push forward
        out.append(c)
    return out

def narrower_waist(coords):
    """Waist at h=0.56-0.62, torso only, smooth."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if is_torso(co) and d > 0.01:
            waist = smooth(0.59, 0.025, h)
            e = waist * SCALE * 1.8
            c[SIDE] -= co[SIDE] * e
            c[FORWARD] -= co[FORWARD] * e * 0.4
        out.append(c)
    return out

# ── FAT DEPOSIT morphs ──────────────────────────────────

def belly_pouch(coords):
    """Lower belly pouch — hangs forward and slightly down below navel."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if is_torso(co) and co[FORWARD] < -0.01 and d > 0.01:
            pouch = smooth(0.51, 0.035, h)
            e = pouch * SCALE * 6.0
            c[FORWARD] -= abs(co[FORWARD]) * e * 3.5
            c[UP] -= pouch * SCALE * 0.5 * h_range
        out.append(c)
    return out

def love_handles(coords):
    """Side fat at waist level — lateral bulges."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if is_torso(co) and d > 0.01 and abs(co[SIDE]) > 0.05:
            handles = smooth(0.55, 0.03, h)
            side_bias = min(1.0, abs(co[SIDE]) / 0.15)
            e = handles * side_bias * SCALE * 3.0
            c[SIDE] += co[SIDE] * e * 1.4
            c[FORWARD] += co[FORWARD] * e * 0.2
        out.append(c)
    return out

def back_fat(coords):
    """Upper back fat rolls."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if is_torso(co) and co[FORWARD] < -0.01 and d > 0.01:
            lower = smooth(0.56, 0.035, h)
            upper = smooth(0.66, 0.045, h)
            fat = max(lower, upper)
            e = fat * SCALE * 3.0
            c[FORWARD] += abs(co[FORWARD]) * e * 1.4
            c[SIDE] += co[SIDE] * e * 0.3
        out.append(c)
    return out

def upper_arm_sag(coords):
    """Underarm fat/sag."""
    out = []
    for co in coords:
        c = list(co)
        if is_arm(co):
            h = nh(co)
            arm = smooth(0.62, 0.05, h)
            if co[FORWARD] < 0:
                e = arm * SCALE * 2.0
                c[FORWARD] += co[FORWARD] * e * 0.6
                c[UP] -= arm * SCALE * 0.2 * h_range
        out.append(c)
    return out

def double_chin(coords):
    """Fat under chin/jaw area."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if h > 0.78 and h < 0.86 and d < 0.08 and co[FORWARD] < 0:
            chin = smooth(0.82, 0.02, h)
            e = chin * SCALE * 1.5
            c[FORWARD] += co[FORWARD] * e * 1.5
            c[UP] -= chin * SCALE * 0.15 * h_range
        out.append(c)
    return out

def inner_thigh_fat(coords):
    """Fat on inner thighs."""
    out = []
    for co in coords:
        h = nh(co)
        d = dist(co)
        c = list(co)
        if h > 0.28 and h < 0.46 and not is_arm(co) and d > 0.01:
            thigh = smooth(0.37, 0.05, h)
            inner_bias = max(0, 1.0 - abs(co[SIDE]) / 0.15)
            e = thigh * inner_bias * SCALE * 2.0 * extremity_dampen(co)
            c[FORWARD] += co[FORWARD] * e * 0.8
        out.append(c)
    return out

# ── Generate all ─────────────────────────────────────────
print("Creating shape keys:")
for name, fn in [
    ("Heavier", heavier), ("Thinner", thinner), ("Muscular", muscular),
    ("Taller", taller), ("Shorter", shorter),
    ("WiderShoulders", wider_shoulders), ("WiderHips", wider_hips),
    ("BiggerChest", bigger_chest), ("BiggerStomach", bigger_stomach),
    ("LongerLegs", longer_legs), ("LongerArms", longer_arms),
    ("ThickerNeck", thicker_neck),
    ("ThickerUpperArms", thicker_upper_arms),
    ("ThickerThighs", thicker_thighs),
    ("ThickerCalves", thicker_calves),
    ("LongerTorso", longer_torso),
    ("WiderBack", wider_back),
    ("DeeperChest", deeper_chest),
    ("NarrowerWaist", narrower_waist),
    ("BellyPouch", belly_pouch),
    ("LoveHandles", love_handles),
    ("BackFat", back_fat),
    ("UpperArmSag", upper_arm_sag),
    ("DoubleChin", double_chin),
    ("InnerThighFat", inner_thigh_fat),
]:
    add_shape(name, fn)

print(f"Total shape keys: {len(mesh_obj.data.shape_keys.key_blocks)}")

# Clean up for export
for mod in mesh_obj.modifiers:
    mesh_obj.modifiers.remove(mod)
mesh_obj.parent = None

for obj in list(bpy.context.scene.objects):
    if obj.type == 'ARMATURE':
        bpy.data.objects.remove(obj, do_unlink=True)

for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH' and obj != mesh_obj:
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj

bpy.ops.export_scene.gltf(
    filepath=DST, export_format='GLB', use_selection=True,
    export_apply=False, export_morph=True, export_morph_normal=False,
    export_morph_tangent=False, export_skins=False, export_animations=False,
    export_yup=True, export_normals=True, export_image_format='AUTO',
)

print(f"Exported: {DST}")
print("Done!")

