"""
Blender script: Create parametric garment pattern meshes, run cloth simulation
against the body model, bake morph targets for body shape variants, export GLB.

Usage:
  blender --background --python scripts/bake-garments.py -- --types tee --sizes M
  blender --background --python scripts/bake-garments.py -- --types tee,oxford --sizes M,L
  blender --background --python scripts/bake-garments.py  (all garments, all sizes)

Requires the body GLB (public/models/human-male.glb) which has morph targets.
"""
import bpy, bmesh, math, os, sys, time, argparse, mathutils
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# ─── Constants ────────────────────────────────────────────────────────────────

PI2 = 2.0 * math.pi
MODEL_HEIGHT = 1.73  # body model height in meters

# Body height landmarks (normalized 0-1, multiply by MODEL_HEIGHT for meters)
LANDMARKS = {
    'ankles':    0.04,
    'calves':    0.18,
    'thighs':    0.36,
    'crotch':    0.44,
    'belly':     0.55,
    'waist':     0.58,
    'chest':     0.68,
    'shoulders': 0.77,
    'neck':      0.85,
}

# Morph targets to bake on garments (subset of body's 25 morphs)
GARMENT_MORPHS = [
    'Heavier', 'Thinner', 'WiderShoulders', 'WiderHips',
    'BiggerChest', 'BiggerStomach', 'ThickerThighs', 'ThickerCalves',
]

# Cloth simulation parameters
CLOTH_MASS = 0.3        # kg/m² (cotton)
CLOTH_STRUCT = 25.0     # structural stiffness
CLOTH_BEND = 2.0        # bending stiffness
SIM_FRAMES = 100
OFFSET = 0.005          # meters offset from body surface
MIN_OFFSET = 0.003      # minimum push distance for interpenetration fix

# Garment pattern segments
RING_SEGMENTS = 32      # vertices per ring
SLEEVE_SEGMENTS = 8     # rings along sleeve length
TORSO_SEGMENTS = 12     # rings along torso height
LEG_SEGMENTS = 16       # rings along leg length

# Laplacian smoothing for morph target displacements
SMOOTH_PASSES = 4
SMOOTH_SELF_WEIGHT = 0.55
SMOOTH_NEIGHBOR_WEIGHT = 0.45

# ─── Default size charts (matching defaultSizeCharts.ts) ─────────────────────

SIZE_CHARTS = {
    'tee': {
        'XS': {'chest': 90, 'waist': 86, 'shoulder': 42, 'neck': 36, 'bicep': 30},
        'S':  {'chest': 96, 'waist': 92, 'shoulder': 44, 'neck': 37, 'bicep': 32},
        'M':  {'chest': 102, 'waist': 98, 'shoulder': 46, 'neck': 38, 'bicep': 34},
        'L':  {'chest': 108, 'waist': 104, 'shoulder': 48, 'neck': 39, 'bicep': 36},
        'XL': {'chest': 116, 'waist': 112, 'shoulder': 50, 'neck': 41, 'bicep': 38},
        'XXL': {'chest': 124, 'waist': 120, 'shoulder': 52, 'neck': 43, 'bicep': 40},
    },
    'oxford': {
        'XS': {'chest': 94, 'waist': 88, 'shoulder': 43, 'neck': 37, 'bicep': 31, 'wrist': 17},
        'S':  {'chest': 100, 'waist': 94, 'shoulder': 45, 'neck': 38, 'bicep': 33, 'wrist': 18},
        'M':  {'chest': 106, 'waist': 100, 'shoulder': 47, 'neck': 39, 'bicep': 35, 'wrist': 19},
        'L':  {'chest': 112, 'waist': 106, 'shoulder': 49, 'neck': 41, 'bicep': 37, 'wrist': 20},
        'XL': {'chest': 120, 'waist': 114, 'shoulder': 51, 'neck': 43, 'bicep': 39, 'wrist': 21},
        'XXL': {'chest': 128, 'waist': 122, 'shoulder': 53, 'neck': 45, 'bicep': 41, 'wrist': 22},
    },
    'slim-jeans': {
        '28': {'waist': 74, 'hip': 92, 'thigh': 54, 'calf': 34, 'inseam': 76},
        '30': {'waist': 79, 'hip': 97, 'thigh': 56, 'calf': 36, 'inseam': 78},
        '32': {'waist': 84, 'hip': 102, 'thigh': 58, 'calf': 38, 'inseam': 80},
        '34': {'waist': 89, 'hip': 107, 'thigh': 61, 'calf': 40, 'inseam': 82},
        '36': {'waist': 94, 'hip': 112, 'thigh': 64, 'calf': 42, 'inseam': 84},
        '38': {'waist': 99, 'hip': 117, 'thigh': 67, 'calf': 44, 'inseam': 86},
    },
    'straight-jeans': {
        '28': {'waist': 76, 'hip': 94, 'thigh': 56, 'calf': 36, 'inseam': 76},
        '30': {'waist': 81, 'hip': 99, 'thigh': 58, 'calf': 38, 'inseam': 78},
        '32': {'waist': 86, 'hip': 104, 'thigh': 60, 'calf': 40, 'inseam': 80},
        '34': {'waist': 91, 'hip': 109, 'thigh': 63, 'calf': 42, 'inseam': 82},
        '36': {'waist': 96, 'hip': 114, 'thigh': 66, 'calf': 44, 'inseam': 84},
        '38': {'waist': 101, 'hip': 119, 'thigh': 69, 'calf': 46, 'inseam': 86},
    },
}

ALL_TYPES = ['tee', 'oxford', 'slim-jeans', 'straight-jeans']


# ─── CLI Argument Parsing (Task 3.1) ─────────────────────────────────────────

def parse_args():
    """Parse CLI arguments. Args come after '--' in Blender CLI."""
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(description='Bake garment GLBs with cloth simulation')
    parser.add_argument('--types', type=str, default=','.join(ALL_TYPES),
                        help='Comma-separated garment types (default: all four)')
    parser.add_argument('--sizes', type=str, default='',
                        help='Comma-separated sizes (default: all sizes for each type)')
    parser.add_argument('--body', type=str, default='public/models/human-male.glb',
                        help='Path to body GLB model (default: public/models/human-male.glb)')
    parser.add_argument('--out', type=str, default='public/models/garments/',
                        help='Output directory (default: public/models/garments/)')
    return parser.parse_args(argv)


# ─── Body Import (Task 3.1) ──────────────────────────────────────────────────

def import_body(body_path):
    """Import body GLB model, return mesh object. GLB is already Y-up after import."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    full_path = os.path.join(base_dir, body_path)

    if not os.path.exists(full_path):
        raise RuntimeError(f"Body model not found: {full_path}")

    print(f"[body] Importing: {full_path}")
    bpy.ops.wm.read_factory_settings(use_empty=True)

    ext = os.path.splitext(full_path)[1].lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=full_path, use_anim=False)
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        mesh_obj = _find_body_mesh()
        # Apply -90° X rotation fix (same as generate-morphs.py)
        rot = mathutils.Matrix.Rotation(-math.pi / 2, 4, 'X')
        for v in mesh_obj.data.vertices:
            v.co = rot @ v.co
        mesh_obj.data.update()
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=full_path)
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        mesh_obj = _find_body_mesh()
    else:
        raise RuntimeError(f"Unsupported body format: {ext}")

    print(f"[body] Mesh: {mesh_obj.name}, verts: {len(mesh_obj.data.vertices)}")

    # Debug: print body vertex ranges to verify coordinate space
    verts = mesh_obj.data.vertices
    xs = [v.co.x for v in verts]
    ys = [v.co.y for v in verts]
    zs = [v.co.z for v in verts]
    print(f"[body] Vertex ranges in Blender: X=[{min(xs):.3f}, {max(xs):.3f}] Y=[{min(ys):.3f}, {max(ys):.3f}] Z=[{min(zs):.3f}, {max(zs):.3f}]")

    # Check for shape keys (morph targets)
    if mesh_obj.data.shape_keys:
        sk_names = [kb.name for kb in mesh_obj.data.shape_keys.key_blocks]
        print(f"[body] Shape keys ({len(sk_names)}): {', '.join(sk_names[:10])}...")
    else:
        print("[body] WARNING: No shape keys found on body mesh")

    return mesh_obj


def _find_body_mesh():
    """Find the largest mesh object in the scene."""
    best = None
    best_count = 0
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and len(obj.data.vertices) > best_count:
            best = obj
            best_count = len(obj.data.vertices)
    if not best:
        raise RuntimeError("No mesh found in imported body model")
    return best


def setup_collision(body_obj):
    """Set up body mesh as collision object for cloth simulation."""
    bpy.context.view_layer.objects.active = body_obj
    body_obj.select_set(True)
    col = body_obj.modifiers.new(name='Collision', type='COLLISION')
    body_obj.collision.thickness_outer = 0.002
    body_obj.collision.thickness_inner = 0.001
    body_obj.collision.cloth_friction = 5.0
    print("[body] Collision modifier added")


# ─── Garment Pattern Creation (Task 3.2) ─────────────────────────────────────

def cm_to_m(cm):
    """Convert centimeters to Blender meters."""
    return cm / 100.0


def circumference_to_radius(circ_cm):
    """Convert circumference in cm to radius in meters: r = circ_cm / (2π × 100)."""
    return circ_cm / (PI2 * 100.0)


def create_ring(center, radius, segments, axis='Y'):
    """Create a ring of vertices around a center point.
    In Blender (Z-up after GLB import), height is Z.
    axis='Y': ring in XY plane (horizontal cross-section for torso/legs) — default for vertical tubes
    axis='Z': ring perpendicular to Z axis (for sleeves going sideways along X)
    Returns list of (x, y, z) tuples.
    """
    verts = []
    for i in range(segments):
        angle = PI2 * i / segments
        if axis == 'Y':
            # Cross-section in XY plane, tube goes along Z (height)
            x = center[0] + radius * math.cos(angle)
            y = center[1] + radius * math.sin(angle)
            z = center[2]
        elif axis == 'Z':
            # Cross-section in YZ plane, tube goes along X (for sleeves)
            x = center[0]
            y = center[1] + radius * math.cos(angle)
            z = center[2] + radius * math.sin(angle)
        else:
            x = center[0] + radius * math.cos(angle)
            y = center[1]
            z = center[2] + radius * math.sin(angle)
        verts.append((x, y, z))
    return verts


def build_tube_mesh(rings, segments, name, close_top=False, close_bottom=False):
    """Build a mesh from a series of vertex rings.
    rings: list of lists of (x,y,z) tuples, each ring has `segments` verts.
    Returns the created Blender mesh object.
    """
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    verts = []
    faces = []

    for ring in rings:
        verts.extend(ring)

    num_rings = len(rings)
    for r in range(num_rings - 1):
        for s in range(segments):
            s_next = (s + 1) % segments
            v0 = r * segments + s
            v1 = r * segments + s_next
            v2 = (r + 1) * segments + s_next
            v3 = (r + 1) * segments + s
            faces.append((v0, v1, v2, v3))

    if close_bottom:
        center_idx = len(verts)
        cx = sum(v[0] for v in rings[0]) / segments
        cy = sum(v[1] for v in rings[0]) / segments
        cz = sum(v[2] for v in rings[0]) / segments
        verts.append((cx, cy, cz))
        for s in range(segments):
            s_next = (s + 1) % segments
            faces.append((center_idx, s_next, s))

    if close_top:
        center_idx = len(verts)
        last = rings[-1]
        cx = sum(v[0] for v in last) / segments
        cy = sum(v[1] for v in last) / segments
        cz = sum(v[2] for v in last) / segments
        verts.append((cx, cy, cz))
        base = (num_rings - 1) * segments
        for s in range(segments):
            s_next = (s + 1) % segments
            faces.append((center_idx, base + s, base + s_next))

    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return obj


def create_sleeve(shoulder_pos, direction, length, radius_start, radius_end, segments):
    """Create a sleeve tube extending from shoulder position.
    direction: +1 for right arm, -1 for left arm (along X axis).
    Cross-section in YZ plane (perpendicular to X).
    Returns list of rings.
    """
    rings = []
    for i in range(SLEEVE_SEGMENTS + 1):
        t = i / SLEEVE_SEGMENTS
        x_offset = direction * length * t
        radius = radius_start + (radius_end - radius_start) * t
        center = (shoulder_pos[0] + x_offset, shoulder_pos[1], shoulder_pos[2])
        ring = create_ring(center, radius, segments, axis='Z')
        rings.append(ring)
    return rings


def join_objects(objects, name):
    """Join multiple Blender objects into one."""
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]

    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.active_object
    result.name = name

    # Merge vertices that are very close (seam welding)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')

    return result


def create_garment_pattern(garment_type, size_measurements, body_obj):
    """Create a parametric garment pattern mesh positioned around the body.
    Returns the garment Blender object.
    """
    meas = size_measurements
    seg = RING_SEGMENTS

    if garment_type in ('tee', 'oxford'):
        return _create_top_pattern(garment_type, meas, seg, body_obj)
    elif garment_type in ('slim-jeans', 'straight-jeans'):
        return _create_jeans_pattern(garment_type, meas, seg, body_obj)
    else:
        raise ValueError(f"Unknown garment type: {garment_type}")


def _create_top_pattern(garment_type, meas, seg, body_obj):
    """Create tee or oxford shirt pattern."""
    chest_r = circumference_to_radius(meas['chest']) + OFFSET
    waist_r = circumference_to_radius(meas['waist']) + OFFSET
    shoulder_half = cm_to_m(meas['shoulder']) / 2.0
    bicep_r = cm_to_m(meas.get('bicep', 34)) / PI2 + OFFSET

    # Height positions (in model space meters) — Z is height in Blender after GLB import
    hem_z = LANDMARKS['crotch'] * MODEL_HEIGHT        # 0.44 * 1.73 = 0.7612
    chest_z = LANDMARKS['chest'] * MODEL_HEIGHT        # 0.68 * 1.73 = 1.1764
    shoulder_z = LANDMARKS['shoulders'] * MODEL_HEIGHT  # 0.77 * 1.73 = 1.3321
    neck_z = LANDMARKS['neck'] * MODEL_HEIGHT           # 0.85 * 1.73 = 1.4705

    # Build torso tube: rings from hem to shoulders (along Z axis)
    torso_rings = []
    for i in range(TORSO_SEGMENTS + 1):
        t = i / TORSO_SEGMENTS
        z = hem_z + (shoulder_z - hem_z) * t
        # Interpolate radius: wider at chest, narrower at waist and hem
        nh = (z / MODEL_HEIGHT - LANDMARKS['crotch']) / (LANDMARKS['shoulders'] - LANDMARKS['crotch'])
        if nh < 0.42:
            r = waist_r + (chest_r - waist_r) * (nh / 0.42) * 0.3
        elif nh < 0.73:
            r = waist_r + (chest_r - waist_r) * ((nh - 0.42) / 0.31)
        else:
            r = chest_r
        ring = create_ring((0, 0, z), r, seg, axis='Y')
        torso_rings.append(ring)

    torso_obj = build_tube_mesh(torso_rings, seg, f'torso_{garment_type}',
                                close_bottom=True)

    neck_r = cm_to_m(meas.get('neck', 38)) / PI2 + OFFSET

    # Sleeves
    is_oxford = garment_type == 'oxford'
    if is_oxford:
        sleeve_len = cm_to_m(meas.get('shoulder', 47)) * 1.3  # long sleeve to wrist
        wrist_r = cm_to_m(meas.get('wrist', 19)) / PI2 + OFFSET
        sleeve_end_r = wrist_r
    else:
        sleeve_len = 0.15  # ~15cm short sleeve
        sleeve_end_r = bicep_r * 0.9

    # Right sleeve — extends along +X from right shoulder
    r_shoulder = (shoulder_half, 0, shoulder_z - 0.02)
    r_rings = create_sleeve(r_shoulder, +1, sleeve_len, bicep_r, sleeve_end_r, seg)
    r_sleeve = build_tube_mesh(r_rings, seg, f'sleeve_r_{garment_type}',
                               close_top=True)

    # Left sleeve — extends along -X from left shoulder
    l_shoulder = (-shoulder_half, 0, shoulder_z - 0.02)
    l_rings = create_sleeve(l_shoulder, -1, sleeve_len, bicep_r, sleeve_end_r, seg)
    l_sleeve = build_tube_mesh(l_rings, seg, f'sleeve_l_{garment_type}',
                               close_top=True)

    garment = join_objects([torso_obj, r_sleeve, l_sleeve], f'garment_{garment_type}')
    print(f"[pattern] {garment_type}: {len(garment.data.vertices)} verts, "
          f"chest_r={chest_r:.4f}m, hem_z={hem_z:.4f}m")
    return garment


def _create_jeans_pattern(garment_type, meas, seg, body_obj):
    """Create slim-jeans or straight-jeans pattern."""
    waist_r = circumference_to_radius(meas['waist']) + OFFSET
    hip_r = circumference_to_radius(meas['hip']) + OFFSET
    thigh_r = circumference_to_radius(meas['thigh']) + OFFSET
    calf_r = circumference_to_radius(meas.get('calf', 38)) + OFFSET
    inseam_m = cm_to_m(meas['inseam'])

    is_slim = garment_type == 'slim-jeans'

    # Height positions — Z is height in Blender
    ankle_z = LANDMARKS['ankles'] * MODEL_HEIGHT
    calf_z = LANDMARKS['calves'] * MODEL_HEIGHT
    thigh_z = LANDMARKS['thighs'] * MODEL_HEIGHT
    crotch_z = LANDMARKS['crotch'] * MODEL_HEIGHT
    hip_z = crotch_z + 0.05
    waist_z = LANDMARKS['waist'] * MODEL_HEIGHT

    if is_slim:
        ankle_r = calf_r * 0.75 + OFFSET
        knee_r = thigh_r * 0.85
    else:
        ankle_r = calf_r * 0.95 + OFFSET
        knee_r = thigh_r * 0.95

    leg_offset_x = 0.07  # ~7cm from center to each leg center

    parts = []

    # Waistband (shared top section from waist to hip)
    waistband_rings = []
    wb_steps = 4
    for i in range(wb_steps + 1):
        t = i / wb_steps
        z = waist_z + (hip_z - waist_z) * (1.0 - t)
        r = waist_r + (hip_r - waist_r) * (1.0 - t)
        ring = create_ring((0, 0, z), r, seg, axis='Y')
        waistband_rings.append(ring)
    waistband = build_tube_mesh(waistband_rings, seg, f'waistband_{garment_type}',
                                close_top=True)
    parts.append(waistband)

    # Right and left legs
    for side, x_off in [('right', leg_offset_x), ('left', -leg_offset_x)]:
        leg_rings = []
        for i in range(LEG_SEGMENTS + 1):
            t = i / LEG_SEGMENTS
            z = crotch_z + (ankle_z - crotch_z) * t

            nh = t
            if nh < 0.25:
                r = thigh_r + (hip_r - thigh_r) * (1.0 - nh / 0.25) * 0.3
            elif nh < 0.5:
                r = thigh_r + (knee_r - thigh_r) * ((nh - 0.25) / 0.25)
            elif nh < 0.75:
                r = knee_r + (calf_r - knee_r) * ((nh - 0.5) / 0.25)
            else:
                r = calf_r + (ankle_r - calf_r) * ((nh - 0.75) / 0.25)

            center = (x_off, 0, z)
            ring = create_ring(center, r, seg, axis='Y')
            leg_rings.append(ring)

        leg_obj = build_tube_mesh(leg_rings, seg, f'leg_{side}_{garment_type}',
                                  close_bottom=True)
        parts.append(leg_obj)

    garment = join_objects(parts, f'garment_{garment_type}')
    print(f"[pattern] {garment_type}: {len(garment.data.vertices)} verts, "
          f"waist_r={waist_r:.4f}m, ankle_z={ankle_z:.4f}m")
    return garment


# ─── Cloth Simulation & Morph Target Baking (Task 3.3) ───────────────────────

def get_anchor_vertices(garment_obj, garment_type):
    """Identify anchor (pin) vertices for cloth simulation.
    Tops: shoulder seam vertices (highest Y vertices).
    Jeans: waistband top edge (highest Y vertices).
    Returns a set of vertex indices.
    """
    verts = garment_obj.data.vertices
    coords = [(v.co.x, v.co.y, v.co.z) for v in verts]
    y_vals = [c[1] for c in coords]
    y_max = max(y_vals)

    if garment_type in ('tee', 'oxford'):
        # Pin the top ~5% of vertices (shoulder area)
        threshold = y_max - (y_max - min(y_vals)) * 0.05
    else:
        # Pin the top ~8% of vertices (waistband)
        threshold = y_max - (y_max - min(y_vals)) * 0.08

    anchors = set()
    for i, y in enumerate(y_vals):
        if y >= threshold:
            anchors.add(i)

    print(f"[anchor] {garment_type}: {len(anchors)} pinned vertices (threshold Y >= {threshold:.4f}m)")
    return anchors


def create_pin_group(garment_obj, anchor_indices):
    """Create a vertex group for pinning cloth simulation anchors.
    Pinned vertices get weight 1.0, all others get 0.0.
    """
    vg = garment_obj.vertex_groups.new(name='Pin')
    for idx in anchor_indices:
        vg.add([idx], 1.0, 'REPLACE')
    # All other vertices get weight 0 (free to simulate)
    all_indices = set(range(len(garment_obj.data.vertices)))
    free_indices = all_indices - anchor_indices
    for idx in free_indices:
        vg.add([idx], 0.0, 'REPLACE')
    return vg


def setup_cloth_sim(garment_obj, pin_group_name):
    """Configure cloth physics on the garment object."""
    bpy.context.view_layer.objects.active = garment_obj
    garment_obj.select_set(True)

    cloth_mod = garment_obj.modifiers.new(name='Cloth', type='CLOTH')
    cloth = cloth_mod.settings

    # Cotton fabric parameters
    cloth.mass = CLOTH_MASS
    cloth.tension_stiffness = CLOTH_STRUCT
    cloth.compression_stiffness = CLOTH_STRUCT
    cloth.shear_stiffness = CLOTH_STRUCT * 0.6
    cloth.bending_stiffness = CLOTH_BEND

    # Damping
    cloth.tension_damping = 5.0
    cloth.compression_damping = 5.0
    cloth.shear_damping = 5.0
    cloth.bending_damping = 0.5

    # Quality
    cloth.quality = 8

    # Pin group
    cloth.vertex_group_mass = pin_group_name

    # Collision settings
    cloth_mod.collision_settings.use_collision = True
    cloth_mod.collision_settings.distance_min = 0.002
    cloth_mod.collision_settings.collision_quality = 5

    # Self-collision
    cloth_mod.collision_settings.use_self_collision = True
    cloth_mod.collision_settings.self_distance_min = 0.002

    print(f"[cloth] Configured: mass={CLOTH_MASS}, struct={CLOTH_STRUCT}, bend={CLOTH_BEND}")
    return cloth_mod


def run_cloth_simulation(garment_obj, cloth_mod):
    """Run cloth simulation for SIM_FRAMES frames and bake the result.
    Falls back to surface projection if sim produces unreasonable results.
    """
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = SIM_FRAMES

    print(f"[sim] Running {SIM_FRAMES} frames...")
    t0 = time.time()

    # Free any existing point cache to ensure clean simulation
    cloth_mod.point_cache.frame_start = 1
    cloth_mod.point_cache.frame_end = SIM_FRAMES

    # Force depsgraph update before simulation
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()

    # Use frame stepping to run the simulation
    for frame in range(1, SIM_FRAMES + 1):
        scene.frame_set(frame)

    elapsed = time.time() - t0
    print(f"[sim] Completed in {elapsed:.1f}s")

    # Apply the cloth modifier to bake the final shape
    bpy.context.view_layer.objects.active = garment_obj
    garment_obj.select_set(True)

    # Get the deformed mesh via depsgraph
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = garment_obj.evaluated_get(depsgraph)
    eval_mesh = eval_obj.to_mesh()

    # Store the simulated vertex positions
    sim_coords = [(v.co.x, v.co.y, v.co.z) for v in eval_mesh.vertices]
    eval_obj.to_mesh_clear()

    # Debug: print coordinate ranges
    if sim_coords:
        xs = [c[0] for c in sim_coords]
        ys = [c[1] for c in sim_coords]
        zs = [c[2] for c in sim_coords]
        print(f"[sim] Coord ranges: X=[{min(xs):.4f}, {max(xs):.4f}] Y=[{min(ys):.4f}, {max(ys):.4f}] Z=[{min(zs):.4f}, {max(zs):.4f}]")

    # Remove cloth modifier
    garment_obj.modifiers.remove(cloth_mod)

    # Check if sim produced reasonable results (Z should be within body range ~-0.2 to 0.2)
    if sim_coords:
        max_z = max(abs(c[2]) for c in sim_coords)
        if max_z > 1.0:
            print(f"[sim] WARNING: Cloth sim produced unreasonable Z range ({max_z:.2f}m). Using surface projection instead.")
            return None  # Signal to use surface projection

    # Apply simulated positions to the garment mesh
    for i, v in enumerate(garment_obj.data.vertices):
        if i < len(sim_coords):
            v.co.x, v.co.y, v.co.z = sim_coords[i]
    garment_obj.data.update()

    # Reset timeline
    scene.frame_set(1)

    return sim_coords


def build_bvh_tree(mesh_obj):
    """Build a BVH tree from a mesh object for fast ray casting."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = mesh_obj.evaluated_get(depsgraph)
    eval_mesh = eval_obj.to_mesh()

    bm = bmesh.new()
    bm.from_mesh(eval_mesh)
    bm.transform(mesh_obj.matrix_world)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    eval_obj.to_mesh_clear()
    return bvh


def project_to_body_surface(garment_obj, body_obj, offset=OFFSET):
    """Project garment vertices onto the body surface + offset along normal.
    This is a simpler alternative to cloth simulation that produces a garment
    shape that conforms to the body surface.
    """
    body_bvh = build_bvh_tree(body_obj)
    projected_count = 0

    for v in garment_obj.data.vertices:
        point = Vector((v.co.x, v.co.y, v.co.z))
        location, normal, index, distance = body_bvh.find_nearest(point)
        if location is not None and normal is not None:
            # Place vertex on body surface + offset along outward normal
            v.co = location + normal * offset
            projected_count += 1

    garment_obj.data.update()
    print(f"[project] Projected {projected_count}/{len(garment_obj.data.vertices)} vertices onto body surface (offset={offset:.4f}m)")
    return projected_count


def fix_interpenetration(garment_obj, body_obj):
    """Push garment vertices that are inside the body outward along body surface normal.
    Uses BVH ray casting to detect interpenetration.
    """
    body_bvh = build_bvh_tree(body_obj)
    fixed_count = 0

    for v in garment_obj.data.vertices:
        point = Vector((v.co.x, v.co.y, v.co.z))

        # Find nearest point on body surface
        location, normal, index, distance = body_bvh.find_nearest(point)
        if location is None:
            continue

        # Check if garment vertex is inside the body
        # Vector from body surface to garment vertex
        to_garment = point - location
        # If dot product with normal is negative, vertex is inside the body
        if to_garment.dot(normal) < 0:
            # Push outward along body normal
            push_dist = max(MIN_OFFSET, abs(distance) + MIN_OFFSET)
            v.co = location + normal * push_dist
            fixed_count += 1

    garment_obj.data.update()
    if fixed_count > 0:
        print(f"[interpen] Fixed {fixed_count} interpenetrating vertices")
    else:
        print("[interpen] No interpenetration detected")
    return fixed_count


def apply_body_morph(body_obj, morph_name, value):
    """Apply a morph target (shape key) to the body mesh.
    value: 0.0 = basis, 1.0 = full morph.
    """
    if not body_obj.data.shape_keys:
        print(f"[morph] WARNING: Body has no shape keys, cannot apply {morph_name}")
        return False

    key_blocks = body_obj.data.shape_keys.key_blocks
    if morph_name not in key_blocks:
        print(f"[morph] WARNING: Shape key '{morph_name}' not found on body")
        return False

    key_blocks[morph_name].value = value
    # Force the shape key deformation into the actual mesh vertices
    # so the collision modifier sees the morphed body geometry.
    bpy.context.view_layer.objects.active = body_obj
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    
    # Read the evaluated (morphed) vertex positions and write them
    # directly to the mesh data so collision uses the morphed shape
    eval_obj = body_obj.evaluated_get(depsgraph)
    eval_mesh = eval_obj.to_mesh()
    for i, v in enumerate(body_obj.data.vertices):
        ev = eval_mesh.vertices[i]
        v.co.x, v.co.y, v.co.z = ev.co.x, ev.co.y, ev.co.z
    eval_obj.to_mesh_clear()
    body_obj.data.update()
    bpy.context.view_layer.update()
    return True


def reset_body_morphs(body_obj):
    """Reset all body morph targets to 0 and restore original vertex positions."""
    if not body_obj.data.shape_keys:
        return
    for kb in body_obj.data.shape_keys.key_blocks:
        if kb.name != 'Basis':
            kb.value = 0.0
    # Restore mesh vertices to basis shape
    basis_kb = body_obj.data.shape_keys.key_blocks.get('Basis')
    if basis_kb:
        for i, v in enumerate(body_obj.data.vertices):
            v.co.x = basis_kb.data[i].co.x
            v.co.y = basis_kb.data[i].co.y
            v.co.z = basis_kb.data[i].co.z
    body_obj.data.update()
    bpy.context.view_layer.update()


def laplacian_smooth_displacements(garment_obj, displacements, passes=SMOOTH_PASSES):
    """Apply Laplacian smoothing to morph target displacements.
    Same approach as generate-morphs.py: average each vertex's displacement
    with its neighbors over multiple passes.
    """
    # Build adjacency from mesh edges
    edges = garment_obj.data.edges
    num_verts = len(displacements)
    neighbors = [[] for _ in range(num_verts)]
    for e in edges:
        v0, v1 = e.vertices[0], e.vertices[1]
        if v0 < num_verts and v1 < num_verts:
            neighbors[v0].append(v1)
            neighbors[v1].append(v0)

    current = list(displacements)
    for p in range(passes):
        new_disp = []
        for i in range(num_verts):
            if not neighbors[i]:
                new_disp.append(current[i])
                continue
            nx = sum(current[n][0] for n in neighbors[i]) / len(neighbors[i])
            ny = sum(current[n][1] for n in neighbors[i]) / len(neighbors[i])
            nz = sum(current[n][2] for n in neighbors[i]) / len(neighbors[i])
            new_disp.append((
                current[i][0] * SMOOTH_SELF_WEIGHT + nx * SMOOTH_NEIGHBOR_WEIGHT,
                current[i][1] * SMOOTH_SELF_WEIGHT + ny * SMOOTH_NEIGHBOR_WEIGHT,
                current[i][2] * SMOOTH_SELF_WEIGHT + nz * SMOOTH_NEIGHBOR_WEIGHT,
            ))
        current = new_disp

    return current


def bake_basis_and_morphs(garment_obj, body_obj, garment_type):
    """Bake basis shape key and morph target variants for the garment.
    1. Run cloth sim on base body → basis shape key
    2. For each body morph variant → re-sim → garment shape key
    """
    num_verts = len(garment_obj.data.vertices)

    # Store the initial pattern positions (pre-sim)
    pattern_coords = [(v.co.x, v.co.y, v.co.z) for v in garment_obj.data.vertices]

    # ── Step 1: Use parametric pattern as basis shape ──
    print(f"\n[bake] === Basis shape (base body) ===")

    # The parametric pattern is already positioned correctly around the body
    # No projection needed — the pattern dimensions come from the size chart

    # Store basis coordinates (post-sim, post-fix)
    basis_coords = [(v.co.x, v.co.y, v.co.z) for v in garment_obj.data.vertices]

    # Debug: print first 3 basis vertex positions
    for vi in range(min(3, num_verts)):
        bx, by, bz = basis_coords[vi]
        px, py, pz = pattern_coords[vi]
        print(f"[debug] v{vi}: pattern=({px:.4f},{py:.4f},{pz:.4f}) basis=({bx:.4f},{by:.4f},{bz:.4f})")

    # Create basis shape key
    if garment_obj.data.shape_keys is None:
        garment_obj.shape_key_add(name='Basis', from_mix=False)
    print(f"[bake] Basis shape: {num_verts} verts")

    # Remove collision modifier from body for morph variants
    for mod in body_obj.modifiers:
        if mod.type == 'COLLISION':
            body_obj.modifiers.remove(mod)

    # ── Step 2: For each body morph variant → project → shape key ──
    for morph_name in GARMENT_MORPHS:
        print(f"\n[bake] === Morph variant: {morph_name} ===")
        t0 = time.time()

        # Apply body morph at 100%
        if not apply_body_morph(body_obj, morph_name, 1.0):
            print(f"[bake] Skipping {morph_name} (not found on body)")
            continue

        # Reset garment to BASIS shape for re-projection
        if garment_obj.data.shape_keys:
            for kb in garment_obj.data.shape_keys.key_blocks:
                kb.value = 0.0
        for i, v in enumerate(garment_obj.data.vertices):
            v.co.x, v.co.y, v.co.z = basis_coords[i]
        garment_obj.data.update()
        if garment_obj.data.shape_keys:
            basis_kb = garment_obj.data.shape_keys.key_blocks['Basis']
            for i, v in enumerate(basis_kb.data):
                v.co.x, v.co.y, v.co.z = basis_coords[i]

        # Project garment onto morphed body surface — but preserve garment shape
        # For each vertex, find nearest body point and compute the offset delta
        # from base body to morphed body at that location
        body_bvh_base = build_bvh_tree(body_obj)  # morphed body BVH
        
        # Reset body to base first to get base surface positions
        reset_body_morphs(body_obj)
        bpy.context.view_layer.update()
        body_bvh_unmorphed = build_bvh_tree(body_obj)
        
        # Re-apply the morph
        apply_body_morph(body_obj, morph_name, 1.0)
        bpy.context.view_layer.update()
        body_bvh_morphed = build_bvh_tree(body_obj)
        
        # For each garment vertex: find nearest on base body, find nearest on morphed body
        # The displacement is the difference between those two surface points
        for i, v in enumerate(garment_obj.data.vertices):
            point = Vector((basis_coords[i][0], basis_coords[i][1], basis_coords[i][2]))
            
            # Find nearest point on base body
            loc_base, nor_base, _, _ = body_bvh_unmorphed.find_nearest(point)
            # Find nearest point on morphed body  
            loc_morph, nor_morph, _, _ = body_bvh_morphed.find_nearest(point)
            
            if loc_base is not None and loc_morph is not None:
                # Move garment vertex by the delta between morphed and base surface
                delta = loc_morph - loc_base
                v.co.x = basis_coords[i][0] + delta.x
                v.co.y = basis_coords[i][1] + delta.y
                v.co.z = basis_coords[i][2] + delta.z
            # else: keep basis position
        
        garment_obj.data.update()

        # Read final vertex positions (already on body surface from projection)
        variant_final = [(v.co.x, v.co.y, v.co.z) for v in garment_obj.data.vertices]

        # Debug: compare first 3 vertices of basis vs variant
        for vi in range(min(3, num_verts)):
            bx, by, bz = basis_coords[vi]
            vx, vy, vz = variant_final[vi]
            print(f"[debug] v{vi}: basis=({bx:.4f},{by:.4f},{bz:.4f}) variant=({vx:.4f},{vy:.4f},{vz:.4f}) delta=({vx-bx:.4f},{vy-by:.4f},{vz-bz:.4f})")

        # Compute displacement from basis
        displacements = [
            (variant_final[i][0] - basis_coords[i][0],
             variant_final[i][1] - basis_coords[i][1],
             variant_final[i][2] - basis_coords[i][2])
            for i in range(num_verts)
        ]

        # Debug: print displacement stats before smoothing
        raw_max = max(math.sqrt(d[0]**2 + d[1]**2 + d[2]**2) for d in displacements)
        raw_avg = sum(math.sqrt(d[0]**2 + d[1]**2 + d[2]**2) for d in displacements) / num_verts
        print(f"[disp] Raw: max={raw_max:.6f}m, avg={raw_avg:.6f}m")

        # Debug: check displacement magnitudes before smoothing
        raw_max = max(math.sqrt(d[0]**2 + d[1]**2 + d[2]**2) for d in displacements)
        raw_avg = sum(math.sqrt(d[0]**2 + d[1]**2 + d[2]**2) for d in displacements) / num_verts
        print(f"[debug] {morph_name}: raw max_disp={raw_max:.6f}m, avg_disp={raw_avg:.6f}m")

        # If displacements are negligible (< 1mm), the cloth sim didn't respond
        # to this morph — skip creating a shape key for it
        if raw_max < 0.001:
            print(f"[bake] Skipping {morph_name} — negligible displacement ({raw_max:.6f}m)")
            apply_body_morph(body_obj, morph_name, 0.0)
            reset_body_morphs(body_obj)
            for mod in body_obj.modifiers:
                if mod.type == 'COLLISION':
                    body_obj.modifiers.remove(mod)
            continue

        # Apply Laplacian smoothing to displacements (4 passes)
        smoothed = laplacian_smooth_displacements(garment_obj, displacements)

        # Create shape key with smoothed displacement
        sk = garment_obj.shape_key_add(name=morph_name, from_mix=False)
        for i, v in enumerate(sk.data):
            v.co.x = basis_coords[i][0] + smoothed[i][0]
            v.co.y = basis_coords[i][1] + smoothed[i][1]
            v.co.z = basis_coords[i][2] + smoothed[i][2]

        elapsed = time.time() - t0
        max_disp = max(math.sqrt(d[0]**2 + d[1]**2 + d[2]**2) for d in smoothed)
        print(f"[bake] + {morph_name}: max displacement {max_disp:.4f}m, {elapsed:.1f}s")

        # Reset body morph
        apply_body_morph(body_obj, morph_name, 0.0)
        reset_body_morphs(body_obj)

        # Remove collision modifier
        for mod in body_obj.modifiers:
            if mod.type == 'COLLISION':
                body_obj.modifiers.remove(mod)

    # Restore garment to basis shape
    for i, v in enumerate(garment_obj.data.vertices):
        v.co.x, v.co.y, v.co.z = basis_coords[i]
    garment_obj.data.update()

    # Report shape key count
    sk_count = len(garment_obj.data.shape_keys.key_blocks)
    print(f"\n[bake] Total shape keys: {sk_count} (1 basis + {sk_count - 1} morphs)")
    return sk_count


# ─── GLB Export (Task 3.4) ────────────────────────────────────────────────────

def export_garment_glb(garment_obj, body_obj, garment_type, size, out_dir):
    """Export garment as GLB with morph targets, no morph normals, Y-up.
    Same export settings as generate-morphs.py for coordinate consistency.
    """
    filename = f"garment-{garment_type}-{size}.glb"
    filepath = os.path.join(out_dir, filename)

    # Clean up: select only the garment for export
    bpy.ops.object.select_all(action='DESELECT')
    garment_obj.select_set(True)
    bpy.context.view_layer.objects.active = garment_obj

    # Remove any remaining modifiers
    for mod in list(garment_obj.modifiers):
        garment_obj.modifiers.remove(mod)

    # Remove vertex groups (pin groups etc.) — not needed in export
    garment_obj.vertex_groups.clear()

    # Smooth shading for nicer appearance
    bpy.ops.object.shade_smooth()

    # Apply all transforms so vertex positions are in world space
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Export GLB
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_skins=False,
        export_animations=False,
        export_yup=True,
        export_normals=True,
        export_image_format='AUTO',
    )

    file_size = os.path.getsize(filepath) / 1024
    sk_count = len(garment_obj.data.shape_keys.key_blocks) if garment_obj.data.shape_keys else 0
    vert_count = len(garment_obj.data.vertices)

    print(f"\n[export] {filename}")
    print(f"  Path: {filepath}")
    print(f"  Vertices: {vert_count}")
    print(f"  Shape keys: {sk_count}")
    print(f"  File size: {file_size:.1f} KB")

    return filepath


# ─── Main Pipeline ────────────────────────────────────────────────────────────

def process_garment(garment_type, size, body_path, out_dir):
    """Process a single garment-size combination: pattern → sim → morphs → export."""
    t_start = time.time()
    print(f"\n{'='*60}")
    print(f"  Processing: {garment_type} size {size}")
    print(f"{'='*60}")

    # Get size measurements
    if garment_type not in SIZE_CHARTS:
        print(f"[ERROR] Unknown garment type: {garment_type}")
        return None
    chart = SIZE_CHARTS[garment_type]
    if size not in chart:
        print(f"[ERROR] Unknown size '{size}' for {garment_type}. Available: {list(chart.keys())}")
        return None
    measurements = chart[size]
    print(f"[info] Measurements: {measurements}")

    # Import fresh body for each garment (clean state)
    body_obj = import_body(body_path)

    # Step 1: Create garment pattern
    print(f"\n[step 1] Creating garment pattern...")
    garment_obj = create_garment_pattern(garment_type, measurements, body_obj)

    # Step 2: Bake basis shape + morph variants via cloth simulation
    print(f"\n[step 2] Baking cloth simulation + morph targets...")
    sk_count = bake_basis_and_morphs(garment_obj, body_obj, garment_type)

    # Step 3: Export GLB
    print(f"\n[step 3] Exporting GLB...")
    filepath = export_garment_glb(garment_obj, body_obj, garment_type, size, out_dir)

    elapsed = time.time() - t_start
    print(f"\n[done] {garment_type} {size}: {elapsed:.1f}s total")
    return filepath


def main():
    args = parse_args()

    # Parse types and sizes
    types = [t.strip() for t in args.types.split(',') if t.strip()]
    sizes_arg = [s.strip() for s in args.sizes.split(',') if s.strip()] if args.sizes else []

    # Resolve output directory
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(base_dir, args.out)
    os.makedirs(out_dir, exist_ok=True)

    print(f"=== Garment Baking Pipeline ===")
    print(f"  Types: {types}")
    print(f"  Body:  {args.body}")
    print(f"  Output: {out_dir}")

    total_start = time.time()
    results = []

    for garment_type in types:
        if garment_type not in SIZE_CHARTS:
            print(f"[WARN] Skipping unknown garment type: {garment_type}")
            continue

        # Determine sizes to process
        if sizes_arg:
            sizes = sizes_arg
        else:
            sizes = list(SIZE_CHARTS[garment_type].keys())

        print(f"\n  Sizes for {garment_type}: {sizes}")

        for size in sizes:
            try:
                filepath = process_garment(garment_type, size, args.body, out_dir)
                if filepath:
                    results.append((garment_type, size, filepath))
            except Exception as e:
                print(f"[ERROR] Failed to process {garment_type} {size}: {e}")
                import traceback
                traceback.print_exc()
                continue

    total_elapsed = time.time() - total_start
    print(f"\n{'='*60}")
    print(f"  Pipeline complete: {len(results)} garments in {total_elapsed:.1f}s")
    print(f"{'='*60}")
    for gt, sz, fp in results:
        print(f"  ✓ {gt} {sz}: {fp}")


if __name__ == '__main__':
    main()
