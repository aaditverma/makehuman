"""
Blender script: Import MakeHuman FBX, export clean GLB without morph targets.
Usage: blender --background --python scripts/export-clean.py -- male
       blender --background --python scripts/export-clean.py -- female
"""
import bpy
import os
import sys

argv = sys.argv
argv = argv[argv.index("--") + 1:]
variant = argv[0] if argv else "male"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE_DIR, "public", "models", f"{variant}-base.fbx")
DST = os.path.join(BASE_DIR, "public", "models", f"human-{variant}.glb")

print(f"=== Exporting clean {variant} model ===")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC, use_anim=False)

# Find mesh and armature
mesh_obj = None
armature_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and mesh_obj is None:
        mesh_obj = obj
    if obj.type == 'ARMATURE' and armature_obj is None:
        armature_obj = obj

if mesh_obj:
    print(f"Mesh: {mesh_obj.name}, verts: {len(mesh_obj.data.vertices)}")
if armature_obj:
    bones = armature_obj.data.bones
    print(f"Armature: {armature_obj.name}, bones: {len(bones)}")
    for b in bones:
        print(f"  Bone: {b.name}")

# Export everything
bpy.ops.export_scene.gltf(
    filepath=DST, export_format='GLB',
    export_apply=False, export_morph=False,
    export_skins=True, export_animations=False,
)

print(f"Exported: {DST}")
