# Session Handoff 008 — 2026-04-15

## Summary
Created and fully implemented 3 new specs addressing the accuracy gap identified in Session 007: 8-input-regression (42% MAE improvement), expanded-beta-pcs (configurable N PCs, buffer geometry updates), and shapy-polynomial-extraction (A2S TypeScript module, 4-tier routing). Total test count grew from 183 to 274.

## Chat Export Name
**"3 Specs: 8-Input Regression + Expanded Beta PCs + SHAPY A2S Extraction"**

## What Changed

### Spec 1: 8-Input Regression (fully implemented)
- Extended `smplRegressor.ts` with 3-way routing: 8-input → 4-input → heuristic
- Added `RegressionBlock` interface, `regression8` optional field in `CalibratedCoefficients`
- `loadCalibratedCoefficients()` accepts both v1.0.0 and v2.0.0 coefficient tables
- New `imputeMissingMeasurements()` for hybrid path (1-3 measurements + imputed rest)
- New `regress8Input()` with 11 normalized features + confidence scaling (0.7 for imputed)
- Refinement skip when 8-input model used with all 4 measurements
- Updated `train-beta-coefficients.py` with dual-model training and export
- v2.0.0 coefficient table: 6.7 KB, 8-input MAE 0.0428 vs 4-input 0.0741
- 22 new tests (unit, PBT, validation, comparison report)

### Spec 2: Expanded Beta PCs (fully implemented)
- `smplForwardPass.ts`: reads `shapeCount` from binary header, `SmplModelData.shapeCount` field
- `validateHeader()` accepts [1, 300] instead of requiring exactly 10
- `computeSmplVertices()` uses `Math.min(betas.length, model.shapeCount)`
- `smplRegressor.ts`: `activeShapeCount` module-level variable, `setActiveShapeCount()`/`getActiveShapeCount()`
- `lookupRegress()` returns `Float64Array(activeShapeCount)`, zero-padded beyond 10
- `applyPresetOffsets()`/`applyCompositionBias()` handle N-length betas
- New `extendVector()` helper
- New `subdivisionMapper.ts`: `SubdivisionMap` interface, `parseSubdivisionMap()`, `interpolateSubdivision()`, `loadSubdivisionMap()`
- `BodyModel.tsx`: buffer geometry update path for SMPL (replaces morph target driving), damped interpolation, subdivision map loading, base mesh fallback
- `export-smpl-assets.py`: `--num-shapes` CLI arg (10-50), binary version 2
- `generate-smpl-model.py`: `--no-morphs` flag
- `generate-subdivision-map.py`: new Blender script for barycentric mapping
- `train-beta-coefficients.py`: `--num-betas` CLI arg, N-length vectors
- `generate-shapy-data.py`: `--num-betas` CLI arg, N-length betas

### Spec 3: SHAPY Polynomial Extraction (fully implemented)
- New `src/utils/shapyA2S.ts`: `A2SMetadata`, `A2SNormalization`, `A2SCoefficients`, `A2SInputs` interfaces
- `loadA2SCoefficients()`, `isA2SAvailable()`, `hasAllA2SInputs()`, `computeA2SBetas()`
- `expandPolynomialFeatures()`: sklearn-style graded lexicographic order, degree 1-3
- `smplRegressor.ts`: 4-tier routing (A2S → 8-input → 4-input → heuristic)
- `RegressionPath` type + `getLastRegressionPath()` tracking
- A2S refinement skip in `computeSmplBetas()`
- `bodyEngine.ts`: `loadA2SCoefficients()` called during engine init
- New `scripts/extract-shapy-a2s.py`: full extraction + `--synthetic` fallback
- Synthetic A2S coefficients generated (4.4 KB, 120 validation pairs)

### New Files
- `src/utils/shapyA2S.ts`
- `src/utils/subdivisionMapper.ts`
- `src/data/shapy_a2s_coefficients.json`
- `public/data/shapy_a2s_coefficients.json`
- `scripts/extract-shapy-a2s.py`
- `scripts/generate-subdivision-map.py`
- `scripts/data/a2s_validation_pairs.json`
- `src/utils/__tests__/shapyA2S.test.ts` (31 tests)
- `src/utils/__tests__/shapyA2S.validation.test.ts` (5 tests)
- `src/utils/__tests__/shapyA2S.prop.test.ts` (7 tests)
- `src/utils/__tests__/subdivisionMapper.prop.test.ts` (3 tests)

### Test Results
- 274 passed, 7 failed (all pre-existing accuracy-threshold tests from Session 007)
- New tests: ~90 across all 3 specs

## Known Issues
- **Synthetic A2S coefficients**: Currently using synthetic coefficients generated from calibration dataset heuristics. Need real SHAPY checkpoint extraction for production accuracy.
- **Asset regeneration needed for >10 PCs**: The infrastructure supports N PCs but existing assets are still 10-PC. Run `export-smpl-assets.py --num-shapes 20` and `generate-subdivision-map.py` to activate.
- **7 pre-existing test failures**: Demographics-only round-trip accuracy tests (chest/waist/hip/inseam ≤5cm for ≥80%) — fundamental limitation of 4-input regression.

## Next Steps
1. **Extract real SHAPY A2S coefficients**: `python scripts/extract-shapy-a2s.py --checkpoint /path/to/a2s.pt --shapy-dir /path/to/shapy`
2. **Regenerate assets with 20+ PCs**: `export-smpl-assets.py --num-shapes 20`, `generate-smpl-model.py --no-morphs`, `generate-subdivision-map.py`
3. **Visual testing**: Verify SMPL body renders correctly with buffer geometry update path
4. **Female model**: SMPL female pickle available, swap model weights
5. **Shopify integration**: Phase 3 planning
