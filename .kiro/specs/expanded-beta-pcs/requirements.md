# Requirements Document: Expanded Beta PCs

## Introduction

The SMPL body model supports 300 principal components (PCs/betas) for body shape, but the current system hardcodes 10 PCs throughout the pipeline — binary export, forward pass, regressor, morph targets, and training scripts. The first 10 PCs explain ~95% of body shape variance, but PCs 11–50 capture important details like limb proportions, torso shape, and subtle body type differences that matter for clothing fit accuracy.

This feature makes the PC count configurable (default 10, expandable to 20, 30, or 50) and addresses the critical GLB file size constraint: with 165k subdivided vertices, each additional morph target pair adds ~4 MB to the GLB, making 100 shape keys (~470 MB) infeasible for a web app. The recommended approach eliminates GLB morph target dependency for SMPL shape by computing vertex positions entirely via the binary forward pass and updating Three.js geometry buffers directly.

## Glossary

- **PC (Principal Component)**: A statistical shape direction from PCA decomposition of 3D body scans. Also called a "beta" when referring to the scalar coefficient.
- **Beta**: A scalar coefficient multiplying a shape PC. `betas[i]` scales the i-th shape blend shape.
- **Shape_Blend_Shape**: A per-vertex displacement vector (6890×3 floats) representing one PC direction in SMPL's shape space.
- **Forward_Pass**: The computation `V = T + Σ(βᵢ × Sᵢ)` that produces mesh vertex positions from template vertices, betas, and blend shapes.
- **SMPL_Binary**: The `smpl_model.bin` file containing template vertices, shape blend shapes, face indices, joint regressor, and landmarks.
- **GLB_Model**: The `human-smpl.glb` file containing the subdivided mesh with morph targets for Three.js rendering.
- **Morph_Target**: A GLB shape key representing a positive or negative beta direction at a specific scale. Currently 2 per PC (positive + negative).
- **Export_Script**: `scripts/export-smpl-assets.py` — converts SMPL pickle to browser binary format.
- **Blender_Script**: `scripts/generate-smpl-model.py` — generates the subdivided GLB with morph targets.
- **Regressor**: `src/utils/smplRegressor.ts` — maps user measurements to beta coefficients.
- **Training_Script**: `scripts/train-beta-coefficients.py` — fits regression coefficients from calibration data.
- **Calibration_Dataset**: `scripts/data/calibration_dataset.json` — (measurements, betas) pairs from SHAPY.
- **SmplEngine**: The runtime body engine class that orchestrates regressor → forward pass → measurement extraction.
- **BodyModel_Component**: `src/components/BodyModel.tsx` — React/Three.js component that renders the body mesh.
- **Buffer_Geometry_Update**: Directly writing vertex positions into a Three.js `BufferGeometry.attributes.position` array, bypassing morph targets.
- **N_PCs**: The configurable number of principal components (10, 20, 30, or 50).

## Requirements

### Requirement 1: Configurable PC Count Constant

**User Story:** As a developer, I want the number of shape PCs to be a single configurable constant, so that I can change the PC count in one place and have it propagate through the entire pipeline.

#### Acceptance Criteria

1. THE Export_Script SHALL read the PC count from a `--num-shapes` CLI argument with a default value of 10.
2. THE SMPL_Binary header `shapeCount` field SHALL store the actual number of exported PCs rather than a hardcoded value of 10.
3. THE Forward_Pass SHALL read `shapeCount` from the binary header and use that value to determine the number of blend shapes to sum, rather than using the hardcoded constant `SMPL_SHAPE_COUNT = 10`.
4. THE Blender_Script SHALL read the PC count from a `--num-shapes` CLI argument with a default value of 10.
5. WHEN the `--num-shapes` argument is set to a value between 10 and 50 inclusive, THE Export_Script SHALL export exactly that many shape blend shapes to the SMPL_Binary.
6. WHEN the `--num-shapes` argument is set to a value outside the range 10–50, THE Export_Script SHALL exit with an error message specifying the valid range.

### Requirement 2: SMPL Binary Format Extension

**User Story:** As a developer, I want the SMPL binary to support N shape blend shapes, so that the forward pass can use more PCs for finer body shape detail.

#### Acceptance Criteria

1. THE Export_Script SHALL write `shapeCount = N` in the binary header where N is the configured PC count.
2. THE Export_Script SHALL write `Float32[N × 6890 × 3]` shape blend shape data after the template vertices section.
3. THE Export_Script SHALL apply the same Y-up coordinate transform to all N blend shapes, not only the first 10.
4. WHEN the SMPL pickle contains fewer shape directions than the configured N, THE Export_Script SHALL exit with an error message stating the available count and the requested count.
5. THE SMPL_Binary file size for 20 PCs SHALL be less than 4 MB, and for 50 PCs SHALL be less than 10 MB.

### Requirement 3: Forward Pass Generalization

**User Story:** As a developer, I want the forward pass to work with any number of PCs stored in the binary, so that loading a 20-PC or 50-PC binary produces correct vertex positions.

#### Acceptance Criteria

1. THE Forward_Pass `parseSmplBinary()` function SHALL read `shapeCount` from the binary header and allocate the shape blend shape array with `shapeCount × 6890 × 3` floats.
2. THE Forward_Pass `computeSmplVertices()` function SHALL iterate over `min(betas.length, model.shapeCount)` blend shapes when accumulating shape contributions, where `model.shapeCount` is read from the parsed binary.
3. THE Forward_Pass SHALL expose `shapeCount` as a field on the `SmplModelData` interface.
4. THE Forward_Pass `validateHeader()` function SHALL accept any `shapeCount` value between 1 and 300 inclusive, rather than requiring exactly 10.
5. WHEN a betas array of length 10 is passed to `computeSmplVertices()` with a 20-PC model, THE Forward_Pass SHALL use only the first 10 blend shapes and produce valid vertex positions.
6. WHEN a betas array of length 20 is passed to `computeSmplVertices()` with a 20-PC model, THE Forward_Pass SHALL use all 20 blend shapes.

### Requirement 4: Regressor Output Extension

**User Story:** As a developer, I want the regressor to output N betas instead of 10, so that the forward pass can use all available PCs for body shape.

#### Acceptance Criteria

1. THE Regressor `lookupRegress()` function SHALL return a `Float64Array` of length N_PCs, where N_PCs matches the loaded SMPL_Binary's `shapeCount`.
2. WHEN the Regressor has regression weights for only 10 betas and the model has 20 PCs, THE Regressor SHALL set betas 10–19 to 0.0.
3. THE Regressor `computeSmplBetas()` function SHALL produce a `Float64Array` whose length matches the loaded model's `shapeCount`.
4. THE Regressor `SMPL_PRESET_OFFSETS` vectors SHALL be extended to length N_PCs, with values beyond the original 10 set to 0.0.
5. THE Regressor `COMPOSITION_BIAS` vectors SHALL be extended to length N_PCs, with values beyond the original 10 set to 0.0.
6. THE Regressor `refineWithCustomMeasurements()` function SHALL operate on the full N-length beta vector without modifying betas beyond the indices covered by the sensitivity map.

### Requirement 5: Eliminate GLB Morph Target Dependency for SMPL Shape

**User Story:** As a developer, I want the SMPL body shape to be driven entirely by the binary forward pass with direct geometry buffer updates, so that the GLB file size does not grow with the number of PCs.

#### Acceptance Criteria

1. THE BodyModel_Component SHALL update the Three.js mesh geometry positions directly from the SmplEngine's computed vertex positions, rather than driving GLB morph target influences for SMPL shape.
2. THE BodyModel_Component SHALL call `geometry.attributes.position.needsUpdate = true` after writing new vertex positions to trigger Three.js re-rendering.
3. THE BodyModel_Component SHALL recompute vertex normals after updating positions, either via `geometry.computeVertexNormals()` or the existing `computeSmplNormals()` utility.
4. THE GLB_Model SHALL contain only the subdivided base mesh geometry (Basis shape) without any Beta shape keys, reducing file size to approximately the base mesh size.
5. WHEN the SmplEngine updates vertex positions, THE BodyModel_Component SHALL interpolate between the current and target positions using the existing damping function to maintain smooth animation.
6. THE BodyModel_Component SHALL update vertex positions at the frame rate (via `useFrame`), reading the latest positions from SmplEngine on each frame.

### Requirement 6: Blender Script — Base Mesh Only GLB

**User Story:** As a developer, I want the Blender script to generate a GLB with only the base mesh (no morph targets), so that the GLB file size stays small regardless of PC count.

#### Acceptance Criteria

1. THE Blender_Script SHALL support a `--no-morphs` flag that exports the GLB with only the Basis mesh and no shape keys.
2. WHEN `--no-morphs` is specified, THE Blender_Script SHALL skip shape key computation and export, reducing generation time.
3. WHEN `--no-morphs` is specified, THE exported GLB file size SHALL be less than 15 MB for a 2-level subdivided mesh.
4. THE Blender_Script SHALL retain the existing `--num-shapes` behavior when `--no-morphs` is not specified, for backward compatibility.
5. THE Blender_Script SHALL still apply the A-pose, UV unwrap, texture, and smooth shading when `--no-morphs` is specified.

### Requirement 7: Vertex Mapping Between Subdivided GLB and Base SMPL Mesh

**User Story:** As a developer, I want to map the 6,890 SMPL base vertices to the ~165k subdivided GLB vertices, so that the forward pass output can drive the high-resolution display mesh.

#### Acceptance Criteria

1. THE system SHALL include a precomputed mapping from each of the ~165k subdivided vertices to barycentric coordinates on the 6,890-vertex base mesh.
2. THE mapping SHALL be stored as a binary asset loadable at runtime, with a file size less than 5 MB.
3. THE BodyModel_Component SHALL use the mapping to interpolate forward pass vertex positions onto the subdivided mesh at each frame update.
4. WHEN the mapping asset is not available, THE BodyModel_Component SHALL fall back to rendering the 6,890-vertex base mesh directly from the SMPL_Binary.
5. IF the mapping asset fails to load, THEN THE system SHALL log a warning and continue with the low-resolution fallback without crashing.
6. THE interpolated subdivided vertex positions SHALL produce a visually smooth mesh equivalent to the current morph-target-driven mesh.

### Requirement 8: Training Pipeline Extension

**User Story:** As a developer, I want the training pipeline to produce regression coefficients for N betas, so that the regressor can predict higher-order PCs when calibration data is available.

#### Acceptance Criteria

1. THE Training_Script SHALL accept a `--num-betas` CLI argument specifying how many beta components to train regression weights for, with a default of 10.
2. WHEN the Calibration_Dataset contains betas of length M and `--num-betas` is set to N where N ≤ M, THE Training_Script SHALL train regression weights for all N beta components.
3. WHEN the Calibration_Dataset contains betas of length M and `--num-betas` is set to N where N > M, THE Training_Script SHALL exit with an error message stating that the dataset has only M betas.
4. THE Training_Script SHALL export the `regression.weights` array with dimensions `[N][7]` and `regression.intercepts` array with length N.
5. THE exported `calibrated_coefficients.json` SHALL include a `numBetas` field indicating how many beta components the regression covers.

### Requirement 9: Calibration Dataset Regeneration

**User Story:** As a developer, I want to regenerate the calibration dataset with more than 10 betas from SHAPY, so that the training pipeline has ground truth for higher-order PCs.

#### Acceptance Criteria

1. THE SHAPY data generation script SHALL accept a `--num-betas` CLI argument specifying how many beta components to request from SHAPY's A2S model, with a default of 10.
2. WHEN SHAPY's A2S model supports outputting N betas, THE generation script SHALL store all N beta values per calibration entry.
3. WHEN SHAPY's A2S model outputs fewer betas than requested, THE generation script SHALL pad the remaining betas with 0.0 and log a warning.
4. THE Calibration_Dataset entries SHALL include a `numBetas` field indicating the length of the betas array.

### Requirement 10: Backward Compatibility

**User Story:** As a developer, I want the system to work correctly with both 10-PC and N-PC binaries, so that existing assets continue to function during the transition.

#### Acceptance Criteria

1. WHEN a 10-PC SMPL_Binary is loaded, THE Forward_Pass SHALL produce identical vertex positions to the current implementation for the same 10-element betas input.
2. WHEN a 10-PC SMPL_Binary is loaded, THE Regressor SHALL output a 10-element `Float64Array`, matching the current behavior.
3. WHEN the `calibrated_coefficients.json` contains regression weights for 10 betas and the model has 20 PCs, THE Regressor SHALL set betas 10–19 to 0.0.
4. WHEN the BodyModel_Component receives a SmplEngine with a 10-PC model, THE BodyModel_Component SHALL render correctly using the buffer update path.
5. THE system SHALL not require regenerating the GLB or SMPL_Binary to continue functioning with the existing 10-PC assets.

### Requirement 11: Performance Constraints

**User Story:** As a developer, I want the expanded PC system to maintain interactive frame rates, so that the user experience is not degraded.

#### Acceptance Criteria

1. THE Forward_Pass `computeSmplVertices()` with 50 PCs and 6,890 vertices SHALL complete in less than 5 milliseconds on a mid-range desktop CPU.
2. THE vertex interpolation from 6,890 base vertices to ~165k subdivided vertices SHALL complete in less than 10 milliseconds per frame.
3. THE combined forward pass + interpolation + buffer update cycle SHALL maintain at least 30 frames per second on a mid-range desktop GPU.
4. THE SMPL_Binary for 50 PCs SHALL be less than 10 MB uncompressed and less than 5 MB gzip-compressed.
5. THE initial page load SHALL not increase by more than 5 seconds when using a 50-PC binary compared to the current 10-PC binary, assuming a 10 Mbps connection.
