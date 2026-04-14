"""
bake-garment-bindings.py — Compute barycentric binding maps for garment meshes on SMPL.

For each garment mesh, this script:
  1. Loads the SMPL model in neutral pose (zero betas)
  2. Loads the garment mesh (from Blender file, GLB, or OBJ)
  3. For each garment vertex: finds nearest SMPL triangle via BVH,
     computes barycentric coordinates (u, v, w), computes normal offset
  4. Validates: no degenerate triangles (area < 0.0001 m²), all vertices bound
  5. Exports binding map as .binding.bin (matching bindingMapCodec.ts format)
  6. Exports garment mesh as GLB (geometry only, no morph targets)

Binding map binary format (must match bindingMapCodec.ts):
  Header (10 bytes):
    magic:       uint32 — 0x424D4150 ("BMAP")
    version:     uint16 — 1
    vertexCount: uint32
  Per-vertex records (20 bytes each):
    faceIndex:    uint32
    baryU:        float32
    baryV:        float32
    baryW:        float32
    normalOffset: float32

Supported garment types: T-Shirt, Oxford Shirt, Slim Jeans, Straight Jeans

Usage (run via Blender's Python):
  blender --background --python scripts/bake-garment-bindings.py -- \\
    --smpl-bin public/models/smpl/smpl_model.bin \\
    --garment garments/tee-M.blend \\
    --type tee --size M \\
    --out public/models/garments/

  blender --background --python scripts/bake-garment-bindings.py -- \\
    --smpl-bin public/models/smpl/smpl_model.bin \\
    --garment garments/oxford-M.obj \\
    --type oxford --size M \\
    --out public/models/garments/

Blender path (Windows): "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe"

Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
"""

import math
import os
import struct
import sys
import time

# ─── Constants ────────────────────────────────────────────────────────────────

BMAP_MAGIC = 0x424D4150       # "BMAP" in ASCII
BMAP_VERSION = 1
BMAP_HEADER_BYTES = 10
BMAP_ENTRY_BYTES = 20

SMPL_MAGIC = 0x534D504C       # "SMPL" in ASCII
SMPL_HEADER_BYTES = 16

DEGENERATE_AREA_THRESHOLD = 0.0001  # m² — triangles smaller than this are degenerate
BARY_SUM_TOLERANCE = 0.001          # barycentric coords must sum to ~1.0

SUPPORTED_TYPES = ["tee", "oxford", "slim-jeans", "straight-jeans"]
SUPPORTED_EXTENSIONS = [".blend", ".glb", ".gltf", ".obj", ".fbx"]


# ─── CLI Argument Parsing ─────────────────────────────────────────────────────

def parse_args():
    """Parse CLI arguments. Args come after '--' in Blender CLI."""
    import argparse

    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(
        description="Bake garment-to-SMPL barycentric binding maps."
    )
    parser.add_argument(
        "--smpl-bin", required=True,
        help="Path to smpl_model.bin (exported by export-smpl-assets.py)"
    )
    parser.add_argument(
        "--garment", required=True,
        help="Path to garment mesh file (.blend, .glb, .obj, .fbx)"
    )
    parser.add_argument(
        "--type", required=True, choices=SUPPORTED_TYPES,
        help="Garment type: tee, oxford, slim-jeans, straight-jeans"
    )
    parser.add_argument(
        "--size", required=True,
        help="Garment size label (e.g., M, L, 32)"
    )
    parser.add_argument(
        "--out", default="public/models/garments/",
        help="Output directory (default: public/models/garments/)"
    )
    parser.add_argument(
        "--offset-bias", type=float, default=0.0,
        help="Additional normal offset bias in meters (default: 0.0)"
    )
    return parser.parse_args(argv)


# ─── SMPL Model Loading (from binary) ────────────────────────────────────────

def load_smpl_bin(bin_path: str):
    """Load SMPL model from binary file (smpl_model.bin).

    Returns dict with:
      vertices: list of (x, y, z) tuples — template vertices (6890)
      faces: list of (v0, v1, v2) tuples — triangle indices (13776)
      vertex_count: int
      face_count: int
    """
    print(f"[smpl] Loading: {bin_path}")
    if not os.path.exists(bin_path):
        raise RuntimeError(f"SMPL binary not found: {bin_path}")

    with open(bin_path, "rb") as f:
        data = f.read()

    if len(data) < SMPL_HEADER_BYTES:
        raise RuntimeError(f"SMPL binary too small: {len(data)} bytes")

    # Parse header (little-endian)
    magic = struct.unpack_from("<I", data, 0)[0]
    if magic != SMPL_MAGIC:
        raise RuntimeError(
            f"Invalid SMPL magic: expected 0x{SMPL_MAGIC:08X}, got 0x{magic:08X}"
        )

    version = struct.unpack_from("<H", data, 4)[0]
    vertex_count = struct.unpack_from("<H", data, 6)[0]
    face_count = struct.unpack_from("<H", data, 8)[0]
    shape_count = struct.unpack_from("<H", data, 10)[0]
    landmark_count = struct.unpack_from("<H", data, 12)[0]

    print(f"  Version: {version}, Vertices: {vertex_count}, Faces: {face_count}")
    print(f"  Shapes: {shape_count}, Landmarks: {landmark_count}")

    offset = SMPL_HEADER_BYTES

    # Template vertices: Float32[vertex_count × 3]
    template_bytes = vertex_count * 3 * 4
    vertices = []
    for i in range(vertex_count):
        x = struct.unpack_from("<f", data, offset + i * 12)[0]
        y = struct.unpack_from("<f", data, offset + i * 12 + 4)[0]
        z = struct.unpack_from("<f", data, offset + i * 12 + 8)[0]
        vertices.append((x, y, z))
    offset += template_bytes

    # Skip shape blend shapes: Float32[shape_count × vertex_count × 3]
    offset += shape_count * vertex_count * 3 * 4

    # Face indices: Uint16[face_count × 3]
    faces = []
    for i in range(face_count):
        v0 = struct.unpack_from("<H", data, offset + i * 6)[0]
        v1 = struct.unpack_from("<H", data, offset + i * 6 + 2)[0]
        v2 = struct.unpack_from("<H", data, offset + i * 6 + 4)[0]
        faces.append((v0, v1, v2))

    print(f"  Loaded {len(vertices)} vertices, {len(faces)} faces")

    # Compute vertex ranges
    xs = [v[0] for v in vertices]
    ys = [v[1] for v in vertices]
    zs = [v[2] for v in vertices]
    print(f"  Vertex ranges: X=[{min(xs):.3f}, {max(xs):.3f}] "
          f"Y=[{min(ys):.3f}, {max(ys):.3f}] Z=[{min(zs):.3f}, {max(zs):.3f}]")

    return {
        "vertices": vertices,
        "faces": faces,
        "vertex_count": vertex_count,
        "face_count": face_count,
    }


# ─── Garment Mesh Loading (via Blender) ──────────────────────────────────────

def load_garment_mesh(garment_path: str):
    """Load garment mesh into Blender and return the mesh object.

    Supports .blend, .glb, .gltf, .obj, .fbx formats.
    """
    import bpy

    print(f"[garment] Loading: {garment_path}")
    if not os.path.exists(garment_path):
        raise RuntimeError(f"Garment file not found: {garment_path}")

    ext = os.path.splitext(garment_path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise RuntimeError(f"Unsupported garment format: {ext}")

    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import based on format
    if ext == ".blend":
        # Append all objects from the blend file
        with bpy.data.libraries.load(garment_path) as (data_from, data_to):
            data_to.objects = data_from.objects
        for obj in data_to.objects:
            if obj is not None:
                bpy.context.collection.objects.link(obj)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=garment_path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=garment_path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=garment_path, use_anim=False)

    # Apply transforms
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Find the largest mesh object
    mesh_obj = None
    best_count = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and len(obj.data.vertices) > best_count:
            mesh_obj = obj
            best_count = len(obj.data.vertices)

    if not mesh_obj:
        raise RuntimeError("No mesh found in garment file")

    verts = mesh_obj.data.vertices
    print(f"  Mesh: {mesh_obj.name}, {len(verts)} vertices, "
          f"{len(mesh_obj.data.polygons)} faces")

    # Print vertex ranges
    xs = [v.co.x for v in verts]
    ys = [v.co.y for v in verts]
    zs = [v.co.z for v in verts]
    print(f"  Vertex ranges: X=[{min(xs):.3f}, {max(xs):.3f}] "
          f"Y=[{min(ys):.3f}, {max(ys):.3f}] Z=[{min(zs):.3f}, {max(zs):.3f}]")

    return mesh_obj


# ─── SMPL Body Mesh in Blender ────────────────────────────────────────────────

def create_smpl_blender_mesh(smpl_data: dict):
    """Create a Blender mesh object from SMPL template vertices and faces.

    This is used for BVH-based nearest-triangle queries.
    """
    import bpy

    vertices = smpl_data["vertices"]
    faces = smpl_data["faces"]

    mesh = bpy.data.meshes.new("SMPL_Body")
    obj = bpy.data.objects.new("SMPL_Body", mesh)
    bpy.context.collection.objects.link(obj)

    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.calc_normals()

    print(f"[smpl] Created Blender mesh: {len(vertices)} verts, {len(faces)} faces")
    return obj


# ─── Vector Math Utilities ────────────────────────────────────────────────────

def vec_sub(a, b):
    """Subtract two 3D vectors: a - b."""
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vec_add(a, b):
    """Add two 3D vectors: a + b."""
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vec_scale(a, s):
    """Scale a 3D vector: a * s."""
    return (a[0] * s, a[1] * s, a[2] * s)


def vec_dot(a, b):
    """Dot product of two 3D vectors."""
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vec_cross(a, b):
    """Cross product of two 3D vectors."""
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def vec_length(a):
    """Length of a 3D vector."""
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def vec_normalize(a):
    """Normalize a 3D vector. Returns zero vector if length is ~0."""
    length = vec_length(a)
    if length < 1e-12:
        return (0.0, 0.0, 0.0)
    return (a[0] / length, a[1] / length, a[2] / length)


def triangle_area(v0, v1, v2):
    """Compute area of a triangle from its three vertices."""
    e1 = vec_sub(v1, v0)
    e2 = vec_sub(v2, v0)
    cross = vec_cross(e1, e2)
    return 0.5 * vec_length(cross)


def triangle_normal(v0, v1, v2):
    """Compute unit normal of a triangle."""
    e1 = vec_sub(v1, v0)
    e2 = vec_sub(v2, v0)
    cross = vec_cross(e1, e2)
    return vec_normalize(cross)


def compute_barycentric(point, v0, v1, v2):
    """Compute barycentric coordinates (u, v, w) of a point projected onto a triangle.

    Uses the method from "Real-Time Collision Detection" by Christer Ericson.
    The point is first projected onto the triangle plane, then barycentric
    coordinates are computed.

    Returns (u, v, w) where point ≈ u*v0 + v*v1 + w*v2.
    """
    e0 = vec_sub(v1, v0)
    e1 = vec_sub(v2, v0)
    e2 = vec_sub(point, v0)

    d00 = vec_dot(e0, e0)
    d01 = vec_dot(e0, e1)
    d11 = vec_dot(e1, e1)
    d20 = vec_dot(e2, e0)
    d21 = vec_dot(e2, e1)

    denom = d00 * d11 - d01 * d01
    if abs(denom) < 1e-12:
        # Degenerate triangle — return equal weights
        return (1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0)

    v_coord = (d11 * d20 - d01 * d21) / denom
    w_coord = (d00 * d21 - d01 * d20) / denom
    u_coord = 1.0 - v_coord - w_coord

    return (u_coord, v_coord, w_coord)


def point_to_triangle_distance(point, v0, v1, v2):
    """Compute the closest point on a triangle to a given point.

    Returns (closest_point, distance).
    """
    # Project point onto triangle plane
    normal = vec_cross(vec_sub(v1, v0), vec_sub(v2, v0))
    n_len = vec_length(normal)
    if n_len < 1e-12:
        # Degenerate triangle
        return v0, vec_length(vec_sub(point, v0))

    normal = vec_scale(normal, 1.0 / n_len)
    d = vec_dot(vec_sub(point, v0), normal)
    projected = vec_sub(point, vec_scale(normal, d))

    # Compute barycentric coords of projected point
    u, v, w = compute_barycentric(projected, v0, v1, v2)

    # Clamp to triangle
    u = max(0.0, u)
    v = max(0.0, v)
    w = max(0.0, w)
    total = u + v + w
    if total > 0:
        u /= total
        v /= total
        w /= total

    closest = vec_add(vec_add(vec_scale(v0, u), vec_scale(v1, v)), vec_scale(v2, w))
    dist = vec_length(vec_sub(point, closest))
    return closest, dist


# ─── BVH-Based Nearest Triangle Search ───────────────────────────────────────

def compute_binding_map_bvh(garment_obj, smpl_body_obj, smpl_data: dict, offset_bias: float = 0.0):
    """Compute binding map using Blender's BVH tree for fast nearest-triangle queries.

    For each garment vertex:
      1. Find nearest SMPL triangle via BVH
      2. Compute barycentric coordinates on that triangle
      3. Compute normal offset (signed distance along interpolated normal)

    Returns list of binding entries and validation results.
    """
    import bmesh
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    smpl_verts = smpl_data["vertices"]
    smpl_faces = smpl_data["faces"]

    # Build BVH from SMPL body mesh
    print("[bind] Building BVH tree from SMPL body...")
    bm = bmesh.new()
    bm.from_mesh(smpl_body_obj.data)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()

    garment_verts = garment_obj.data.vertices
    num_garment_verts = len(garment_verts)
    print(f"[bind] Processing {num_garment_verts} garment vertices...")

    entries = []
    degenerate_count = 0
    unbound_count = 0
    t0 = time.time()

    # Precompute per-face normals for the SMPL mesh
    face_normals = []
    for fi, (i0, i1, i2) in enumerate(smpl_faces):
        v0 = smpl_verts[i0]
        v1 = smpl_verts[i1]
        v2 = smpl_verts[i2]
        face_normals.append(triangle_normal(v0, v1, v2))

    for gi in range(num_garment_verts):
        gv = garment_verts[gi]
        point = Vector((gv.co.x, gv.co.y, gv.co.z))

        # Find nearest point on SMPL body surface
        location, normal, face_index, distance = bvh.find_nearest(point)

        if location is None or face_index is None:
            # Unbound vertex — should not happen with valid meshes
            unbound_count += 1
            entries.append({
                "faceIndex": 0,
                "baryU": 1.0 / 3.0,
                "baryV": 1.0 / 3.0,
                "baryW": 1.0 / 3.0,
                "normalOffset": 0.005,
            })
            continue

        # Get the triangle vertices
        i0, i1, i2 = smpl_faces[face_index]
        v0 = smpl_verts[i0]
        v1 = smpl_verts[i1]
        v2 = smpl_verts[i2]

        # Check for degenerate triangle
        area = triangle_area(v0, v1, v2)
        if area < DEGENERATE_AREA_THRESHOLD:
            degenerate_count += 1

        # Compute barycentric coordinates
        gp = (gv.co.x, gv.co.y, gv.co.z)
        u, v, w = compute_barycentric(gp, v0, v1, v2)

        # Compute the interpolated surface point using barycentric coords
        surface_point = vec_add(
            vec_add(vec_scale(v0, u), vec_scale(v1, v)),
            vec_scale(v2, w)
        )

        # Compute interpolated normal at the surface point
        # Use the face normal (vertex normals would require precomputation)
        face_normal = face_normals[face_index]

        # Normal offset = signed distance from surface along normal
        to_garment = vec_sub(gp, surface_point)
        normal_offset = vec_dot(to_garment, face_normal)

        # Add offset bias (e.g., to ensure garment sits slightly above body)
        normal_offset += offset_bias

        # Ensure positive offset (garment should be outside body)
        if normal_offset < 0.001:
            normal_offset = 0.003  # minimum 3mm offset

        entries.append({
            "faceIndex": face_index,
            "baryU": u,
            "baryV": v,
            "baryW": w,
            "normalOffset": normal_offset,
        })

        if (gi + 1) % 1000 == 0:
            elapsed = time.time() - t0
            print(f"  {gi + 1}/{num_garment_verts} vertices ({elapsed:.1f}s)")

    elapsed = time.time() - t0
    print(f"[bind] Completed in {elapsed:.1f}s")
    print(f"  Degenerate triangles: {degenerate_count}")
    print(f"  Unbound vertices: {unbound_count}")

    return entries, degenerate_count, unbound_count


# ─── Validation ───────────────────────────────────────────────────────────────

def validate_binding_map(entries: list, smpl_data: dict):
    """Validate binding map entries.

    Checks:
      - All vertices are bound (faceIndex within range)
      - Barycentric coordinates sum to ~1.0 and are non-negative
      - No degenerate triangles (area < threshold)
      - Normal offsets are finite and positive
    """
    smpl_faces = smpl_data["faces"]
    smpl_verts = smpl_data["vertices"]
    num_faces = len(smpl_faces)

    errors = []
    warnings = []

    for i, entry in enumerate(entries):
        fi = entry["faceIndex"]
        u = entry["baryU"]
        v = entry["baryV"]
        w = entry["baryW"]
        offset = entry["normalOffset"]

        # Face index in range
        if fi < 0 or fi >= num_faces:
            errors.append(f"Vertex {i}: faceIndex {fi} out of range [0, {num_faces})")

        # Barycentric sum
        bary_sum = u + v + w
        if abs(bary_sum - 1.0) > BARY_SUM_TOLERANCE:
            warnings.append(f"Vertex {i}: bary sum {bary_sum:.6f} (expected ~1.0)")

        # Non-negative barycentric
        if u < -0.01 or v < -0.01 or w < -0.01:
            warnings.append(f"Vertex {i}: negative bary coords ({u:.4f}, {v:.4f}, {w:.4f})")

        # Finite offset
        if not math.isfinite(offset):
            errors.append(f"Vertex {i}: non-finite normalOffset {offset}")

        # Degenerate triangle check
        if 0 <= fi < num_faces:
            i0, i1, i2 = smpl_faces[fi]
            area = triangle_area(smpl_verts[i0], smpl_verts[i1], smpl_verts[i2])
            if area < DEGENERATE_AREA_THRESHOLD:
                warnings.append(
                    f"Vertex {i}: bound to degenerate triangle {fi} (area={area:.8f} m²)"
                )

    if errors:
        print(f"[validate] ERRORS ({len(errors)}):")
        for e in errors[:10]:
            print(f"  ✗ {e}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more")

    if warnings:
        print(f"[validate] WARNINGS ({len(warnings)}):")
        for w in warnings[:10]:
            print(f"  ⚠ {w}")
        if len(warnings) > 10:
            print(f"  ... and {len(warnings) - 10} more")

    if not errors and not warnings:
        print("[validate] ✓ All binding entries valid")

    return len(errors) == 0


# ─── Binary Export: .binding.bin ──────────────────────────────────────────────

def export_binding_bin(entries: list, out_path: str):
    """Export binding map as binary file matching bindingMapCodec.ts format.

    Layout:
      Header (10 bytes):
        magic:       uint32 — 0x424D4150 ("BMAP")
        version:     uint16 — 1
        vertexCount: uint32
      Per-vertex (20 bytes):
        faceIndex:    uint32
        baryU:        float32
        baryV:        float32
        baryW:        float32
        normalOffset: float32
    """
    vertex_count = len(entries)
    total_bytes = BMAP_HEADER_BYTES + vertex_count * BMAP_ENTRY_BYTES

    print(f"[export] Writing binding map → {out_path}")
    print(f"  Vertices: {vertex_count}, Size: {total_bytes:,} bytes")

    with open(out_path, "wb") as f:
        # Header
        f.write(struct.pack("<I", BMAP_MAGIC))          # magic uint32
        f.write(struct.pack("<H", BMAP_VERSION))         # version uint16
        f.write(struct.pack("<I", vertex_count))         # vertexCount uint32

        # Per-vertex records
        for entry in entries:
            f.write(struct.pack("<I", entry["faceIndex"]))
            f.write(struct.pack("<f", entry["baryU"]))
            f.write(struct.pack("<f", entry["baryV"]))
            f.write(struct.pack("<f", entry["baryW"]))
            f.write(struct.pack("<f", entry["normalOffset"]))

    file_size = os.path.getsize(out_path)
    print(f"  Written: {out_path} ({file_size:,} bytes)")
    return out_path


# ─── GLB Export ───────────────────────────────────────────────────────────────

def export_garment_glb(garment_obj, out_path: str):
    """Export garment mesh as GLB (geometry only, no morph targets).

    The GLB contains:
      - Single mesh with garment geometry
      - No morph targets (deformation handled by binding map at runtime)
      - No skeleton
      - UVs preserved if present
      - Smooth shading
    """
    import bpy

    print(f"[export] Writing garment GLB → {out_path}")

    # Prepare for export
    bpy.ops.object.select_all(action="DESELECT")
    garment_obj.select_set(True)
    bpy.context.view_layer.objects.active = garment_obj

    # Remove any modifiers
    for mod in list(garment_obj.modifiers):
        garment_obj.modifiers.remove(mod)

    # Remove shape keys if any (we don't want morph targets in the GLB)
    if garment_obj.data.shape_keys:
        garment_obj.shape_key_clear()

    # Smooth shading
    bpy.ops.object.shade_smooth()

    # Apply transforms
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Export GLB
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_morph=False,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_skins=False,
        export_animations=False,
        export_yup=True,
        export_normals=True,
        export_image_format="AUTO",
    )

    file_size = os.path.getsize(out_path)
    vert_count = len(garment_obj.data.vertices)
    face_count = len(garment_obj.data.polygons)
    print(f"  Vertices: {vert_count}, Faces: {face_count}")
    print(f"  Written: {out_path} ({file_size:,} bytes, {file_size / 1024:.1f} KB)")
    return out_path


# ─── Main Pipeline ────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(base_dir, args.out)
    os.makedirs(out_dir, exist_ok=True)

    smpl_bin_path = os.path.join(base_dir, args.smpl_bin)
    garment_path = os.path.join(base_dir, args.garment)

    garment_type = args.type
    size = args.size

    print("=" * 60)
    print("  Garment Binding Bake Pipeline")
    print("=" * 60)
    print(f"  SMPL model:    {smpl_bin_path}")
    print(f"  Garment:       {garment_path}")
    print(f"  Type:          {garment_type}")
    print(f"  Size:          {size}")
    print(f"  Output dir:    {out_dir}")
    print(f"  Offset bias:   {args.offset_bias:.4f}m")

    t_start = time.time()

    # 1. Load SMPL model from binary
    smpl_data = load_smpl_bin(smpl_bin_path)

    # 2. Load garment mesh into Blender
    garment_obj = load_garment_mesh(garment_path)

    # 3. Create SMPL body mesh in Blender (for BVH queries)
    smpl_body_obj = create_smpl_blender_mesh(smpl_data)

    # 4. Compute binding map
    print(f"\n[step] Computing barycentric binding map...")
    entries, degenerate_count, unbound_count = compute_binding_map_bvh(
        garment_obj, smpl_body_obj, smpl_data, offset_bias=args.offset_bias
    )

    # 5. Validate
    print(f"\n[step] Validating binding map...")
    is_valid = validate_binding_map(entries, smpl_data)

    if degenerate_count > 0:
        print(f"WARNING: {degenerate_count} vertices bound to degenerate triangles")
    if unbound_count > 0:
        print(f"WARNING: {unbound_count} vertices could not be bound")

    # 6. Export binding map
    binding_filename = f"{garment_type}-{size}.binding.bin"
    binding_path = os.path.join(out_dir, binding_filename)
    export_binding_bin(entries, binding_path)

    # 7. Export garment GLB
    glb_filename = f"{garment_type}-{size}.glb"
    glb_path = os.path.join(out_dir, glb_filename)
    export_garment_glb(garment_obj, glb_path)

    # Summary
    elapsed = time.time() - t_start
    print(f"\n{'=' * 60}")
    print(f"  Binding bake complete ({elapsed:.1f}s)")
    print(f"{'=' * 60}")
    print(f"  Garment vertices: {len(entries)}")
    print(f"  Degenerate triangles: {degenerate_count}")
    print(f"  Unbound vertices: {unbound_count}")
    print(f"  Valid: {'✓' if is_valid else '✗'}")
    print(f"  Binding map: {binding_path}")
    print(f"  Garment GLB:  {glb_path}")

    if not is_valid:
        print("\nWARNING: Binding map has validation errors. Check output above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
