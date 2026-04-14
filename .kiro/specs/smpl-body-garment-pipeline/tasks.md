# Implementation Plan: SMPL Body & Garment Pipeline

## Overview

Implement SMPL as a refinement layer on top of the existing MakeHuman render engine. SMPL operates as a hidden "shape oracle" providing better morph target weights and garment binding reference. The MakeHuman mesh (214k vertices, skin texture, smooth animations) remains the primary render engine. All new code is TypeScript, running fully client-side. Offline Python/Blender scripts prepare SMPL model assets and garment binding maps.

## Tasks

- [x] 1. SMPL model binary format and forward pass
  - [x] 1.1 Create `src/utils/smplForwardPass.ts` with `SmplModelData` interface, `loadSmplModel()` binary parser, `computeSmplVertices()` forward pass (V = T + Σ(βᵢ × Sᵢ) on Float32Arrays), and `getSmplLandmark()` helper
    - Binary format: 16-byte header (magic 0x534D504C, version, vertexCount=6890, faceCount=13776, shapeCount=10, landmarkCount), followed by template vertices, shape blend shapes, face indices, joint regressor, landmark indices
    - Forward pass must complete in <100ms (target <5ms on typed arrays)
    - Output vertex positions in Y-up, Z-negative=front convention
    - Reject files with wrong magic number or unexpected dimensions
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 1.2 Write property test: SMPL forward pass topology and coordinate invariant (Property 1)
    - **Property 1: SMPL forward pass topology and coordinate invariant**
    - Generate random Float64Array(10) with components in [-3, 3], run forward pass, verify vertex count = 6890, face count = 13776, feet near Y=0, centroid near X=0/Z=0
    - **Validates: Requirements 1.2, 1.6**

  - [x] 1.3 Write property test: SMPL forward pass numerical equivalence (Property 2)
    - **Property 2: SMPL forward pass numerical equivalence**
    - Load pre-computed reference outputs (Python-generated fixtures), run TypeScript forward pass with same betas, verify per-component difference < 0.0001
    - **Validates: Requirements 3.3**

  - [x] 1.4 Write unit tests for SMPL model loader
    - Test valid binary parsing, truncated binary rejection, zero-beta produces template mesh
    - _Requirements: 1.1, 1.2_

- [x] 2. Checkpoint — Ensure SMPL forward pass tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Measurement-to-SMPL regression with body composition
  - [x] 3.1 Create `src/utils/smplRegressor.ts` with `SmplRegressorConfig`, `initSmplRegressor()`, `SmplRegressorFn`, `RegressorInputs` (including `bodyComposition?: 'athletic' | 'average' | 'heavy'`), and `BodyComposition` type
    - ONNX path: load `smpl_regressor.onnx` via onnxruntime-web, encode body composition as numeric (athletic=0, average=1, heavy=2), run inference → 10 betas
    - Lookup table fallback: precomputed grid with body composition dimension, interpolation
    - Body composition biases beta vector along muscular↔soft axis in SMPL shape space
    - Must complete regression within 50ms
    - Auto-fallback: try ONNX first, fall back to lookup table on failure
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 12.3_

  - [x] 3.2 Write property test: Regressor output dimensionality (Property 3)
    - **Property 3: Regressor output dimensionality**
    - Generate random valid inputs (height [140,210], weight [40,150], age [18,80], gender, bodyComposition), run regressor, verify output is Float64Array(10) with all finite values
    - **Validates: Requirements 2.1**

  - [x] 3.3 Write property test: Body composition produces distinct shapes (Property 11)
    - **Property 11: Body composition produces distinct shapes**
    - Generate random valid inputs, run regressor with bodyComposition='athletic' and 'heavy', verify L2 distance between beta vectors > 0.1
    - **Validates: Requirements 12.3, 12.4**

  - [x] 3.4 Write unit test: Regressor falls back to lookup table on ONNX failure
    - Mock ONNX failure, verify lookup table used, verify output still valid
    - _Requirements: 2.6_

- [x] 4. Measurement extraction from SMPL mesh
  - [x] 4.1 Create `src/utils/measurementExtractor.ts` with `ExtractedMeasurements` interface and `extractMeasurements()` function
    - Slice SMPL mesh at known anatomical heights using landmark vertex Y-coordinates
    - Compute perimeter of cross-section polygons for chest, waist, hip, shoulder, neck, bicep, thigh, calf, wrist circumferences
    - Use precomputed vertex indices per height band (SMPL fixed topology)
    - _Requirements: 2.5_

  - [x] 4.2 Write unit test: measurementExtractor produces reasonable values
    - Run on reference SMPL mesh (zero betas), verify chest/waist/hip in human range (60-140cm)
    - _Requirements: 2.5_

- [x] 5. Checkpoint — Ensure regressor and measurement extraction tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Binding map codec (serialization/deserialization)
  - [x] 6.1 Create `src/utils/bindingMapCodec.ts` with `BindingEntry`, `BindingMap` interfaces, `serializeBindingMap()`, `deserializeBindingMap()`, magic number 0x424D4150, version 1
    - Binary format: 10-byte header (magic uint32, version uint16, vertexCount uint32) + 20 bytes per vertex (faceIndex uint32, baryU/V/W float32, normalOffset float32)
    - Reject files with wrong magic number or unrecognized version with descriptive error
    - _Requirements: 9.1, 9.2, 9.4, 9.5_

  - [x] 6.2 Write property test: Binding map serialization round-trip (Property 4)
    - **Property 4: Binding map serialization round-trip**
    - Generate random BindingMap objects (vertex counts 1-5000, valid barycentric coords summing to ~1, finite normal offsets), serialize then deserialize, deep-equal check
    - **Validates: Requirements 9.3, 9.1, 9.2, 9.4**

  - [x] 6.3 Write property test: Invalid binding map format rejection (Property 5)
    - **Property 5: Invalid binding map format rejection**
    - Generate random ArrayBuffers with wrong magic bytes or invalid version numbers, verify deserializer throws descriptive error
    - **Validates: Requirements 9.5**

- [x] 7. Runtime garment deformation
  - [x] 7.1 Create `src/utils/garmentDeformer.ts` with `deformGarment()` and `computeSmplNormals()` functions
    - For each garment vertex: look up bound SMPL triangle from binding map, interpolate position via barycentric coords, interpolate normal, offset along normal by normalOffset
    - Handle degenerate triangle fallback (nearest-vertex position + normal offset)
    - Must complete deformation for up to 10k vertices within 16ms
    - Write to output Float32Array in place (zero-allocation)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.2 Write property test: Barycentric garment deformation correctness (Property 6)
    - **Property 6: Barycentric garment deformation correctness**
    - Generate random SMPL vertices, random binding entries with valid barycentric coords on non-degenerate triangles, run deformer, verify output matches manual barycentric interpolation + normal offset
    - **Validates: Requirements 6.1, 6.4**

  - [x] 7.3 Write property test: Garment non-interpenetration (Property 7)
    - **Property 7: Garment non-interpenetration**
    - Generate random betas in [-3, 3], compute SMPL mesh, run deformation with reference binding map, verify all garment vertices have positive signed distance from body surface
    - **Validates: Requirements 6.6**

  - [x] 7.4 Write property test: Binding map validation catches degenerate entries (Property 9)
    - **Property 9: Binding map validation catches degenerate entries**
    - Generate random binding maps with mix of valid and invalid entries (degenerate triangles, invalid barycentric coords), run validation, verify invalid entries detected
    - **Validates: Requirements 5.5**

  - [x] 7.5 Write unit test: Garment deformer handles degenerate triangle fallback
    - Create binding with zero-area triangle, verify nearest-vertex fallback used
    - _Requirements: 6.5_

- [x] 8. Checkpoint — Ensure binding map and garment deformation tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Body engine abstraction and store updates
  - [x] 9.1 Add `bodyComposition` field to `UserInputs` in `src/stores/bodyStore.ts` with type `'athletic' | 'average' | 'heavy'`, default `'average'`
    - Add `bodyEngine` field to store: `'smpl-refined' | 'makehuman-only'`, default `'smpl-refined'`
    - Add setter `setBodyComposition` and `setBodyEngine`
    - Preserve all inputs (including bodyComposition) when switching engines
    - _Requirements: 11.2, 11.3, 12.2, 12.5, 12.7_

  - [x] 9.2 Create Body_Engine TypeScript interface in `src/utils/bodyEngine.ts` with methods: `getVertexPositions()`, `getNormals()`, `getFaces()`, `getVertexCount()`, `getLandmark()`, `update()`
    - Implement SMPL engine (uses smplForwardPass + smplRegressor + measurementExtractor)
    - Implement MakeHuman engine wrapper (delegates to existing morph target system)
    - Engine selection based on config flag and asset availability
    - Emit mesh-updated event after each update() call
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 9.3 Write property test: User input preservation across engine switch (Property 10)
    - **Property 10: User input preservation across engine switch**
    - Generate random UserInputs (including bodyComposition), set in store, switch engine flag, verify all inputs unchanged
    - **Validates: Requirements 11.3, 12.7**

- [x] 10. Enhance morphMapper with SMPL refinement and body composition
  - [x] 10.1 Update `src/utils/morphMapper.ts` `inputsToMorphs()` to accept optional `smplMeasurements` parameter
    - When smplMeasurements provided, use those values for chest/waist/hip/etc. instead of ANSUR II lookup
    - In MakeHuman-only mode, map bodyComposition to existing morph modifiers (athletic → more Muscular/WiderShoulders, heavy → more Heavier/BiggerStomach)
    - Z-score computation and morph weight mapping logic unchanged
    - _Requirements: 2.5, 12.6_

  - [x] 10.2 Write property test: Fit score algorithm invariance across engines (Property 8)
    - **Property 8: Fit score algorithm invariance across engines**
    - Generate random body measurements and garment measurements, compute fit scores, verify result depends only on measurements and fit preference, not engine source
    - **Validates: Requirements 8.2**

- [x] 11. Checkpoint — Ensure body engine and morphMapper tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. ControlPanel UI updates
  - [x] 12.1 Add body composition selector to `src/components/UI/ControlPanel.tsx`
    - Three-option selector: Athletic, Average, Heavy/Soft — styled as button group (same pattern as existing body type selector)
    - Default to "Average", visible in both SMPL and MakeHuman modes
    - Wire to bodyStore `setBodyComposition`
    - _Requirements: 12.1, 12.5, 12.6_

  - [x] 12.2 Add body engine toggle to ControlPanel
    - Toggle between 'smpl-refined' and 'makehuman-only' modes
    - When SMPL active: hide morph target override sliders, show SMPL beta parameter info
    - When MakeHuman active: show existing morph sliders
    - _Requirements: 11.5_

- [x] 13. Heatmap adaptation for SMPL body
  - [x] 13.1 Update `src/utils/heatmapEngine.ts` to support SMPL vertex landmark-based coverage
    - When SMPL engine active, use vertex landmark positions for anatomical region mapping instead of normalized height heuristics
    - Preserve existing arm detection logic (armScore) adapted to SMPL vertex normals
    - Fit score algorithm unchanged (ease = garment - body, scored against ease targets)
    - Support heatmap on garment mesh vertices when garment shell loaded
    - Laplacian smoothing (2 passes, weight 0.5) consistent with current approach
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 14. Garment material and rendering upgrades
  - [x] 14.1 Update garment material in `src/components/GarmentShell.tsx`
    - Replace semi-transparent POC material with opaque MeshPhysicalMaterial
    - Cotton appearance for tee/oxford: roughness 0.8, sheen 0.05-0.15, optional fabric normal map
    - Denim appearance for jeans: roughness 0.9, no sheen, optional denim weave normal map
    - Double-sided faces, depth write enabled
    - Heatmap blend: 0.7 heatmap + 0.3 fabric when heatmap enabled
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 15. Garment registry and asset loading
  - [x] 15.1 Create `src/utils/garmentRegistry.ts` with `GarmentRegistryEntry` interface and static registry array
    - List all garment templates with type, label, sizes, GLB path, binding map path
    - Expose available garment types/sizes to UI
    - Handle load failures gracefully (mark unavailable, log warning)
    - Support adding new garments by editing registry array only
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 16. GarmentShell integration with binding-based deformation
  - [x] 16.1 Update `src/components/GarmentShell.tsx` to use `GarmentDeformer` with binding maps
    - Load garment GLB (template mesh, no morph targets) + binding map binary
    - Each frame: call `deformGarment()` with current SMPL vertices → update garment BufferGeometry positions
    - Fall back to existing morph-sync approach if binding map not available (backward compatible)
    - Subscribe to Body_Engine mesh-updated events for recomputation
    - _Requirements: 6.1, 6.2, 6.3, 11.6_

- [x] 17. Checkpoint — Ensure all runtime integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. BodyModel SMPL refinement hook
  - [x] 18.1 Update `src/components/BodyModel.tsx` to use SMPL refinement when available
    - On mount or input change: if SMPL available, run pipeline (regressor → forward pass → measurement extraction), pass refined measurements to `inputsToMorphs()`
    - If SMPL not available, fall back to existing ANSUR II path (no visible change)
    - MakeHuman mesh, skin texture, morph animation, heatmap vertex coloring — all unchanged
    - Pass bodyComposition from store to regressor inputs
    - _Requirements: 2.4, 2.5, 2.6, 11.1, 12.3_

- [x] 19. Transition and backward compatibility wiring
  - [x] 19.1 Implement graceful degradation hierarchy
    - Full SMPL pipeline → SMPL without ONNX (lookup table) → MakeHuman-only → No garment assets
    - Default to MakeHuman when SMPL assets not yet available
    - Preserve user inputs when switching engines
    - Existing heatmap, fit advisor, size chart, control panel work with both engines
    - Reload garment assets compatible with active engine on switch
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_

- [x] 20. Offline scripts: SMPL model export
  - [x] 20.1 Create `scripts/export-smpl-assets.py`
    - Convert SMPL model (NumPy/pickle) to `smpl_model.bin` (typed arrays in binary blob with header)
    - Export measurement-to-beta regression model to `smpl_regressor.onnx` via PyTorch/ONNX
    - Generate `smpl_landmarks.json` (vertex index → anatomical landmark name)
    - Generate `smpl_to_makehuman.bin` (nearest-vertex correspondence map)
    - Validate shapes before export, combined bundle under 15MB gzipped
    - Include body composition encoding in regression model training data
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 21. Offline scripts: Garment binding baking
  - [x] 21.1 Create `scripts/bake-garment-bindings.py`
    - Load SMPL model in neutral pose, load garment mesh
    - For each garment vertex: find nearest SMPL triangle via BVH, compute barycentric coords (u,v,w), compute normal offset
    - Validate: no degenerate triangles (area < 0.0001 m²), all vertices bound
    - Export binding map as `.binding.bin`, garment mesh as GLB (geometry only)
    - Support garment types: T-Shirt, Oxford Shirt, Slim Jeans, Straight Jeans (one template per type per size)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 22. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- SMPL sits ON TOP of MakeHuman as a refinement layer — MakeHuman always renders, SMPL is the hidden shape oracle
- Body composition (athletic/average/heavy) is a new high-impact input that helps distinguish muscular vs soft bodies at the same weight
- The existing fully client-side architecture is preserved throughout
