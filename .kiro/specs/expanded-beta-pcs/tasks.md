# Tasks: Expanded Beta PCs

## Task 1: Generalize Forward Pass to Read shapeCount from Binary Header

- [ ] 1.1 Add `shapeCount` field to `SmplModelData` interface in `smplForwardPass.ts`
- [ ] 1.2 Modify `parseSmplBinary()` to read `shapeCount` from header and use it for blend shape array allocation instead of hardcoded `SMPL_SHAPE_COUNT`
- [ ] 1.3 Modify `validateHeader()` to accept `shapeCount` in range [1, 300] instead of requiring exactly 10
- [ ] 1.4 Modify `computeSmplVertices()` to iterate over `Math.min(betas.length, model.shapeCount)` instead of `SMPL_SHAPE_COUNT`
- [ ] 1.5 Update `SMPL_SHAPE_COUNT` constant to be a default/reference value rather than a hard constraint, and add a comment noting it's the default
- [ ] 1.6 Verify existing tests pass with no behavioral change for 10-PC binaries

## Task 2: Property Tests — Forward Pass Generalization

- [ ] 2.1 [PBT] Binary parse round-trip: for random shapeCount N in [1, 50], construct synthetic binary, parse it, verify `model.shapeCount === N` and blend shape array length is `N × 6890 × 3`
- [ ] 2.2 [PBT] Forward pass min(betas, shapeCount): for random N-PC model and M-length betas, verify output matches manual `T + Σ(βᵢ × Sᵢ)` for `i = 0..min(N,M)-1`
- [ ] 2.3 [PBT] Backward compatibility: for random 10-element betas with 10-PC model, verify new code produces identical output (within 1e-6) to current implementation
- [ ] 2.4 [PBT] validateHeader accepts [1, 300], rejects 0 and 301+

## Task 3: Extend Regressor Output to N Betas

- [ ] 3.1 Add `activeShapeCount` module-level variable with `setActiveShapeCount()` and `getActiveShapeCount()` functions in `smplRegressor.ts`
- [ ] 3.2 Modify `lookupRegress()` to return `Float64Array(activeShapeCount)`, copying the base regression output (10 betas) into the first 10 slots and leaving the rest as 0.0
- [ ] 3.3 Modify `computeSmplBetas()` to produce `Float64Array(activeShapeCount)` through the full pipeline
- [ ] 3.4 Add `extendVector()` helper and modify `applyPresetOffsets()` and `applyCompositionBias()` to handle N-length betas by zero-extending the offset/bias vectors
- [ ] 3.5 Modify `refineWithCustomMeasurements()` to accept and return N-length betas without modifying indices beyond the sensitivity map range
- [ ] 3.6 Update `SmplEngine` constructor in `bodyEngine.ts` to call `setActiveShapeCount(model.shapeCount)` and allocate N-length betas

## Task 4: Property Tests — Regressor N-Length Output

- [ ] 4.1 [PBT] Regressor output length: for random inputs and activeShapeCount N in [10, 50], verify `computeSmplBetas()` returns Float64Array of length N with all elements finite and in [-3, 3]
- [ ] 4.2 [PBT] Zero-padding: when activeShapeCount > 10 and regression covers 10, verify betas[10..N-1] are exactly 0.0 (before and after preset/composition offsets)
- [ ] 4.3 [PBT] Preset/composition extension: verify extended vectors preserve first 10 values exactly and have 0.0 at indices 10..N-1

## Task 5: Checkpoint — Forward Pass + Regressor Generalization

- [ ] 5.1 Run full test suite, verify all existing tests pass
- [ ] 5.2 Verify the system still works end-to-end with the existing 10-PC binary (no behavioral change)

## Task 6: Create Subdivision Mapper Module

- [ ] 6.1 Create `src/utils/subdivisionMapper.ts` with `SubdivisionMap` interface, `parseSubdivisionMap()`, `loadSubdivisionMap()`, and `interpolateSubdivision()` functions
- [ ] 6.2 Implement `parseSubdivisionMap()` to read the binary format (header + per-vertex face index + barycentric coords)
- [ ] 6.3 Implement `interpolateSubdivision()` that computes `P = bary0 × V[f0] + bary1 × V[f1] + bary2 × V[f2]` for each subdivided vertex
- [ ] 6.4 Implement `loadSubdivisionMap()` with fetch + parse + error handling (returns null on failure)

## Task 7: Property Tests — Subdivision Mapper

- [ ] 7.1 [PBT] Barycentric weight sum: for random base vertex positions and a synthetic subdivision map, verify all barycentric weight triples sum to 1.0 within 1e-5
- [ ] 7.2 [PBT] Output finiteness: for random base vertex positions, verify all interpolated subdivided vertex coordinates are finite numbers
- [ ] 7.3 [PBT] Identity mapping: when a subdivided vertex has barycoords (1,0,0) pointing to face vertex 0, the interpolated position equals that base vertex position exactly

## Task 8: Modify BodyModel.tsx — Buffer Geometry Update Path

- [ ] 8.1 Add refs for target vertices, current (damped) vertices, and subdivision map
- [ ] 8.2 Load subdivision map on mount via `loadSubdivisionMap()`
- [ ] 8.3 In the SMPL input-change effect, compute target subdivided vertices via `interpolateSubdivision()` from SmplEngine's base vertices
- [ ] 8.4 In `useFrame`, implement damped interpolation from current to target vertices (same exponential damping as existing morph targets)
- [ ] 8.5 Write damped vertices to `geometry.attributes.position`, set `needsUpdate = true`, and call `geometry.computeVertexNormals()`
- [ ] 8.6 Remove the morph target driving code for SMPL mode (the `Beta0..Beta9` / `Beta0Neg..Beta9Neg` influence setting)
- [ ] 8.7 Keep MakeHuman morph target path unchanged for `makehuman-only` engine mode
- [ ] 8.8 Add fallback: if subdivision map is not loaded, render the 6,890-vertex base mesh directly by creating a new BufferGeometry from SmplEngine vertices and faces

## Task 9: Checkpoint — Buffer Update Rendering

- [ ] 9.1 Verify the SMPL body renders correctly with the buffer update path (visual check)
- [ ] 9.2 Verify smooth animation when changing inputs (damping works)
- [ ] 9.3 Verify MakeHuman engine mode still works with morph targets
- [ ] 9.4 Run full test suite

## Task 10: Update Export Script for N Blend Shapes

- [ ] 10.1 Add `--num-shapes` CLI argument to `export-smpl-assets.py` (default 10, range 10–50)
- [ ] 10.2 Replace `EXPECTED_SHAPE_COUNT = 10` with the CLI argument value
- [ ] 10.3 Modify `validate_smpl_data()` to check `shapedirs.shape[2] >= num_shapes`
- [ ] 10.4 Modify `export_smpl_model_bin()` to write `shapeCount = num_shapes` in header and export `num_shapes` blend shapes
- [ ] 10.5 Apply coordinate transform to all N blend shapes (not just first 10)
- [ ] 10.6 Bump binary version to 2 in the header
- [ ] 10.7 Add validation: exit with error if `num_shapes` is outside [10, 50] or exceeds pickle's available shape count

## Task 11: Update Blender Script — Add --no-morphs Flag

- [ ] 11.1 Add `--no-morphs` CLI flag to `generate-smpl-model.py`
- [ ] 11.2 When `--no-morphs` is set, skip shape key computation (steps 3 and 4) and export with `export_morph=False`
- [ ] 11.3 Verify A-pose, subdivision, UV unwrap, texture, and smooth shading still apply with `--no-morphs`
- [ ] 11.4 Verify existing `--num-shapes` behavior is unchanged when `--no-morphs` is not set

## Task 12: Create Subdivision Map Generator Script

- [ ] 12.1 Create `scripts/generate-subdivision-map.py` that loads SMPL base mesh, applies Catmull-Clark subdivision, and computes barycentric mapping
- [ ] 12.2 For each subdivided vertex, find the nearest base mesh face and compute barycentric coordinates
- [ ] 12.3 Export as `smpl_subdiv_map.bin` in the specified binary format (header + per-vertex data)
- [ ] 12.4 Print summary: vertex counts, file size, max barycentric error

## Task 13: Update Training Pipeline for N Betas

- [ ] 13.1 Add `--num-betas` CLI argument to `train-beta-coefficients.py` (default 10)
- [ ] 13.2 Modify `train_regression()` to train weights for N betas: `weights[N][7]`, `intercepts[N]`
- [ ] 13.3 Modify `compute_preset_offsets()` and `compute_composition_bias()` to produce N-length vectors
- [ ] 13.4 Modify `compute_sensitivity_map()` to analyze all N betas
- [ ] 13.5 Modify `compute_fat_distribution()` to produce N-length vectors
- [ ] 13.6 Add `numBetas` field to exported `calibrated_coefficients.json`
- [ ] 13.7 Validate that calibration dataset has at least N betas per entry

## Task 14: Update SHAPY Data Generation for N Betas

- [ ] 14.1 Add `--num-betas` CLI argument to `generate-shapy-data.py` (default 10)
- [ ] 14.2 Store full N-length betas in output dataset entries
- [ ] 14.3 Pad with 0.0 if SHAPY outputs fewer betas than requested, with warning
- [ ] 14.4 Add `numBetas` field to each dataset entry

## Task 15: Checkpoint — Full Pipeline Integration

- [ ] 15.1 Run full test suite including all new property tests
- [ ] 15.2 Verify backward compatibility: existing 10-PC binary + existing coefficients produce identical behavior
- [ ] 15.3 Document the asset regeneration commands for 20-PC and 50-PC configurations in README or script comments
