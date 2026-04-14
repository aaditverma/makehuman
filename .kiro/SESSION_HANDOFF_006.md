# Session Handoff 006 — 2026-04-14 (Part 2)

## Summary
SMPL feature parity spec: full implementation of layered beta computation, negative morph targets, heatmap on SMPL mesh, estimated measurements display, smooth animations. Fixed critical Blender pipeline issues (nearest-neighbor banding → smooth subdivision, inverted shape key signs, A-pose via SMPL skeleton). UI conditionally shows Body Type (MakeHuman) vs Body Composition (SMPL). Height handled by group scaling, weight by betas. 143 tests passing.

## What Changed

### SMPL Feature Parity Spec (`.kiro/specs/smpl-feature-parity/`)
- Created full spec: 9 requirements, design with 14 correctness properties, 14 top-level tasks
- All required tasks completed (optional female tasks 4.4, 4.8 deferred)

### Blender Script (`scripts/generate-smpl-model.py`) — Major Rewrite
- **Shape key order fixed**: Shape keys now added to 6,890-vertex base mesh, then each deformed mesh is subdivided separately for smooth interpolation. Old approach (subdivide first, nearest-neighbor lookup) caused visible banding/squishing artifacts.
- **Shape key signs flipped**: SMPL PCA convention was opposite to what regressor expected. Positive `Beta{i}` now = larger body (was inverted).
- **A-pose via SMPL skeleton**: Uses SMPL's actual 24-joint armature + skinning weights to rotate shoulders 35° down. Proper symmetric A-pose, no vertex hacking.
- **Paired morph targets**: 20 shape keys (Beta0–Beta9 + Beta0Neg–Beta9Neg) for full [-3, 3] beta range.
- **Output**: 165k vertices, 21 shape keys, 94.4 MB GLB, A-pose

### SMPL Regressor (`src/utils/smplRegressor.ts`) — Layered Pipeline
- NEW: `computeSmplBetas()` — full pipeline: `lookupRegress()` → `applyPresetOffsets()` → `applyCompositionBias()` → `refineWithCustomMeasurements()` → clamp [-3, 3]
- NEW: `SMPL_PRESET_OFFSETS` — body type preset beta offsets (slim/average/athletic/curvy/heavy)
- NEW: `COMPOSITION_BIAS` — body composition bias vectors (athletic/average/heavy)
- NEW: `MEASUREMENT_BETA_MAP` — sensitivity map for custom measurement refinement
- NEW: `refineWithCustomMeasurements()` — iterative refinement loop (5 iterations, 3cm tolerance)
- MODIFIED: `lookupRegress()` — removed inline composition logic, height removed from betas (handled by group scaling), conservative coefficients
- Exported `lookupRegress`, `applyPresetOffsets`, `applyCompositionBias` for testing

### Body Engine (`src/utils/bodyEngine.ts`)
- MODIFIED: `SmplEngine.update()` now calls `computeSmplBetas()` with full pipeline inputs including bodyType

### BodyModel (`src/components/BodyModel.tsx`)
- MODIFIED: Paired positive/negative morph target driving via regex `/^Beta(\d+)(Neg)?$/`
- MODIFIED: SMPL mode uses group-level height scaling (same as MakeHuman) — betas handle weight/shape only
- MODIFIED: Ground anchoring via periodic bounding box recomputation (every 10 frames)
- MODIFIED: Adjacency cache cleared on engine switch (different mesh topology)
- MODIFIED: Writes SMPL measurements to store via `setSmplMeasurements()`

### ControlPanel (`src/components/UI/ControlPanel.tsx`)
- MODIFIED: Body Type (5 presets) only shows for MakeHuman engine
- MODIFIED: Body Composition (3 options) only shows for SMPL engine
- MODIFIED: Estimated measurements use SMPL-extracted values when available
- MODIFIED: Display rule: when |custom - SMPL-extracted| > 3cm, show SMPL value

### New Files
- `src/utils/smplDisplay.ts` — `resolveDisplayMeasurement()` helper for custom vs extracted display rule
- `src/utils/__tests__/smplMorphMapping.prop.test.ts` — Properties 1, 13, 14 (influence mapping, damping, transition invariant)
- `src/utils/__tests__/smplDisplay.prop.test.ts` — Property 11 (display rule)
- `.kiro/specs/smpl-feature-parity/evaluation.md` — SMPL vs MakeHuman comparison, recommends SMPL-only migration

### Store (`src/stores/bodyStore.ts`)
- NEW: `smplMeasurements: ExtractedMeasurements | null` field + `setSmplMeasurements` action

### Tests
- 143 tests total across 16 test files
- 14 new property-based tests covering all correctness properties
- All passing

## Known Issues
- **SMPL regressor coefficients are heuristic** — weight interactions work directionally but magnitudes aren't calibrated against real body data. Need SHAPY integration or trained regressor for accuracy.
- **A-pose shape keys not posed** — shape key deformations are computed in T-pose, then the base mesh is posed to A-pose. Shape keys deform correctly but the deformation directions are in T-pose space. For small betas this is fine; at extreme values there may be minor artifacts at the shoulders.
- **SMPL skin texture still basic** — smart UV project, not anatomically mapped
- **SMPL model has no facial features** — acceptable for clothing fit app
- **SMPL pickle file not in workspace** — located at `C:\Users\aadit\Downloads\SMPL_python_v.1.1.0\smpl\models\basicmodel_m_lbs_10_207_0_v1.1.0.pkl` (licensed, not committed to git)

## Next Steps
1. **SHAPY regressor integration** — use SHAPY to generate synthetic training data (measurements → betas), train lightweight lookup table for accurate weight/measurement interactions
2. **Manual beta calibration** — run forward pass on known body shapes, measure outputs, tune coefficients (deferred, do after SHAPY)
3. **Garment shell on SMPL** — model garments on SMPL body with matching shape keys
4. **Female model** — swap SMPL model weights (female pickle available)
5. **Skin texture improvement** — proper UV mapping for SMPL topology
