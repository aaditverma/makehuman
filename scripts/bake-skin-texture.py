"""
Generate a skin color texture using vertex painting based on body regions,
then bake to an image using the existing UV map.
"""
import bpy, os, math, mathutils

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_PATH = os.path.join(BASE_DIR, "public", "models", "textures", "skin_diffuse.png")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(BASE_DIR, "public", "models", "male-base.fbx"), use_anim=False)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Fix orientation
rot = mathutils.Matrix.Rotation(-math.pi/2, 4, 'X')
mesh_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and len(obj.data.vertices) > 1000:
        mesh_obj = obj
        for v in obj.data.vertices:
            v.co = rot @ v.co
        obj.data.update()
        break

if not mesh_obj:
    raise RuntimeError("No mesh")

print(f"Mesh: {mesh_obj.name}, verts: {len(mesh_obj.data.vertices)}")

bpy.context.view_layer.objects.active = mesh_obj
mesh_obj.select_set(True)

# Get height range
verts = mesh_obj.data.vertices
h_min = min(v.co.z for v in verts)
h_max = max(v.co.z for v in verts)
h_range = h_max - h_min

def nh(v):
    return (v.co.z - h_min) / max(0.0001, h_range)

# Create vertex color layer
if not mesh_obj.data.color_attributes:
    mesh_obj.data.color_attributes.new(name="SkinColor", type='BYTE_COLOR', domain='CORNER')

color_attr = mesh_obj.data.color_attributes["SkinColor"]

# Base skin color (warm medium tone)
base_r, base_g, base_b = 0.65, 0.48, 0.38

# Paint vertex colors based on body region
for poly in mesh_obj.data.polygons:
    for loop_idx in poly.loop_indices:
        vert_idx = mesh_obj.data.loops[loop_idx].vertex_index
        v = verts[vert_idx]
        h = nh(v)
        d = math.sqrt(v.co.x**2 + v.co.y**2)
        
        r, g, b = base_r, base_g, base_b
        
        # Slightly darker at joints/creases
        # Elbows (h ~0.55, far from center)
        if h > 0.50 and h < 0.60 and d > 0.15:
            r *= 0.92; g *= 0.90; b *= 0.88
        
        # Knees (h ~0.27)
        if h > 0.24 and h < 0.30:
            r *= 0.93; g *= 0.91; b *= 0.89
        
        # Slightly lighter on chest/belly front
        if h > 0.50 and h < 0.70 and v.co.y > 0.05:
            r *= 1.04; g *= 1.02; b *= 1.0
        
        # Slightly pinker on face
        if h > 0.85:
            r *= 1.05; g *= 0.98; b *= 0.95
        
        # Darker on back of neck
        if h > 0.80 and h < 0.88 and v.co.y < -0.02:
            r *= 0.90; g *= 0.87; b *= 0.85
        
        # Slightly darker hands/feet
        if h < 0.04 or (h > 0.38 and h < 0.52 and d > 0.20):
            r *= 0.94; g *= 0.91; b *= 0.88
        
        # Palms lighter (front of hands)
        if h > 0.38 and h < 0.52 and d > 0.22 and v.co.y > 0:
            r *= 1.08; g *= 1.06; b *= 1.04
        
        # Nipple area slightly darker
        if h > 0.64 and h < 0.68 and abs(v.co.x) > 0.06 and abs(v.co.x) < 0.10 and v.co.y > 0.05:
            r *= 0.85; g *= 0.78; b *= 0.75
        
        # Clamp
        r = min(1.0, max(0.0, r))
        g = min(1.0, max(0.0, g))
        b = min(1.0, max(0.0, b))
        
        color_attr.data[loop_idx].color = (r, g, b, 1.0)

print("Vertex colors painted")

# Create material that uses vertex colors
mat = bpy.data.materials.new(name="SkinMat")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
nodes.clear()

output = nodes.new('ShaderNodeOutputMaterial')
output.location = (400, 0)

bsdf = nodes.new('ShaderNodeBsdfPrincipled')
bsdf.location = (0, 0)
bsdf.inputs['Roughness'].default_value = 0.6
links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

# Vertex color node
vcol = nodes.new('ShaderNodeVertexColor')
vcol.location = (-300, 0)
vcol.layer_name = "SkinColor"
links.new(vcol.outputs['Color'], bsdf.inputs['Base Color'])

mesh_obj.data.materials.clear()
mesh_obj.data.materials.append(mat)

# Create bake target image
img = bpy.data.images.new("SkinBake", width=2048, height=2048)

img_node = nodes.new('ShaderNodeTexImage')
img_node.location = (-300, -300)
img_node.image = img
img_node.select = True
nodes.active = img_node

# Bake
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.samples = 16
bpy.context.scene.cycles.bake_type = 'DIFFUSE'
bpy.context.scene.render.bake.use_pass_direct = False
bpy.context.scene.render.bake.use_pass_indirect = False
bpy.context.scene.render.bake.use_pass_color = True

# Deselect everything except our mesh
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj

print("Baking vertex colors to texture...")
bpy.ops.object.bake(type='DIFFUSE')

os.makedirs(os.path.dirname(TEX_PATH), exist_ok=True)
img.filepath_raw = TEX_PATH
img.file_format = 'PNG'
img.save()

print(f"Saved to {TEX_PATH}")
print("Done!")
