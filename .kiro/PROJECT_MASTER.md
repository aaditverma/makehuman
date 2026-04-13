# Body Editor / Clothing Fit Platform — Project Master

> This is the single source of truth for the project. Read this file at the start of every new session.

## How to Use This File

**Purpose:** This is the cumulative project context doc. A new Kiro session only needs to read THIS file to have full context — no need to read individual handoff files.

**At the START of every session:** Read `.kiro/PROJECT_MASTER.md`

**At the END of every session, update this file with:**
1. **What's Done** — Move completed items, add new completed features
2. **Phases** — Update phase progress percentages and checkmarks
3. **Miscellaneous Fixes & TODO** — Add new pending fixes, remove completed ones
4. **Key Files** — Add any new files created, update descriptions if behavior changed
5. **Coordinate System / Technical Reference** — Update if any technical details changed (thresholds, algorithms, etc.)
6. **Session Handoff Index** — Add new row to the table
7. **Session Timeline** — Add new session entry with bullet points of what was done
8. **Git Workflow** — Commit and push at end of session

**Also create:** `.kiro/SESSION_HANDOFF_XXX.md` (lightweight delta file — only what changed in that session, with serial number and date)

## The Product
A web-based 3D body avatar that users can customize with their measurements, then visualize how clothing fits on their body using heatmaps. Designed to be embedded into shopping websites (Shopify) to reduce returns by showing fit before purchase.

**GitHub:** https://github.com/aaditverma/makehuman
**Stack:** React + Three.js + Vite + TypeScript + Tailwind CSS
**Dev server:** `npm run dev`

---

## Architecture

### 3D Avatar System
- **Model:** MakeHuman male export (FBX) → Blender script generates morph targets → GLB
- **Source FBX:** `public/models/male-base.fbx` (MakeHuman, default male, standing02 pose, default skeleton, with skin texture)
- **Generated GLB:** `public/models/human-male.glb` (214k vertices, 2 subdivision levels, 25 morph targets + skin texture)
- **Blender script:** `scripts/generate-morphs.py` — imports FBX, fixes orientation (-90° X rotation), subdivides, generates morph targets with Laplacian smoothing, exports GLB
- **Blender path:** `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`

### Key Files
- `src/components/BodyModel.tsx` — Three.js mesh, morph target animation, heatmap vertex coloring, reads vertex normals (X and Y) for arm detection, Laplacian color smoothing via smoothingEngine
- `src/components/UI/ControlPanel.tsx` — All UI controls (body inputs, garment selection, heatmap toggle, direct morph sliders)
- `src/components/Scene.tsx` — Three.js canvas, lighting, grid
- `src/components/Controls.tsx` — OrbitControls camera
- `src/components/Lighting.tsx` — Studio lighting setup
- `src/stores/bodyStore.ts` — Zustand store (user inputs, morph overrides, heatmap state)
- `src/utils/morphMapper.ts` — Converts user inputs → morph target influences using ANSUR II + NHANES ML model; `estimatedMeasurements()` returns 12 fields including all ML-predicted measurements
- `src/utils/heatmapEngine.ts` — Garment coverage detection + fit score calculation + arm detection via armScore + normalYAbs gray zone disambiguation; 9 height regions with per-measurement weighting
- `src/utils/smoothingEngine.ts` — Laplacian color smoothing for heatmap vertex colors; `buildAdjacency()` + `smoothColors()` with double-buffer strategy
- `src/utils/fitAdvisor.ts` — Fit advisor panel logic
- `src/utils/sizeChartEngine.ts` — Brand size chart validation, parsing, serialization, active chart resolution with default fallback
- `src/components/GarmentShell.tsx` — Three.js garment loader via GLTFLoader, morph target sync with body, semi-transparent material, separate toggle
- `src/data/defaultSizeCharts.ts` — Extracted default size chart data (single source of truth for sizeChartEngine)
- `scripts/bake-garments.py` — Blender pipeline: parametric garment patterns → surface projection → morph target baking → GLB export
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

---

## Coordinate System (CRITICAL)

- In the GLB: **Z negative = front (belly)**, **Z positive = back**
- In Blender morph script, after -90° X rotation: **FORWARD (Y axis) positive = BACK**
- All morph functions check `co[FORWARD] < 0` for front-facing vertices
- Heatmap engine receives `z` as `yPos` parameter — `yPos < 0` = front, `yPos > 0` = back
- Arms: high `xAbs` (far from center on X), high `normalXAbs` (outward-facing normals)
- Torso: low `xAbs`, low `normalXAbs` (front/back facing normals along Z)

### Vertex Ranges (base pose)
- X: -0.319 to 0.351 (width 0.670)
- Y: -0.001 to 1.729 (height 1.730)
- Z: -0.165 to 0.144 (depth 0.309)

### Body Height Landmarks (normalized 0–1)
- 0.04: ankles | 0.18: calves | 0.36: thighs | 0.44: crotch/hip
- 0.55: belly/waist | 0.58: waist | 0.68: chest | 0.77: shoulders
- 0.85: neck | 0.90+: head

### Arm Detection (armScore + normalYAbs)
```
armScore = normalXAbs + xAbs * 3
```
- Clear arm: armScore > 1.3 → uncovered below sleeveEnd
- Gray zone: armScore 1.0–1.3 → use normalYAbs to disambiguate:
  - normalYAbs > 0.25 → side torso (covered)
  - normalYAbs ≤ 0.25 → arm (uncovered below sleeveEnd)
- Clear torso: armScore < 1.0 → always covered
- Side torso: normalXAbs ~0.4–0.6, xAbs ~0.10–0.15 → score ~0.7–1.1
- Actual arms: normalXAbs ~0.7–1.0, xAbs ~0.15–0.35 → score ~1.2–2.0

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

### ✅ Heatmap System
- Garment selection: T-Shirt, Oxford Shirt, Slim Jeans, Straight Jeans
- Size selection per garment (XS–XXL for tops, 28–38 for jeans)
- Fit style: Compression, Slim, Regular, Relaxed, Oversized
- Heatmap overlays on skin texture (vertex colors multiplied with texture)
- Toggle on/off
- Edge fade at garment boundaries (wider fades for jeans: 0.02)
- Jeans coverage: full legs, waist to ankles, armScore-gated hand exclusion ✅
- Oxford shirt: full torso front+back, long sleeves ✅
- T-shirt: torso + short sleeves via armScore + normalYAbs detection ✅
- Fit score: -1 (tight/red) → 0 (balanced/green) → +1 (loose/blue)
- 9 measurement regions with per-measurement weighting (was 5)
- Direct ML predictions for all measurements (no derived estimates)
- Laplacian color smoothing (2 passes, weight 0.5) for cleaner gradients
- Heatmap still has some boundary jaggedness — inherent to vertex-based coloring

### ✅ 2D Fit Preview (separate page)
- Located at `/fit2d.html`
- SVG body silhouette with heatmap regions
- Separate from the 3D system

---

## Phases

### Phase 1: Heatmap on Body Surface — ~95% done
- ✅ Garment selection, size, fit style
- ✅ Heatmap colors body where garment covers
- ✅ Overlays on skin texture, toggle on/off
- ✅ Jeans work well (slim + straight, armScore-gated hand exclusion)
- ✅ Oxford shirt works well (full torso + long sleeves)
- ✅ T-shirt sleeve cutoff (armScore + normalYAbs detection)
- ✅ Side torso gap fixed (normalYAbs disambiguation in gray zone)
- ✅ Better fit calculation (9 regions, direct ML predictions, per-measurement weighting)
- ✅ Laplacian color smoothing (2 passes, boundary-preserving)
- 🟡 Heatmap boundary jaggedness (inherent to vertex-based coloring — acceptable for Phase 1)
- ❌ Need more garment types (deferred)

### Phase 2: Generated Garment Shell from Specs — ~30% done (runtime pipeline working, garment models need replacement)
- ✅ Size chart engine with brand override support (sizeChartEngine.ts, 24 tests)
- ✅ Default size chart data extracted (defaultSizeCharts.ts)
- ✅ Blender garment baking pipeline (bake-garments.py — pattern creation, morph targets, GLB export)
- ✅ GarmentShell runtime component (GLB loading, morph sync, semi-transparent material)
- ✅ Separate garment shell toggle in UI (independent from heatmap)
- ✅ bodyStore extended (brandSizeChart, currentMorphInfluences, garmentShellEnabled)
- ✅ heatmapEngine supports sizeChartOverride parameter
- ✅ Agent hooks: test-on-save, ts-error-check, test-after-task
- 🔴 Parametric tube garments are POC only — need pre-made models from Marvelous Designer/CLO3D for production quality
- 🔴 Blender cloth simulation broken (garment flies off — coordinate space issue)
- 🔴 Only garment-tee-M.glb generated — other types/sizes missing
- ❌ Heatmap on garment shell (deferred — heatmap stays on body for now)
- ❌ Real-time wrinkle shaders (Option C — deferred)

### Phase 3: Real Garment Mapping — not started
- Map actual brand garments onto body
- Shopify integration
- 3D clothing meshes or AI-generated overlay

---

## External Tools & Integrations to Evaluate

### Body Model — SHAPY / SMPL / Meshcapade
- **SHAPY** (https://github.com/muelea/shapy) — open source (CVPR 2022), takes measurements + semantic attributes → regresses SMPL body shape parameters. Python-based, would run server-side. Free for research.
- **Meshcapade API** (https://meshcapade.com) — commercial REST API built on SMPL. Creates avatars from measurements or photos. Free tier for non-commercial, €1,500+/year for micro companies.
- **SMPL mesh** has standardized topology (~6,890 vertices) — consistent vertex indices across all body shapes, which makes garment fitting much easier than our current MakeHuman morph approach.
- **Consideration for Phase 2**: SMPL's standardized topology would let us define garment patterns relative to known vertex indices. Could replace MakeHuman + morph targets entirely, or run alongside as an alternative body engine.
- **Trade-off**: Current MakeHuman system works well and runs fully client-side. SMPL would add server dependency or require bundling the model (~50MB+). Meshcapade API adds external dependency + cost.

### Clothing Visualization — Photoroom
- **Photoroom Virtual Model API** (https://docs.photoroom.com/image-editing-api-plus-plan/virtual-model) — takes flat-lay clothing photos → generates photoshoot-quality images on AI models. 2D image generation, not 3D.
- **Not useful for Phase 2** (garment shell mesh is 3D).
- **Useful for Phase 3**: Could generate product images for Shopify listings from flat-lay photos. Good for marketing/product photography automation.

### Virtual Try-On — Fitroom
- **Fitroom API** (https://developer.fitroom.app/) — image-based virtual try-on. Upload person photo + clothing photo → composite image. 2D, not 3D.
- **Not useful for Phase 2** (again, 2D not 3D).
- **Useful for Phase 3**: "See it on yourself" feature — customer uploads selfie, sees clothing on their body. Complements our 3D fit visualization with a 2D photo-realistic view.

### Decision Matrix

| Tool | Phase 2 (Garment Shell) | Phase 3 (Real Garments) | Cost | Integration Effort |
|------|------------------------|------------------------|------|-------------------|
| SHAPY/SMPL | High — standardized body mesh for garment fitting | High — better body accuracy | Free (open source) | High — Python server, model bundling |
| Meshcapade API | High — same benefit, easier integration | High | €1,500+/year | Medium — REST API calls |
| Photoroom | None | Medium — product image generation | Paid API | Low — REST API |
| Fitroom | None | High — 2D try-on from selfie | Paid API | Low — REST API |

### Open Questions
- Do we want to keep MakeHuman + morph targets (fully client-side) or migrate to SMPL (server dependency)?
- Can we run SMPL inference in the browser via ONNX/TensorFlow.js to stay client-side?
- For Phase 2 garment shell: generate from parametric patterns (our own) or use an existing garment simulation library?
- Photoroom/Fitroom integration timing — Phase 3 or later?

### ⚠️ Production Readiness — Must Revisit Before Shopify Deployment
Phase 2 starts with pre-baked Blender cloth sim (Option A) as a practical foundation, but for a production-quality Shopify product this WILL need to be revisited. The following must be evaluated before going live:
- **SMPL / SHAPY**: Commercial license (Meshcapade €1,500+/yr for micro) — standardized vertex topology makes garment fitting far more reliable than MakeHuman morphs. Need to evaluate if the accuracy gain justifies the cost and server dependency.
- **ML-based garment draping**: Neural cloth simulation (LUIVITON, DiffAvatar, learning-based drape prediction) could replace or augment pre-baked sim for more realistic results across body shapes. Requires training data.
- **Larger clothing datasets**: GarmentCodeData (115k patterns, ECCV 2024), real brand measurement databases, and fabric property datasets for training ML drape models and expanding garment type coverage beyond 4 types.
- **Real-time wrinkle shaders** (Option C): Displacement/normal map shaders for cloth-like surface detail on top of baked shapes — planned as Phase 2 extension.
- **Fabric physics parameters**: Need real-world fabric testing data (weight, stiffness, bending) per material type for accurate simulation — cotton, denim, silk, polyester, etc.
- **Body model accuracy**: Current MakeHuman + ANSUR/NHANES model may not be accurate enough for production. SMPL trained on 10k+ 3D body scans has better shape space coverage.
- **Population diversity**: Indian population data, female body model, age-based composition — all needed for global Shopify deployment.
- **Decision point**: After Phase 2 prototype works end-to-end with baked sim, do a formal evaluation sprint comparing baked-sim quality vs. SMPL+ML approach before committing to production architecture.

## Miscellaneous Fixes & TODO

### Pending Fixes
- **Heatmap boundary jaggedness**: Vertex-based coloring creates some blocky edges at garment boundaries. Could be improved with shader-based approach or higher mesh resolution, but acceptable for Phase 1.

### Pending Features
- Female model (export from MakeHuman + generate morphs)
- SHAPY/SMPL integration for research-grade accuracy
- Age-based body composition changes
- More NHANES cycles for training data
- Skin texture quality improvements
- Indian population data (deferred)
- Shopify integration
- More garment types (polo, hoodie, jacket, shorts, etc.)
- Garment construction data for better shapes

### Morph Target Issues
- Some morphs have cross-region bleed at boundaries
- Weight slider caps out at extreme weights (morph displacement limit)

---

## Key Commands

### Regenerating the model
```bash
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/generate-morphs.py -- male
```

### Retraining the ML model
```bash
python scripts/train-body-model.py
```

### Git LFS
Set up for *.glb, *.fbx, *.png files. The GLB is ~56MB.

---

## Git Workflow

**Remote:** `origin` → https://github.com/aaditverma/makehuman

### End-of-Session Commit & Push
```bash
git add -A
git commit -m "Session XXX: <brief summary>"
git push origin main
```

### Pull at Start of Session
```bash
git pull origin main
```

### Branch Workflow (for larger features)
```bash
git checkout -b feature/<feature-name>
# ... work ...
git add -A
git commit -m "feat: <description>"
git push origin feature/<feature-name>
# merge via PR or:
git checkout main
git merge feature/<feature-name>
git push origin main
```

### LFS Notes
- Large files (*.glb, *.fbx, *.png) are tracked by Git LFS
- After cloning: `git lfs pull` to download large files
- The GLB model is ~56MB

---

## Session Handoff Index

| # | Date | File | Summary |
|---|------|------|---------|
| 001 | Pre-2026-04-12 | `.kiro/SESSION_HANDOFF_001.md` | Initial project setup, architecture, 3D avatar, ML model, heatmap Phase 1 |
| 002 | 2026-04-12 | `.kiro/SESSION_HANDOFF_002.md` | T-shirt sleeve cutoff fix (vertex normals + armScore approach) |
| 003 | 2026-04-12 | `.kiro/SESSION_HANDOFF_003.md` | Phase 1 refinements: better fit calc, side torso gap fix, color smoothing, jeans boundary fix |
| 004 | 2026-04-13 | `.kiro/SESSION_HANDOFF_004.md` | Phase 2 implementation: size chart engine, Blender garment pipeline, GarmentShell component, garment shell toggle |

---

## Session Timeline

### Session 001 — Pre-2026-04-12
- Set up full project from scratch
- MakeHuman male model → Blender morph pipeline → GLB export
- Built React + Three.js viewer with morph target animation
- Trained ML model on ANSUR II + NHANES data (29k subjects)
- Implemented morphMapper with z-score based morph mapping
- Built heatmap engine with garment coverage, fit scoring, edge fades
- Oxford shirt and jeans heatmaps working correctly
- T-shirt sleeve cutoff broken — removed cutoff, tee renders as full-sleeve
- Built 2D fit preview (separate SVG page)
- Fixed forward direction bug (Z negative = front)

### Session 002 — 2026-04-12
- Diagnosed T-shirt sleeve cutoff bug — found TWO root causes:
  1. No arm detection in coverage check (`sleeveEnd` unused)
  2. Edge fade applied sleeve fade to ALL side/back vertices (the real killer)
- Added `normalXAbs` parameter to `getVertexFit()` for vertex normal data
- BodyModel.tsx now reads `geometry.attributes.normal` and passes to heatmap engine
- Implemented `armScore = normalXAbs + xAbs * 3` for arm vs torso classification
- Fixed both coverage check and edge fade to use armScore gating
- T-shirt now renders with short sleeves, back fully covered
- Minor side torso gap remains (gray zone vertices at armpit/flank — deferred)
- Cleaned up all debug logging
- Created PROJECT_MASTER.md and session handoff system

### Session 003 — 2026-04-12
- Closed out T-shirt sleeve cutoff verification tasks
- Better fit calculation: expanded estimatedMeasurements() to 12 fields, 9 height regions (was 5), per-measurement weighting, direct ML predictions in bodyMap, expanded size charts and ease targets
- Side torso gap fix: added normalYAbs as secondary signal for gray zone disambiguation (normalYAbs > 0.25 = side torso, ≤ 0.25 = arm)
- Heatmap color smoothing: new smoothingEngine.ts with Laplacian smoothing (buildAdjacency + smoothColors), 2 passes, weight 0.5, boundary-preserving
- Jeans boundary fix: armScore-gated hand exclusion, side edge fade, wider waistband/ankle fades
- Set up Vitest + fast-check test infrastructure, wrote 5 property-based tests
- Phase 1 now ~95% complete — heatmap still has some boundary jaggedness but acceptable

### Session 004 — 2026-04-13
- Created Phase 2 garment shell spec (requirements, design, tasks) via requirements-first workflow
- Implemented size chart engine: BrandSizeChart interfaces, validation, parsing, serialization, getActiveSizeChart with default fallback
- Extracted default size charts into standalone module (defaultSizeCharts.ts)
- Wrote 24 tests: 7 property-based (validation correctness + serialization round-trip), 11 unit, 6 integration
- Built Blender garment baking pipeline (bake-garments.py): parametric pattern creation, surface projection onto body, morph target baking per body variant, GLB export
- Debugged coordinate space issues: Blender GLB import uses Z-up, garment patterns must use Z as height axis, export with Y-up conversion
- Debugged cloth simulation failure: garment flies off during sim (fell back to surface projection)
- Built GarmentShell.tsx runtime component: GLB loading via GLTFLoader, morph sync, semi-transparent material
- Added separate "Garment Shell" toggle in UI (independent from heatmap)
- Extended bodyStore with garmentShellEnabled, brandSizeChart, currentMorphInfluences
- Added sizeChartOverride parameter to computeHeatmap()
- Fixed heatmap regression (was disabled when garmentType !== 'none')
- Generated garment-tee-M.glb (995 verts, 8 shape keys, 97KB) — renders on body as POC
- Set up agent hooks: test-on-save, ts-error-check, test-after-task
- Added production readiness notes to project master (SMPL, ML draping, datasets, fabric physics)
- Conclusion: parametric tube garments are POC only — need pre-made models from Marvelous Designer/CLO3D for production quality
- Next: design-first spec for realistic garment model pipeline
