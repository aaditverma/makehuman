import bpy, math, mathutils
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath='public/models/male-base.fbx', use_anim=False)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

rot = mathutils.Matrix.Rotation(-math.pi/2, 4, 'X')
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and len(obj.data.vertices) > 1000:
        for v in obj.data.vertices:
            v.co = rot @ v.co
        obj.data.update()
        verts = obj.data.vertices

        # Head verts to find nose direction
        head_verts = [v.co.y for v in verts if v.co.z > 1.6]
        if head_verts:
            print(f"Head Y: min={min(head_verts):.4f} max={max(head_verts):.4f}")
            if max(head_verts) > abs(min(head_verts)):
                print("FORWARD = positive Y")
            else:
                print("FORWARD = negative Y")

        # Belly center
        belly = [v.co.y for v in verts if 0.80 < v.co.z < 1.0 and abs(v.co.x) < 0.03]
        if belly:
            print(f"Belly Y: min={min(belly):.4f} max={max(belly):.4f}")

        # Butt center
        butt = [v.co.y for v in verts if 0.45 < v.co.z < 0.55 and abs(v.co.x) < 0.03]
        if butt:
            print(f"Butt/hip Y: min={min(butt):.4f} max={max(butt):.4f}")
