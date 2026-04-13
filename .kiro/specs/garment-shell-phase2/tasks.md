# Implementation Plan: Garment Shell Phase 2

## Overview

Add 3D garment shell meshes to the body editor platform. Implementation proceeds in four phases: (1) size chart engine with validation and serialization, (2) Blender pipeline for baking garment GLBs with cloth simulation and morph targets, (3) runtime GarmentShell component for loading/rendering garments with morph sync, and (4) integration — wiring heatmap transfer, store extensions, and scene composition. TypeScript for runtime code, Python for Blender scripts.

## Tasks

- [ ] 1. Implement size chart engine foundation
  - [ ] 1.1 Create `src/utils/sizeChartEngine.ts` with interfaces and validation
    - Define and export `BrandSizeChart`, `SizeMeasurements` interfaces matching design
    - Define `REQUIRED_MEASUREMENTS` record mapping each garment type to its required measurement keys (tee: chest/waist/shoulder, oxford: +neck, jeans: waist/hip/thigh/inseam)
    - Implement `validateBrandSizeChart(chart)` returning string[] of errors: check brand non-empty, garmentType is known, sizes has ≥1 entry, required measurements present per garment type, all values positive finite numbers
    - Implement `parseBrandSizeChart(json)` that JSON.parses and validates, throwing on invalid
    - Implement `stringifyBrandSizeChart(chart)` that serializes to JSON string
    - Implement `getActiveSizeChart(garmentType, brandChart?)` that returns brand measurements if valid, else falls back to default chart data
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.1, 9.2_

  - [ ] 1.2 Create `src/data/defaultSizeCharts.ts` with extracted default size chart data
    - Extract the existing size chart data from `heatmapEngine.ts` garments object into a standalone module
    - Export as typed records that `sizeChartEngine.ts` and `heatmapEngine.ts` can both import
    - Keep the same measurement values (chest, waist, hip, shoulder, neck, bicep, thigh, calf, inseam, wrist per garment type and size)
    - _Requirements: 7.4_

  - [ ]* 1.3 Write property test: size chart validation correctness
    - **Property 1: Size chart validation correctness**
    - Generate random `BrandSizeChart` objects — mix of valid (all fields correct) and invalid (missing fields, negative values, unknown garment types, empty brand, empty sizes)
    - Assert `validateBrandSizeChart()` returns empty array iff all conditions met, non-empty otherwise
    - Minimum 100 iterations
    - **Validates: Requirements 7.2, 7.6**

  - [ ]* 1.4 Write property test: size chart serialization round-trip
    - **Property 2: Serialization round-trip**
    - Generate random valid `BrandSizeChart` objects with random brand names, garment types, size labels, and positive measurement values
    - Assert `parseBrandSizeChart(stringifyBrandSizeChart(chart))` deep-equals original chart
    - Minimum 100 iterations
    - **Validates: Requirements 9.3, 9.4**

  - [ ]* 1.5 Write unit tests for size chart engine edge cases
    - Test `parseBrandSizeChart` with known valid JSON → expected object
    - Test `parseBrandSizeChart` throws on malformed JSON
    - Test `validateBrandSizeChart` rejects empty brand string
    - Test `validateBrandSizeChart` rejects unknown garment type
    - Test `validateBrandSizeChart` rejects missing required measurements
    - Test `validateBrandSizeChart` rejects negative/NaN/Infinity measurement values
    - Test `getActiveSizeChart` returns default when no brand chart provided
    - Test `getActiveSizeChart` returns brand data when valid chart provided
    - Test `stringifyBrandSizeChart` produces valid JSON
    - _Requirements: 7.2, 7.3, 7.4, 7.6, 9.1, 9.2_

- [ ] 2. Checkpoint — Size chart engine complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Implement Blender garment baking pipeline
  - [ ] 3.1 Create `scripts/bake-garments.py` with CLI argument parsing and body import
    - Parse CLI args: `--types` (comma-separated garment types, default all four), `--sizes` (comma-separated sizes, default all), `--body` (FBX path, default `public/models/male-base.fbx`), `--out` (output dir, default `public/models/garments/`)
    - Import body FBX, apply -90° X rotation fix (same as `generate-morphs.py`)
    - Create output directory with `os.makedirs(out_dir, exist_ok=True)`
    - Set up body mesh as collision object for cloth simulation
    - Log progress for each step
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 8.1, 8.4_

  - [ ] 3.2 Implement parametric garment pattern creation in `scripts/bake-garments.py`
    - Create `create_garment_pattern(garment_type, size_measurements)` function
    - **Tee**: Tubular torso mesh from chest circumference, short sleeve cylinders (~15cm from shoulder), round neckline cutout, hem at normalized height 0.44
    - **Oxford**: Tubular torso mesh, long sleeve cylinders to wrist, collar neckline, hem at 0.44
    - **Slim Jeans**: Two tapered leg tubes joined at waist with waistband, hip-to-narrow-ankle taper
    - **Straight Jeans**: Two leg tubes joined at waist, consistent width knee-to-ankle
    - Position pattern mesh with 0.005m offset from body surface
    - Derive dimensions from size chart: radius = chest_cm / (2π × 100), all in Blender meters
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ] 3.3 Implement cloth simulation and morph target baking in `scripts/bake-garments.py`
    - Pin anchor vertices (shoulder seams for tops, waistband for jeans)
    - Configure cloth physics: cotton weight 0.3 kg/m², structural stiffness 15–40, bending stiffness 0.5–5.0
    - Run cloth simulation (~100 frames), bake final frame as basis shape key
    - Verify no interpenetration; push violating vertices outward along body normal by 0.003m minimum
    - For each body morph variant (Heavier, Thinner, WiderShoulders, WiderHips, BiggerChest, BiggerStomach, ThickerThighs, ThickerCalves at 100%): apply morph to body, re-run cloth sim, store as garment shape key with same name, apply 4-pass Laplacian smoothing, reset body morph
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3_

  - [ ] 3.4 Implement GLB export in `scripts/bake-garments.py`
    - Export each garment as GLB: morph targets enabled, morph normals disabled, Y-up, same orientation settings as `generate-morphs.py`
    - File naming: `garment-{type}-{size}.glb`
    - Output to `public/models/garments/` directory
    - Log vertex count, morph target count, export path per garment-size
    - Overwrite existing files
    - _Requirements: 3.4, 3.5, 8.1, 8.4, 10.2, 10.3, 10.4, 10.5_

- [ ] 4. Checkpoint — Blender pipeline complete
  - Run `bake-garments.py` for at least one garment-size (e.g., tee M) and verify GLB output exists with morph targets. Ask the user if questions arise.

- [ ] 5. Extend bodyStore and modify heatmapEngine for garment shell support
  - [ ] 5.1 Add garment shell state to `src/stores/bodyStore.ts`
    - Add `brandSizeChart: BrandSizeChart | null` field (default null)
    - Add `setBrandSizeChart: (chart: BrandSizeChart | null) => void` action
    - Add `currentMorphInfluences: Record<string, number>` field (default empty object)
    - Add `setCurrentMorphInfluences: (influences: Record<string, number>) => void` action
    - Import `BrandSizeChart` type from `sizeChartEngine.ts`
    - _Requirements: 7.3, 7.4_

  - [ ] 5.2 Add `sizeChartOverride` parameter to `computeHeatmap()` in `src/utils/heatmapEngine.ts`
    - Add optional `sizeChartOverride?: Record<string, number> | null` parameter
    - When provided, use `sizeChartOverride` measurements instead of built-in `garments[type].sizes[size]`
    - `getVertexFit()` logic remains unchanged — it works on normalized positions regardless of source
    - _Requirements: 7.3_

- [ ] 6. Implement GarmentShell runtime component
  - [ ] 6.1 Create `src/components/GarmentShell.tsx` with GLB loading and morph sync
    - Load `garment-{type}-{size}.glb` via `useGLTF` based on store's `garmentType` and `garmentSize`
    - Read garment mesh's `morphTargetDictionary`, map names to body morph names
    - Each frame: `damp()` garment morph influences toward `bodyStore.currentMorphInfluences` (same SMOOTH=10 constant as BodyModel)
    - Scale garment group to match body group scale (height × width compensation from store)
    - On garment/size change: dispose previous GLB resources, load new one
    - On load failure: `console.warn()`, render nothing (body still visible)
    - Handle missing morph targets gracefully (skip, log debug)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.2, 8.3_

  - [ ] 6.2 Implement garment material and heatmap rendering in `src/components/GarmentShell.tsx`
    - Neutral material: `MeshPhysicalMaterial` with color 0xdddddd, opacity 0.75, transparent, DoubleSide, roughness 0.8, depthWrite false, renderOrder higher than body
    - When heatmap enabled: compute vertex colors using `computeHeatmap()` on garment vertex positions (normalized height, distance from center), apply Laplacian smoothing via `smoothColors()` (2 iterations, weight 0.5)
    - When heatmap disabled: use neutral material without vertex colors
    - Use `sizeChartEngine.getActiveSizeChart()` to get measurements for heatmap computation, respecting brand chart if set
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.5_

- [ ] 7. Checkpoint — GarmentShell component complete
  - Ensure TypeScript compiles cleanly. Ask the user if questions arise.

- [ ] 8. Integration — wire BodyModel, Scene, and heatmap transfer
  - [ ] 8.1 Modify `src/components/BodyModel.tsx` for garment shell coordination
    - When heatmap is enabled AND garmentType is not 'none': render body with skin texture only (no vertex colors) — heatmap moves to garment shell
    - Expose current morph influences to store via `setCurrentMorphInfluences()` in the animation frame loop
    - No changes to morph target animation, height/width scaling, or mesh processing logic
    - _Requirements: 6.4_

  - [ ] 8.2 Modify `src/components/Scene.tsx` to include GarmentShell
    - Add `<GarmentShell />` as sibling to `<BodyModel />` inside the `<Suspense>` boundary
    - GarmentShell reads all needed state from bodyStore (reactive)
    - _Requirements: 4.1_

  - [ ]* 8.3 Write integration tests for size chart + heatmap flow
    - Test `computeHeatmap()` with brand size chart override returns non-null HeatmapResult
    - Test `computeHeatmap()` without override uses default chart (same behavior as before)
    - Test `getActiveSizeChart()` integration with `computeHeatmap()` for each garment type
    - _Requirements: 7.3, 7.4_

- [ ] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 2 correctness properties defined in the design document (size chart validation + serialization round-trip)
- Unit tests validate specific examples and edge cases for the size chart engine
- The Blender pipeline (task 3) requires manual execution and visual verification — it cannot be tested via Vitest
- Test file: `src/utils/__tests__/sizeChartEngine.test.ts`
- Blender command: `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/bake-garments.py -- --types tee --sizes M`
