# Session Handoff — Body Editor / Clothing Fit Platform

## The Product
A web-based 3D body avatar that users can customize with their measurements, then visualize how clothing fits on their body using heatmaps. Designed to be embedded into shopping websites (Shopify) to reduce returns by showing fit before purchase.

**GitHub:** https://github.com/aaditverma/makehuman
**Stack:** React + Three.js + Vite + TypeScript + Tailwind CSS
**Dev server:** `npm run dev` (requires Node 20.19+ or use Vite 6 for Node 20.11)

---

## Architecture

### 3D Avatar System
- **Model:** MakeHuman male export (FBX) → Blender script generates morph targets → GLB
- **Source FBX:** `public/models/male-base.fbx` (MakeHuman, default male, standing02 pose, default skeleton, with skin texture)
- **Generated GLB:** `public/models/human-male.glb` (214k vertices, 2 subdivision levels, 25 morph targets + skin texture)
- **Blender script:** `scripts/generate-morphs.py` — imports FBX, fixes orientation (-90° X rotation), subdivides, generates morph targets with Laplacian smoothing, exports GLB
- **Blender path:** `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`
- **Run:** `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/generate-morphs.py -- male`

### Key Files
- `src/components/BodyModel.tsx` — Three.js mesh, morph target animation, heatmap vertex coloring
- `src/components/UI/ControlPanel.tsx` — All UI controls (body inputs, garment selection, heatmap toggle, direct morph sliders)
- `src/components/Scene.tsx` — Three.js canvas, lighting, grid
- `src/components/Controls.tsx` — OrbitControls camera
- `src/components/Lighting.tsx` — Studio lighting setup
- `src/stores/bodyStore.ts` — Zustand store (user inputs, morph overrides, heatmap state)
- `src/utils/morphMapper.ts` — Converts user inputs → morph target influences using ANSUR II + NHANES ML model
- `src/utils/heatmapEngine.ts` — Garment coverage detection + fit score calculation
- `src/data/ansur2_model.json` — Gradient boosting lookup table (29k subjects, trilinear interpolation)
- `src/data/bodyProfiles.json` — Body type profiles with measurement offsets and morph response curves

### ML Model
- Trained on ANSUR II (6,068 military) + NHANES 2011-2018 (22,468 general population) + bdims (507)
- Gradient boosting regression (n=300, depth=5)
- Predicts: chest, waist, hip, shoulder, neck, bicep, thigh, calf, wrist, inseam from height/weight/age/gender
- Exported as lookup table with trilinear interpolation (no Python needed at runtime)
- Training script: `scripts/train-body-model.py`

### Morph Targets (25 total)
**Body shape:** Heavier, Thinner, Muscular, Taller, Shorter
**Regional:** WiderShoulders, WiderHips, BiggerChest, BiggerStomach, LongerLegs, LongerArms, ThickerNeck, ThickerUpperArms, ThickerThighs, ThickerCalves, LongerTorso, WiderBack, DeeperChest, NarrowerWaist
**Fat deposits:** BellyPouch, LoveHandles, BackFat, UpperArmSag, DoubleChin, InnerThighFat

### CRITICAL: Forward Direction
- In the GLB, **Z negative = front (belly)**, **Z positive = back**
- In the Blender morph script, after the -90° X rotation: **FORWARD (Y axis) positive = BACK**
- All morph functions check `co[FORWARD] < 0` for front-facing vertices
- The heatmap engine receives `z` as `yPos` parameter — `yPos < 0` = front, `yPos > 0` = back

---

## What's Done

### ✅ 3D Avatar
- MakeHuman male model with skin texture (young_lightskinned_male_diffuse.png)
- 214k vertices (2x subdivision), smooth shading
- 25 morph targets with 6-pass Laplacian smoothing
- Smooth animated transitions between morph states
- Height scaling (Y axis) with width compensation for shorter people
- Skin material: MeshPhysicalMaterial with texture, sheen

### ✅ User Input System
- Height (cm), Weight (kg), Age, Gender (male only currently)
- Body type presets: Slim, Average, Athletic, Curvy, Heavy
- Custom measurements: Bust, Waist, Hip, High Hip, Inseam (with cm/in toggle per field)
- Direct morph slider testing mode (manual override)
- Estimated measurements display panel

### ✅ ML-Driven Body Prediction
- ANSUR II + NHANES gradient boosting model
- Lookup table with trilinear interpolation
- Z-score based morph mapping against population statistics
- Body type modifiers from bodyProfiles.json

### ✅ Heatmap (Phase 1 — ~75% done)
- Garment selection: T-Shirt, Oxford Shirt, Slim Jeans, Straight Jeans
- Size selection per garment
- Fit style: Compression, Slim, Regular, Relaxed, Oversized
- Heatmap overlays on skin texture (vertex colors multiplied with texture)
- Toggle on/off
- Edge fade at garment boundaries
- Jeans coverage works well (full legs, waist to ankles)
- Oxford shirt coverage works well (full torso front+back, long sleeves)

### ✅ 2D Fit Preview (separate page)
- Located at `/fit2d.html`, code in `src/2d-fit/`
- SVG body silhouette with heatmap regions
- Separate from the 3D system

---

## What's Broken / In Progress

### 🔴 T-Shirt Sleeve Cutoff
**THE MAIN ISSUE RIGHT NOW.** The oxford shirt heatmap covers the full torso + back correctly. The t-shirt should look identical but with shorter sleeves. However, any attempt to add a sleeve cutoff (to make sleeves shorter than full-length) breaks the back coverage.

**Root cause:** The sleeve cutoff check uses `distFromCenter` and `xAbs` to detect arm vertices, but back vertices at the lower back have similar values to arm vertices. There's no reliable way to distinguish "arm at elbow height" from "lower back" using just position data.

**Current state:** Sleeve cutoff is REMOVED. The tee currently shows as full-sleeve (identical to oxford). The `sleeveEnd` property exists in the garment data but is not used in the coverage check.

**Possible solutions:**
1. Use vertex normals — arm vertices face outward (high X normal), back vertices face backward (high Z normal)
2. Pre-compute arm vertex indices in Blender and export as a vertex attribute
3. Use a different approach entirely — paint arm regions as vertex groups in Blender

### 🟡 Morph Target Region Issues
- BiggerStomach and BellyPouch now push the FRONT correctly (after forward direction fix)
- WiderBack pushes backward correctly
- Some morphs still have cross-region bleed at boundaries
- Weight slider caps out at extreme weights (morph displacement limit)

### 🟡 Heatmap Accuracy
- Fit calculation only uses 3-5 measurement points per garment
- Garment shape is approximate (height-based bands)
- Need garment construction data for better shapes

---

## Phases

### Phase 1: Heatmap on body surface — ~75% done
- ✅ Garment selection, size, fit style
- ✅ Heatmap colors body where garment covers
- ✅ Overlays on skin texture
- ✅ Toggle on/off
- ✅ Jeans work well
- ✅ Oxford shirt works well
- 🔴 T-shirt sleeve cutoff broken
- ❌ Need more garment types
- ❌ Need better fit calculation with more measurement points

### Phase 2: Generated garment shell from specs — not started
- Generate semi-transparent clothing shape from measurements + fit category
- Garment sits on body as separate mesh
- Heatmap colors the garment shell
- Any brand can plug in their size chart

### Phase 3: Real garment mapping — not started
- Map actual brand garments onto body
- Shopify integration
- 3D clothing meshes or AI-generated overlay

---

## Other TODO Items
- Female model (export from MakeHuman + generate morphs)
- SHAPY/SMPL integration for research-grade accuracy
- Age-based body composition changes
- More NHANES cycles for training data
- Skin texture quality improvements
- Indian population data (deferred)
- Shopify integration

---

## Key Technical Notes

### Regenerating the model
```bash
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/generate-morphs.py -- male
```
This takes the FBX from `public/models/male-base.fbx`, generates morph targets, and exports to `public/models/human-male.glb`.

### Retraining the ML model
```bash
python scripts/train-body-model.py
```
Downloads NHANES data if not present, trains gradient boosting, exports lookup table to `src/data/ansur2_model.json`.

### Body height mapping
The model is 1.73m tall. Normalized height 0 = feet, 1 = head. Key landmarks:
- 0.04: ankles
- 0.18: calves
- 0.36: thighs
- 0.44: crotch/hip
- 0.55: belly/waist
- 0.58: waist
- 0.68: chest
- 0.77: shoulders
- 0.85: neck
- 0.90+: head

### Git LFS
Set up for *.glb, *.fbx, *.png files. The GLB is ~56MB.
