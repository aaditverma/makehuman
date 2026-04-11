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
        
        h_min = min(v.co.z for v in obj.data.vertices)
        h_max = max(v.co.z for v in obj.data.vertices)
        h_range = h_max - h_min
        
        def nh(z):
            return (z - h_min) / h_range
        
        # Find the most forward-protruding vertex at each height
        # This tells us where belly, chest, butt are
        for region, z_lo, z_hi in [
            ("Feet", 0.0, 0.05),
            ("Calves", 0.15, 0.25),
            ("Knees", 0.25, 0.30),
            ("Thighs", 0.30, 0.42),
            ("Crotch", 0.42, 0.48),
            ("Hips/Butt", 0.48, 0.55),
            ("Belly", 0.52, 0.60),
            ("Waist", 0.56, 0.62),
            ("Lower chest", 0.62, 0.68),
            ("Chest/nipple", 0.65, 0.72),
            ("Upper chest", 0.70, 0.76),
            ("Shoulders", 0.74, 0.80),
            ("Neck", 0.82, 0.88),
            ("Head", 0.88, 1.0),
        ]:
            region_verts = [(v.co.x, v.co.y, v.co.z) for v in obj.data.vertices 
                           if z_lo <= nh(v.co.z) <= z_hi]
            if region_verts:
                max_fwd = max(v[1] for v in region_verts)
                min_fwd = min(v[1] for v in region_verts)
                max_side = max(abs(v[0]) for v in region_verts)
                print(f"  {region:16s} h={z_lo:.2f}-{z_hi:.2f}  fwd={min_fwd:.3f} to {max_fwd:.3f}  width={max_side:.3f}  verts={len(region_verts)}")
