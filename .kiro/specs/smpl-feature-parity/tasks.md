# Implementation Plan: SMPL Feature Parity

## Overview

Bring the SMPL body engine to full feature parity with MakeHuman. The implementation follows the design's layered architecture: asset pipeline (negative morph targets), regressor enhancements (presets, composition, refinement), rendering/UI (heatmap wiring, measurements display, animation), and evaluation. Male-only focus for required tasks; female/gender groundwork is optional additive infrastructure.

## Tasks

- [x] 1. Add negative morph targets to Blender export script
  - [x] 1.1 Extend `scripts/generate-smpl-model.py` to generate paired positive/negative shape keys
    - Add a second loop that creates `Beta{i}Neg` shape keys using `shapedirs[:, :, pc_idx] * (-BETA_SCALE)` for each of the 10 PCs
    - Output GLB should have 21 shape keys total (Basis + 10 positive + 10 negative)
    - Log displacement stats for negative targets same as positive
    - _Requirements: 1.1, 1.5_
  - [x] 1.2 Regenerate the SMPL GLB with paired morph targets
    - Run the updated Blender script to produce `public/models/human-smpl.glb` with 20 beta shape keys
    - Verify file size stays under 120 MB
    - Verify shape key names match `Beta0`–`Beta9` and `Beta0Neg`–`Beta9Neg`
    - _Requirements: 1.1, 1.6_

- [x] 2. Implement paired morph target driving in BodyModel.tsx
  - [x] 2.1 Update SMPL morph target mapping to handle positive/negative pairs
    - Replace the current positive-only `Beta{i}` mapping with the paired logic from the design:
      - For `beta[i] >= 0`: `Beta{i}` influence = `beta[i] / 3.0` clamped [0,1], `Beta{i}Neg` = 0
      - For `beta[i] < 0`: `Beta{i}Neg` influence = `abs(beta[i]) / 3.0` clamped [0,1], `Beta{i}` = 0
    - Use regex `/^Beta(\d+)(Neg)?$/` to match morph target names
    - _Requirements: 1.2, 1.3_
  - [ ] 2.2 Write property test: Beta-to-influence mapping correctness (Property 1)
    - **Property 1: Beta-to-influence mapping correctness**
    - For any 10-element beta vector in [-3, 3], verify the influence mapping assigns correct values to positive and negative targets, and that exactly one of each pair is non-zero
    - Test file: `src/utils/__tests__/smplMorphMapping.prop.test.ts`
    - **Validates: Requirements 1.2, 1.3**

- [x] 3. Checkpoint — Verify negative morph targets render correctly
  - Ensure all tests pass, ask the user if questions arise.
  - Manually verify in the browser that selecting Slim body type produces a visibly thinner body than Average

- [x] 4. Implement layered beta computation in smplRegressor.ts
  - [x] 4.1 Add body type preset offset constants and `applyPresetOffsets()` function
    - Define `SMPL_PRESET_OFFSETS` record mapping each `BodyType` to a `Float64Array(10)` using the values from the design table
    - Implement `applyPresetOffsets(betas, bodyType)` that adds the preset vector element-wise
    - Average preset must be all zeros
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 4.2 Extract body composition bias into named `applyCompositionBias()` function
    - Define `COMPOSITION_BIAS` record mapping each `BodyComposition` to a `Float64Array(10)` using the design values
    - Extract the existing inline composition logic into `applyCompositionBias(betas, composition)` that adds the bias vector element-wise
    - Average composition must be all zeros
    - _Requirements: 7.1, 7.2, 7.4_
  - [x] 4.3 Implement `computeSmplBetas()` pipeline function
    - Create the main pipeline: `lookupRegress(inputs)` → `applyPresetOffsets(betas, bodyType)` → `applyCompositionBias(betas, composition)` → clamp to [-3, 3]
    - Accept `RegressorInputs` extended with `bodyType` field
    - Export as the new public API for beta computation
    - _Requirements: 2.1, 3.1, 7.4_
  - [ ]* 4.4 Add optional `gender` parameter groundwork to regressor
    - Ensure the regressor accepts gender and applies dimorphism bias (β3 shoulder-to-hip) — male: positive, female: negative
    - This is additive infrastructure; male path must remain unchanged
    - _Requirements: 2.4_
  - [x] 4.5 Write property test: Body type preset offsets are additive (Property 7)
    - **Property 7: Body type preset offsets are additive**
    - For any valid inputs and any preset, verify `computeSmplBetas(preset)` equals `computeSmplBetas(average) + preset_offset` before clamping
    - Test file: `src/utils/__tests__/smplRegressor.prop.test.ts`
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.7**
  - [x] 4.6 Write property test: Body composition bias is additive (Property 12)
    - **Property 12: Body composition bias is additive**
    - For any valid inputs and any composition, verify `computeSmplBetas(composition)` equals `computeSmplBetas(average) + composition_bias` before clamping and before custom measurement refinement
    - Test file: `src/utils/__tests__/smplRegressor.prop.test.ts`
    - **Validates: Requirements 7.4**
  - [x] 4.7 Write property test: Age effect on regressor (Property 6)
    - **Property 6: Age effect on regressor**
    - For any height/weight/gender (male), verify β1 and β5 at age=55 are >= values at age=25
    - Test file: `src/utils/__tests__/smplRegressor.prop.test.ts`
    - **Validates: Requirements 2.5**
  - [ ]* 4.8 Write property test: Gender dimorphism in regressor (Property 5) — OPTIONAL (female deferred)
    - **Property 5: Gender dimorphism in regressor**
    - For any height/weight/age, verify male β3 > female β3
    - Test file: `src/utils/__tests__/smplRegressor.prop.test.ts`
    - **Validates: Requirements 2.4**

- [x] 5. Implement custom measurement refinement loop
  - [x] 5.1 Add measurement-to-beta sensitivity map and `refineWithCustomMeasurements()` function
    - Define `MEASUREMENT_BETA_MAP` mapping bust→β6/β5, waist→β1/β5, hip→β7, inseam→β4 with sensitivity values from the design
    - Implement the iterative refinement loop (up to 5 iterations, 3cm tolerance, 0.3 learning rate)
    - Each iteration: forward pass → extract measurement → compute error → adjust relevant betas by `error * learningRate / sensitivity`
    - Return best-so-far betas if convergence not reached
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_
  - [x] 5.2 Wire refinement into `computeSmplBetas()` pipeline
    - After preset + composition layers, call `refineWithCustomMeasurements()` if any custom measurements are provided (bustCm, waistCm, hipCm, inseamCm are non-null)
    - When custom measurement is null/cleared, skip refinement for that measurement
    - Final clamp to [-3, 3] after refinement
    - _Requirements: 4.5, 4.6_
  - [x] 5.3 Write property test: Custom measurement refinement convergence (Property 8)
    - **Property 8: Custom measurement refinement convergence**
    - For any valid inputs and a single custom measurement (bust/waist/hip/inseam in realistic ranges), verify the extracted measurement is within 3cm of the target
    - Requires SMPL model binary; skip if unavailable
    - Test file: `src/utils/__tests__/smplRegressor.prop.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
  - [x] 5.4 Write property test: Clearing custom measurement reverts betas (Property 9)
    - **Property 9: Clearing custom measurement reverts betas**
    - For any valid inputs, verify betas with no custom measurements equal betas with custom measurement set to null
    - Test file: `src/utils/__tests__/smplRegressor.prop.test.ts`
    - **Validates: Requirements 4.5**
  - [x] 5.5 Write property test: Refinement preserves non-targeted betas (Property 10)
    - **Property 10: Refinement preserves non-targeted betas**
    - For any valid inputs and a single custom measurement, verify beta components NOT in the sensitivity map change by < 0.5
    - Requires SMPL model binary; skip if unavailable
    - Test file: `src/utils/__tests__/smplRegressor.prop.test.ts`
    - **Validates: Requirements 4.6**

- [x] 6. Update SmplEngine to use layered beta pipeline
  - [x] 6.1 Update `SmplEngine.update()` in `bodyEngine.ts` to call `computeSmplBetas()`
    - Replace the direct `this.regressor(inputs)` call with `computeSmplBetas(inputs, this.model)`
    - Pass `bodyType` from `UserInputs` into the regressor inputs
    - Store measurements in a field accessible to the store
    - _Requirements: 2.1, 3.1, 7.4_
  - [x] 6.2 Add `smplMeasurements` field to bodyStore.ts
    - Add `smplMeasurements: ExtractedMeasurements | null` and `setSmplMeasurements` action
    - Update BodyModel.tsx to write SMPL measurements to the store after each engine update
    - _Requirements: 6.1, 6.2_

- [x] 7. Checkpoint — Verify layered beta computation works end-to-end
  - Ensure all tests pass, ask the user if questions arise.
  - Verify in browser: changing body type preset visibly changes SMPL body shape, body composition selector produces distinct shapes

- [x] 8. Wire heatmap rendering to SMPL mesh
  - [x] 8.1 Add vertex color application for SMPL mesh in BodyModel.tsx heatmap useEffect
    - In the heatmap `useEffect`, when SMPL engine is active, read vertex positions and normals from the SMPL mesh geometry
    - Pass `normalXAbs` and `normalYAbs` to `getVertexFit()` for arm detection
    - Apply Laplacian smoothing (2 passes, weight 0.5) using `smoothColors()` from smoothingEngine
    - Set vertex color attribute on the SMPL mesh BufferGeometry
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 8.2 Implement skin material restore when heatmap is disabled
    - When heatmap is toggled off while SMPL engine is active, restore the `MeshPhysicalMaterial` with skin texture
    - _Requirements: 5.4_
  - [x] 8.3 Handle engine switch with heatmap enabled
    - When user switches between SMPL and MakeHuman with heatmap on, recompute and reapply heatmap colors for the newly active mesh
    - Clear adjacency cache on engine switch (different mesh topology)
    - _Requirements: 5.6_

- [x] 9. Wire estimated measurements display for SMPL mode
  - [x] 9.1 Update ControlPanel.tsx to pass SMPL measurements to `estimatedMeasurements()`
    - Subscribe to `smplMeasurements` from the store
    - Pass to `estimatedMeasurements(inputs, smplMeasurements)` in the `useMemo`
    - Display identical labels and formatting regardless of engine
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 9.2 Implement display rule for custom vs extracted measurements
    - When a custom measurement differs from the SMPL-extracted value by more than 3cm, display the SMPL-extracted value
    - BMI must be computed from height/weight inputs, not extracted from mesh
    - _Requirements: 6.4, 6.5_
  - [x] 9.3 Write property test: Display rule for custom vs extracted measurements (Property 11)
    - **Property 11: Display rule for custom vs extracted measurements**
    - For any custom measurement C and extracted measurement E where |C - E| > 3cm, verify the displayed value equals E
    - Test file: `src/utils/__tests__/smplDisplay.prop.test.ts`
    - **Validates: Requirements 6.4**

- [x] 10. Checkpoint — Verify heatmap and measurements display in SMPL mode
  - Ensure all tests pass, ask the user if questions arise.
  - Verify in browser: heatmap renders on SMPL mesh with correct coverage, estimated measurements panel shows SMPL-extracted values

- [x] 11. Implement smooth animated transitions for 20 morph targets
  - [x] 11.1 Extend animation system in BodyModel.tsx for paired morph targets
    - Update the `useFrame` loop to handle 20 morph targets (10 positive + 10 negative)
    - Apply exponential damping `current + (target - current) * (1 - exp(-speed * deltaTime))` with speed=10 (SMOOTH constant)
    - Cap deltaTime at 50ms (0.05s) to prevent jumps after tab-switch
    - Handle positive↔negative crossover: smoothly decrease outgoing target to 0 while increasing incoming target
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 11.2 Animate height scaling and width compensation for SMPL mode
    - Apply the same damping function to Y-scale and width compensation as MakeHuman mode
    - _Requirements: 8.5_
  - [x] 11.3 Write property test: Damping function convergence (Property 13)
    - **Property 13: Damping function convergence**
    - For any current value, target value, speed > 0, and deltaTime in (0, 0.05], verify `damp()` returns a value strictly between cur and tgt when cur ≠ tgt, and equal to tgt when cur = tgt
    - Test file: `src/utils/__tests__/smplMorphMapping.prop.test.ts`
    - **Validates: Requirements 8.1**
  - [x] 11.4 Write property test: Morph influence sum invariant during transitions (Property 14)
    - **Property 14: Morph influence sum invariant during transitions**
    - For any beta component transitioning from positive to negative, verify `influence(Beta{i}) + influence(Beta{i}Neg) <= 1.0` at every frame
    - Test file: `src/utils/__tests__/smplMorphMapping.prop.test.ts`
    - **Validates: Requirements 8.3**
  - [x] 11.5 Write property test: Forward pass mesh validity (Property 2)
    - **Property 2: Forward pass mesh validity**
    - For any 10-element beta vector in [-3, 3], verify the forward pass produces finite vertices, positive bounding box volume (maxY - minY > 0.5m), and no vertex > 3m from origin
    - Extend existing test file: `src/utils/__tests__/smplForwardPass.prop.test.ts`
    - **Validates: Requirements 1.4**

- [x] 12. Checkpoint — Verify smooth animations and all property tests
  - Ensure all tests pass, ask the user if questions arise.
  - Verify in browser: changing inputs produces smooth morph transitions, positive↔negative crossover is seamless

- [x] 13. Write engine migration evaluation document
  - [x] 13.1 Create evaluation document comparing SMPL vs MakeHuman
    - Create `.kiro/specs/smpl-feature-parity/evaluation.md`
    - Compare across: visual quality, measurement accuracy, file size, rendering performance, feature completeness
    - Include recommendation (keep dual engine, deprecate MakeHuman, or migrate to SMPL-only) with justification
    - Identify remaining MakeHuman-only capabilities (facial features, specific morph targets) and assess importance
    - If recommending SMPL-only migration, include a migration plan
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 14. Final checkpoint — Ensure all tests pass and feature is complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all 9 requirements are covered by implementation tasks
  - Confirm SMPL mode has feature parity with MakeHuman: body type presets, body composition, custom measurements, heatmap, estimated measurements, smooth animations

## Notes

- Only tasks 4.4 and 4.8 are optional (`*`) — these are female/gender groundwork that can be deferred
- All other tasks including all property-based tests are required
- Property tests for Properties 3, 4, 8, 10 require the SMPL model binary (`smpl_model.bin`) — skip with descriptive message if unavailable in CI
- Properties 1, 5, 6, 7, 9, 11, 12, 13, 14 can be tested with pure functions (no model binary needed)
- Task 1.2 (GLB regeneration) requires Blender installed at `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
