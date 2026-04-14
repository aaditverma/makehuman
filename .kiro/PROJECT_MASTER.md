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
- **Dual Engine:** User can toggle between SMPL and MakeHuman body models via UI
- **MakeHuman Model:** FBX → Blender morph targets → GLB (214k vertices, 25 morphs, skin texture)
- **SMPL Model:** SMPL pickle → Blender script → GLB (165k vertices, 20 paired beta morph targets, A-pose, skin texture, 94.4 MB)
- **Source FBX:** `public/models/male-base.fbx` (MakeHuman, default male)
- **Source SMPL:** Downloaded from smpl.is.tue.mpg.de (v1.1.0, male, 300 shape PCs — we use first 10)
- **SMPL Pickle Location:** `C:\Users\aadit\Downloads\SMPL_python_v.1.1.0\smpl\models\basicmodel_m_lbs_10_207_0_v1.1.0.pkl` (licensed, not in git)
- **Generated MakeHuman GLB:** `public/models/human-male.glb` (214k vertices, 25 morph targets)
- **Generated SMPL GLB:** `public/models/human-smpl.glb` (165k vertices, 20 paired beta morph targets, A-pose, 94.4 MB)
- **SMPL Browser Binary:** `public/models/smpl/smpl_model.bin` (1.58 MB — template + blend shapes + faces + landmarks)
- **Blender scripts:** `scripts/generate-morphs.py` (MakeHuman), `scripts/generate-smpl-model.py` (SMPL)
- **Blender path:** `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`

### Key Files
- `src/components/BodyModel.tsx` — Dual model loading (MakeHuman + SMPL GLB), morph target animation, SMPL beta driving, heatmap vertex coloring, engine initialization
- `src/components/UI/ControlPanel.tsx` — Body engine toggle (top), body composition selector (SMPL only), body type presets (MakeHuman only), body inputs, garment selection, heatmap toggle, morph sliders, SMPL measurement display with resolveDisplayMeasurement
- `src/components/Scene.tsx` — Three.js canvas, lighting, grid
- `src/components/Controls.tsx` — OrbitControls camera
- `src/components/Lighting.tsx` — Studio lighting setup
- `src/components/GarmentShell.tsx` — Garment loader with binding map deformation + morph-sync fallback, opaque fabric materials
- `src/stores/bodyStore.ts` — Zustand store (user inputs, bodyComposition, bodyEngine, morph overrides, heatmap state, smplMeasurements)
- `src/utils/morphMapper.ts` — Converts user inputs → morph target influences; supports SMPL measurements + body composition boosts
- `src/utils/heatmapEngine.ts` — Garment coverage + fit scoring + arm detection; `computeHeatmapSmpl()` for SMPL landmark-based regions
- `src/utils/smoothingEngine.ts` — Laplacian color smoothing for heatmap vertex colors
- `src/utils/smplForwardPass.ts` — Pure TS SMPL forward pass, binary parser, landmark helper
- `src/utils/smplRegressor.ts` — Layered beta pipeline: lookupRegress → presetOffsets → compositionBias → customMeasurementRefinement → clamp. Exports computeSmplBetas(), SMPL_PRESET_OFFSETS, COMPOSITION_BIAS, MEASUREMENT_BETA_MAP
- `src/utils/smplDisplay.ts` — Display rule helper: resolveDisplayMeasurement() for custom vs SMPL-extracted values
- `src/utils/measurementExtractor.ts` — Extracts circumferences from SMPL mesh at anatomical heights
- `src/utils/bindingMapCodec.ts` — Binary serialization for garment binding maps
- `src/utils/garmentDeformer.ts` — Barycentric garment deformation with degenerate fallback
- `src/utils/bodyEngine.ts` — BodyEngine abstraction (SmplEngine + MakeHumanEngine), event bus
- `src/utils/engineInit.ts` — Graceful degradation hierarchy
- `src/utils/garmentRegistry.ts` — Static garment template registry
- `scripts/generate-smpl-model.py` — Blender: SMPL pickle → A-posed GLB with 20 paired beta morph targets (smooth subdivision interpolation) + skin texture. Uses SMPL skeleton for posing.
- `scripts/export-smpl-assets.py` — Converts SMPL pickle → browser binary + landmarks JSON
- `scripts/bake-garment-bindings.py` — Computes barycentric binding maps for garments on SMPL body
- `src/utils/fitAdvisor.ts` — Fit advisor panel logic
- `src/utils/sizeChartEngine.ts` — Brand size chart validation, parsing, serialization, active chart resolution with default fallback
- `src/components/GarmentShell.tsx` — Three.js garment loader via GLTFLoader, morph target sync with body, semi-transparent material, separate toggle
- `src/data/defaultSizeCharts.ts` — Extracted default size chart data (single source of truth for sizeChartEngine)
- `scripts/bake-garments.py` — Blender pipeline: parametric garment patterns → surface projection → morph target baking → GLB export
- `src/data/ansur2_model.json` — Gradient boosting lookup table (29k subjects, trilinear interpolation)
- `src/data/bodyProfiles.json` — Body type profiles with measurement offsets and morph response curves
- `src/data/calibrated_coefficients.json` — Source calibrated coefficients (SHAPY-trained regression weights, preset offsets, composition bias, sensitivity map, fat distribution)
- `public/data/calibrated_coefficients.json` — Runtime copy served by Vite (must stay in sync with src/data/ version)
- `scripts/generate-shapy-data.py` — SHAPY A2S data generation across population grid → calibration_dataset.json
- `scripts/train-beta-coefficients.py` — Polynomial regression trainer → calibrated_coefficients.json
- `scripts/calibrate-validate.py` — ANSUR II round-trip bias correction → correction_factors.json
- `scripts/data/calibration_dataset.json` — 7,500+ (measurements → betas) pairs from SHAPY
- `scripts/data/correction_factors.json` — Bias/scale corrections for measurement extractor
- `src/utils/shapyA2S.ts` — SHAPY A2S polynomial regression in TypeScript: coefficient loading, polynomial feature expansion, beta computation
- `src/utils/subdivisionMapper.ts` — Barycentric subdivision mapping: loads precomputed map, interpolates base mesh vertices to subdivided mesh
- `src/data/shapy_a2s_coefficients.json` — Source A2S coefficient artifact (synthetic, replace with real SHAPY extraction)
- `public/data/shapy_a2s_coefficients.json` — Runtime copy of A2S coefficients
- `scripts/extract-shapy-a2s.py` — Extracts SHAPY A2S polynomial coefficients from PyTorch checkpoint (or generates synthetic)
- `scripts/generate-subdivision-map.py` — Blender script: generates barycentric subdivision mapping binary
- `scripts/data/a2s_validation_pairs.json` — 120 (inputs → betas) validation pairs for A2S TypeScript vs Python comparison

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

### ✅ SMPL Body Engine (Feature Parity with MakeHuman)
- SMPL model in A-pose (35° shoulder rotation via SMPL skeleton + skinning weights)
- 165k vertices (2x subdivision), 20 paired morph targets (Beta0–9 + Beta0Neg–9Neg), 94.4 MB GLB
- Smooth subdivision-interpolated shape keys (no banding artifacts)
- Layered beta pipeline: base regression → body type presets → body composition bias → custom measurement refinement → clamp [-3, 3]
- Height handled by group-level Y scaling (same as MakeHuman), weight/shape by betas
- Heatmap vertex coloring on SMPL mesh with Laplacian smoothing
- Estimated measurements display using SMPL-extracted values
- Display rule: when |custom - SMPL-extracted| > 3cm, show SMPL value
- Smooth animated transitions for all 20 morph targets with positive↔negative crossover
- Body Type presets (5) shown only for MakeHuman, Body Composition (3) shown only for SMPL
- Engine migration evaluation: recommends SMPL-only migration (see evaluation.md)
- 143 tests, 14 property-based tests covering 14 correctness properties

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
- **SMPL regressor coefficients calibrated but accuracy limited**: Calibrated via SHAPY synthetic data (7,500 pairs). Presets and composition switching now produce dramatic visual differences. Round-trip accuracy limited by demographics-only regression (~8-12cm mean error). Need 8-input regression or SHAPY polynomial extraction for <5cm accuracy.
- **Calibrated coefficients must be in public/data/**: `public/data/calibrated_coefficients.json` is the runtime copy. `src/data/calibrated_coefficients.json` is the source. Keep both in sync after recalibration.
- **SMPL A-pose shape keys in T-pose space**: Shape key deformations computed in T-pose, base mesh posed to A-pose. Minor artifacts possible at extreme beta values near shoulders.
- **SMPL skin texture basic**: Smart UV project, not anatomically mapped. Acceptable for now.

### Pending Features
- **SHAPY regressor integration** — ~~use SHAPY to generate synthetic training data~~ DONE. ~~Extract SHAPY A2S polynomial coefficients~~ DONE (synthetic coefficients in place, real extraction ready via `scripts/extract-shapy-a2s.py --checkpoint`). ~~Train 8-input regression~~ DONE (v2.0.0 coefficient table with 42% MAE improvement).
- **8-input regression** — ~~extend regressor to use chest/waist/hip/inseam as inputs~~ DONE. Dual-model coefficient table (v2.0.0), 3-way routing in lookupRegress(), refinement skip for full 8-input.
- **Scale to more beta PCs** — ~~SMPL supports 300 PCs, currently using 10~~ DONE. Forward pass generalized to N PCs, regressor outputs N-length betas, BodyModel.tsx uses buffer geometry updates instead of morph targets, subdivision mapper module, all Python scripts support `--num-shapes`/`--num-betas`/`--no-morphs`. Need to regenerate assets with `--num-shapes 20` or `50` to activate.
- **SHAPY A2S polynomial extraction** — ~~TypeScript module~~ DONE (`shapyA2S.ts`). 4-tier routing (A2S → 8-input → 4-input → heuristic). Synthetic coefficients in place. Need real SHAPY checkpoint for production-quality coefficients.
- **Manual beta calibration** — ~~run forward pass on known body shapes~~ DONE (calibrate-validate.py + correction_factors.json). Corrections need to be merged via SHAPY pipeline re-run.
- Female model (SMPL female pickle available, swap model weights)
- Garment shell on SMPL body (model garments with matching shape keys)
- Age-based body composition changes
- More NHANES cycles for training data
- Skin texture quality improvements (proper UV mapping for SMPL topology)
- Indian population data (deferred)
- Shopify integration
- More garment types (polo, hoodie, jacket, shorts, etc.)
- Garment construction data for better shapes

### Morph Target Issues
- Some morphs have cross-region bleed at boundaries
- Weight slider caps out at extreme weights (morph displacement limit)

---

## Key Commands

### Regenerating the MakeHuman model
```bash
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/generate-morphs.py -- male
```

### Regenerating the SMPL model (A-pose, paired morph targets)
```bash
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/generate-smpl-model.py -- --smpl-pkl "C:\Users\aadit\Downloads\SMPL_python_v.1.1.0\smpl\models\basicmodel_m_lbs_10_207_0_v1.1.0.pkl" --subdivisions 2 --texture public/models/textures/young_lightskinned_male_diffuse.png
```
Takes ~70 seconds. Output: `public/models/human-smpl.glb` (~94 MB, 165k vertices, 21 shape keys)

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
| 005 | 2026-04-14 | `.kiro/SESSION_HANDOFF_005.md` | SMPL integration: full infrastructure spec, SMPL model generation (165k verts, 10 betas), dual engine toggle, body composition selector |
| 006 | 2026-04-14 | `.kiro/SESSION_HANDOFF_006.md` | SMPL feature parity: layered beta pipeline, negative morph targets, A-pose via skeleton, smooth subdivision, heatmap/measurements on SMPL, 143 tests |
| 007 | 2026-04-14 | `.kiro/SESSION_HANDOFF_007.md` | SHAPY calibration tasks 6-13, preset fix (public/data/), measurement extractor scale corrections, refinement loop improvements, 176/183 tests |
| 008 | 2026-04-15 | `.kiro/SESSION_HANDOFF_008.md` | Three new specs created + implemented: 8-input regression (42% MAE improvement), expanded beta PCs (N configurable, buffer geometry), SHAPY polynomial extraction (A2S module, 4-tier routing). 274 tests. |

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

### Session 005 — 2026-04-14 (Part 1)
- Created SMPL body & garment pipeline spec (requirements-first: 12 requirements, design with 11 correctness properties, 22 tasks)
- Built full SMPL infrastructure: forward pass, regressor, measurement extractor, binding map codec, garment deformer, body engine abstraction, engine init, garment registry
- Added body composition selector (Athletic/Average/Heavy) to UI and store
- Added body engine toggle (SMPL Refined / MakeHuman) to top of control panel
- Exported SMPL model from pickle to browser binary (smpl_model.bin, 1.58 MB)
- Generated SMPL GLB via Blender: 165k vertices (2x subdivision), 10 beta morph targets, skin texture, 53.6 MB
- Updated BodyModel.tsx for dual model loading — switches between MakeHuman and SMPL GLB based on engine toggle
- Updated GarmentShell.tsx with opaque fabric materials (cotton/denim) and binding map deformation support
- Updated heatmapEngine.ts with SMPL landmark-based region mapping
- Updated morphMapper.ts with SMPL measurements path + body composition morph boosts
- 123 tests passing (90 original + 33 new including 11 property-based tests)
- Deleted broken agent hooks (test-on-save, ts-error-check, test-after-task)
- SMPL model renders standing upright with skin texture — basic beta morph targets working
- Next: new spec for SMPL customizability (matching MakeHuman feature parity — height/weight mapping, heatmap, negative betas, proper UV mapping)

### Session 006 — 2026-04-14 (Part 2)
- Created SMPL feature parity spec (9 requirements, 14 correctness properties, 14 top-level tasks)
- Implemented full layered beta pipeline: lookupRegress → presetOffsets → compositionBias → customMeasurementRefinement → clamp
- Fixed critical Blender pipeline: replaced nearest-neighbor shape key interpolation with smooth subdivision approach (each deformed mesh subdivided separately)
- Fixed inverted shape key signs (SMPL PCA convention was opposite to regressor expectations)
- Implemented proper A-pose using SMPL's 24-joint skeleton + skinning weights (35° shoulder rotation)
- Added paired positive/negative morph targets (20 shape keys) for full [-3, 3] beta range
- Wired heatmap rendering to SMPL mesh with Laplacian smoothing
- Added estimated measurements display using SMPL-extracted values with custom vs extracted display rule
- Conditional UI: Body Type (5 presets) for MakeHuman only, Body Composition (3 options) for SMPL only
- Height handled by group-level Y scaling, weight/shape by betas (removed height from regressor)
- Ground anchoring via periodic bounding box recomputation
- Created smplDisplay.ts helper for measurement display rules
- Created engine migration evaluation document (recommends SMPL-only migration)
- 143 tests passing (14 new property-based tests)
- Regressor coefficients are heuristic — need SHAPY integration for accuracy (next spec)
- Next: SHAPY regressor integration spec + trained lookup table for accurate measurements→betas

### Session 007 — 2026-04-14 (Part 3)
- Completed SHAPY beta calibration spec tasks 6–13 (runtime wiring, validation, property tests, backward compat, npm calibrate)
- Fixed critical deployment bug: calibrated coefficients JSON was only in `src/data/`, not `public/data/` where Vite serves it. Presets never loaded at runtime. Copied to `public/data/`.
- Added empirical scale corrections to measurement extractor (ANSUR II validated: chest 0.895, waist 0.903, hip 0.964, inseam 1.104)
- Improved refinement loop: 10 iterations, adaptive learning rate (0.5 × 0.85^iter), proportional sensitivity weighting
- Added ANSUR II lookup table integration to regressor
- Created validation test suite (100 ANSUR II subjects, round-trip pipeline, summary report)
- Created Python bias correction script (calibrate-validate.py) + correction_factors.json
- 176/183 tests pass; 7 accuracy-threshold failures need SHAPY pipeline re-run or 8-input regression
- Identified fundamental limitation: demographics-only regression (4 inputs → 10 betas) has irreducible ~10-14cm variance
- Three paths forward identified: 8-input regression, SHAPY polynomial extraction, scale to more beta PCs
- Next: new spec for enhanced regressor (8-input + more PCs + SHAPY polynomial extraction)

### Session 008 — 2026-04-15
- Created 3 new specs: 8-input-regression, shapy-polynomial-extraction, expanded-beta-pcs
- **8-input-regression** (fully implemented):
  - Extended regressor from 4 to 8 inputs (+ chest/waist/hip/inseam)
  - Trained dual-model v2.0.0 coefficient table — 8-input MAE 0.0428 vs 4-input 0.0741 (42% improvement)
  - 3-way routing in lookupRegress(): 8-input → 4-input → heuristic
  - Hybrid path for partial measurements (1-3 provided, rest imputed with 0.7 confidence scaling)
  - Refinement skip when all 4 measurements provided via 8-input path
  - 22 new tests (unit + PBT + validation + comparison report)
- **expanded-beta-pcs** (fully implemented):
  - Forward pass generalized: reads shapeCount from binary header, works with any N in [1, 300]
  - Regressor outputs N-length betas (zero-padded beyond trained range)
  - BodyModel.tsx: replaced morph target driving with direct buffer geometry updates for SMPL mode
  - New subdivisionMapper.ts: barycentric interpolation from 6,890 base → ~165k subdivided vertices
  - All Python scripts updated: `--num-shapes`, `--num-betas`, `--no-morphs` flags
  - New generate-subdivision-map.py Blender script
  - MakeHuman morph target path unchanged
- **shapy-polynomial-extraction** (fully implemented):
  - New shapyA2S.ts module: polynomial feature expansion, A2S beta computation, coefficient loading
  - 4-tier routing in lookupRegress(): A2S → 8-input → 4-input → heuristic
  - RegressionPath tracking (getLastRegressionPath())
  - Python extraction script with --synthetic fallback mode
  - Synthetic A2S coefficients generated (120 validation pairs)
  - A2S initialization wired into bodyEngine.ts
- 274 total tests passing (7 pre-existing accuracy-threshold failures unchanged)
- Next: extract real SHAPY A2S coefficients with checkpoint, regenerate assets with 20-50 PCs
