"""
Blender script: Generate a procedural skin texture for the MakeHuman model
and bake it to a UV-mapped image texture.
"""
import bpy, os, math

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_PATH = os.path.join(BASE_DIR, "public", "models", "textures", "skin_diffuse.png")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(BASE_DIR, "public", "models", "male-base.fbx"), use_anim=False)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

mesh_obj = None
max_verts = 0
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and len(obj.data.vertices) > max_verts:
        max_verts = len(obj.data.vertices)
        mesh_obj = obj

if not mesh_obj:
    raise RuntimeError("No mesh")

# Deselect everything, select only our mesh
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj

print(f"Mesh: {mesh_obj.name}")

# Check if mesh has UVs
if not mesh_obj.data.uv_layers:
    print("No UV map found, creating smart UV project...")
    bpy.context.view_layer.objects.active = mesh_obj
    mesh_obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    print("UV map created")
else:
    print(f"UV map exists: {mesh_obj.data.uv_layers[0].name}")

# Create material with procedural skin nodes
mat = bpy.data.materials.new(name="SkinMaterial")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
nodes.clear()

# Output
output = nodes.new('ShaderNodeOutputMaterial')
output.location = (800, 0)

# Principled BSDF
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
bsdf.location = (400, 0)
links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

# Base skin color
base_color = nodes.new('ShaderNodeRGB')
base_color.location = (-400, 200)
base_color.outputs[0].default_value = (0.72, 0.52, 0.40, 1.0)  # warm medium skin

# Noise for subtle skin variation
noise = nodes.new('ShaderNodeTexNoise')
noise.location = (-600, 0)
noise.inputs['Scale'].default_value = 15.0
noise.inputs['Detail'].default_value = 8.0
noise.inputs['Roughness'].default_value = 0.6

# Color ramp for skin variation
ramp = nodes.new('ShaderNodeValToRGB')
ramp.location = (-400, 0)
ramp.color_ramp.elements[0].position = 0.35
ramp.color_ramp.elements[0].color = (0.65, 0.45, 0.35, 1.0)  # slightly darker
ramp.color_ramp.elements[1].position = 0.65
ramp.color_ramp.elements[1].color = (0.78, 0.58, 0.46, 1.0)  # slightly lighter

links.new(noise.outputs['Fac'], ramp.inputs['Fac'])

# Mix base color with noise variation
mix = nodes.new('ShaderNodeMixRGB')
mix.location = (-100, 100)
mix.blend_type = 'MIX'
mix.inputs['Fac'].default_value = 0.3  # subtle variation
links.new(base_color.outputs[0], mix.inputs['Color1'])
links.new(ramp.outputs['Color'], mix.inputs['Color2'])
links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])

# Subsurface
bsdf.inputs['Subsurface Weight'].default_value = 0.15
bsdf.inputs['Subsurface Radius'].default_value = (0.8, 0.4, 0.2)

# Roughness
bsdf.inputs['Roughness'].default_value = 0.55

# Assign material
mesh_obj.data.materials.clear()
mesh_obj.data.materials.append(mat)

# Create image to bake to
img_size = 2048
img = bpy.data.images.new("SkinBake", width=img_size, height=img_size)

# Add image texture node for baking target
img_node = nodes.new('ShaderNodeTexImage')
img_node.location = (-600, -300)
img_node.image = img
img_node.select = True
nodes.active = img_node

# Bake
bpy.context.view_layer.objects.active = mesh_obj
mesh_obj.select_set(True)

bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.samples = 32
bpy.context.scene.cycles.bake_type = 'DIFFUSE'
bpy.context.scene.render.bake.use_pass_direct = False
bpy.context.scene.render.bake.use_pass_indirect = False
bpy.context.scene.render.bake.use_pass_color = True

print("Baking skin texture...")
bpy.ops.object.bake(type='DIFFUSE')

# Save
os.makedirs(os.path.dirname(TEX_PATH), exist_ok=True)
img.filepath_raw = TEX_PATH
img.file_format = 'PNG'
img.save()

print(f"Saved texture to {TEX_PATH}")
print("Done!")
