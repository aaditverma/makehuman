import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath='public/models/male-base.fbx', use_anim=False)
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and len(obj.data.vertices) > 1000:
        print(f"Mesh: {obj.name}, verts: {len(obj.data.vertices)}")
        for mat in obj.data.materials:
            if mat:
                print(f"  Material: {mat.name}")
                if mat.node_tree:
                    for node in mat.node_tree.nodes:
                        print(f"    Node: {node.type} - {node.name}")
                        if node.type == 'TEX_IMAGE' and node.image:
                            print(f"      Image: {node.image.name}")
                            print(f"      Path: {node.image.filepath}")
                            print(f"      Size: {node.image.size[0]}x{node.image.size[1]}")
