# Implementation Plan: Better Fit Calculation

## Overview

Expand the heatmap fit calculation from 3–5 measurement points per garment to 5–9 points by using all ML-predicted measurements directly, adding new height regions, expanding garment size charts, introducing per-measurement weighting, and updating ease targets. Changes span `morphMapper.ts`, `heatmapEngine.ts`, and `BodyModel.tsx`. Test infrastructure (Vitest + fast-check) must be set up first since the project has no test framework yet.

## Tasks

- [x] 1. Set up test infrastructure and expand estimatedMeasurements
  - [x] 1.1 Install Vitest and fast-check, create vitest config
    - Add `vitest` and `fast-check` as dev dependencies
    - Create `vitest.config.ts` at project root (use vite config as base)
    - Add `"test": "vitest --run"` script to `package.json`
    - Create `src/utils/__tests__/` directory
    - _Requirements: Testing Strategy in design_

  - [x] 1.2 Expand `estimatedMeasurements()` in `src/utils/morphMapper.ts`
    - Export the `EstimatedMeasurements` interface with all 12 fields: `bustCm`, `waistCm`, `hipCm`, `highHipCm`, `inseamCm`, `shoulderCm`, `neckCm`, `bicepCm`, `thighCm`, `calfCm`, `wristCm`, `bmi`
    - Add `lookupMeasurement()` calls for `shoulderCm`, `neckCm`, `bicepCm`, `thighCm`, `calfCm`, `wristCm`
    - Use user overrides for existing fields (`bustCm`, `waistCm`, `hipCm`, `highHipCm`, `inseamCm`), ML lookup for all others
    - All circumference values `Math.round()`ed, BMI rounded to 1 decimal
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 1.3 Write property test: estimated measurements completeness and plausibility
    - **Property 1: Estimated measurements completeness and plausibility**
    - Generate random `UserInputs` within ML grid bounds (height 140–210, weight 35–180, age 20–60), all overrides null
    - Assert all 12 fields are finite positive numbers within anatomically plausible ranges
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 1.4 Write property test: override passthrough
    - **Property 2: Override passthrough**
    - Generate random `UserInputs` with random non-null overrides for `bustCm`, `waistCm`, `hipCm`, `highHipCm`, `inseamCm`
    - Assert overridden fields match the provided values (after rounding)
    - **Validates: Requirements 1.2**

- [x] 2. Checkpoint — Verify estimatedMeasurements expansion
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Expand heatmap engine: height regions, size charts, ease targets, and weighting
  - [x] 3.1 Add new height regions and per-measurement weighting to `heightToMeasurement` in `src/utils/heatmapEngine.ts`
    - Expand from 5 to 9 regions: add `neck` (hCenter 0.85, hWidth 0.03, weight 0.5), `bicep` (0.62, 0.04, 0.6), `wrist` (0.48, 0.03, 0.4), `calf` (0.18, 0.05, 0.5)
    - Add `measurementWeight` field to each existing region: shoulder 0.9, chest 1.0, waist 1.0, hip 0.9, thigh 0.9
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.3_

  - [x] 3.2 Expand garment size charts in `src/utils/heatmapEngine.ts`
    - Tee: add `neck` and `bicep` to all sizes per design table
    - Oxford: add `neck`, `bicep`, and `wrist` to all sizes per design table
    - Slim Jeans: add `calf` and `inseam` to all sizes per design table
    - Straight Jeans: add `calf` and `inseam` to all sizes per design table
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.3 Expand ease targets for all 10 measurements × 5 fit preferences in `src/utils/heatmapEngine.ts`
    - Add entries for `neck`, `bicep`, `calf`, `wrist`, `inseam` to all five fit preferences
    - Use anatomically appropriate ranges from design table (neck/wrist tighter than chest/hip)
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 3.4 Update `computeHeatmap()` signature and bodyMap in `src/utils/heatmapEngine.ts`
    - Define and export `BodyMeasurementsInput` interface with all 10 measurement fields
    - Update `computeHeatmap()` parameter type from inline object to `BodyMeasurementsInput`
    - Replace derived estimates in `bodyMap`: use `bodyMeasurements.thighCm` directly (was `hipCm * 0.56`), use `bodyMeasurements.shoulderCm` directly (was `bustCm * 0.45`)
    - Add `neck`, `bicep`, `calf`, `wrist`, `inseam` to `bodyMap` from the measurements object
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.5 Implement weighted Gaussian blending in `computeHeatmap()` in `src/utils/heatmapEngine.ts`
    - In the Gaussian blending loop, multiply each region's Gaussian weight by its `measurementWeight` before summing
    - Store `measurementWeight` in `regionFits` entries alongside `hCenter`, `hWidth`, `fitScore`
    - When all weights are 1.0, result must be identical to current unweighted formula
    - _Requirements: 6.2, 6.4, 8.1_

  - [ ]* 3.6 Write unit tests for heatmap engine structural checks
    - Verify `heightToMeasurement` contains all 9 required measurements
    - Verify size charts have required keys (neck/bicep for tops, calf/inseam for bottoms, wrist for oxford)
    - Verify `easeTargets` covers all 10 measurements × 5 fit preferences
    - Verify neck ease ranges are smaller than chest ease ranges
    - Verify hCenter values match PROJECT_MASTER landmarks
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 5.1, 5.2, 5.3_

- [x] 4. Checkpoint — Verify heatmap engine expansion
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Property-based tests for fit scoring correctness
  - [ ]* 5.1 Write property test: direct measurement usage in fit scoring
    - **Property 3: Direct measurement usage in fit scoring**
    - For random garment type, size, fit preference, and measurement key present in that garment's size chart, change the corresponding body measurement while holding others constant
    - Assert the fit score changes at the height region corresponding to that measurement
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [ ]* 5.2 Write property test: size chart measurement influence boundary
    - **Property 4: Size chart measurement influence boundary**
    - For random garment type and measurement key NOT in that garment's size chart, change the corresponding body measurement while holding others constant
    - Assert the fit score does NOT change at any height
    - **Validates: Requirements 3.4, 8.3**

  - [ ]* 5.3 Write property test: measurement weight influence
    - **Property 5: Measurement weight influence**
    - For random covered vertex height and a height region with `measurementWeight` set to 0, assert zero contribution to blended fit score
    - Increasing `measurementWeight` increases that region's relative influence at nearby heights
    - **Validates: Requirements 6.2**

  - [ ]* 5.4 Write property test: unweighted equivalence
    - **Property 6: Unweighted equivalence**
    - For random body measurements, garment, size, fit preference, and vertex position, set all `measurementWeight` values to 1.0
    - Assert fit score is identical to the original unweighted Gaussian blending formula
    - **Validates: Requirements 6.4**

  - [ ]* 5.5 Write property test: fit score range invariant
    - **Property 7: Fit score range invariant**
    - For random valid body measurements, garment type, size, and fit preference, every fit score for covered vertices must be in [-1, +1]
    - **Validates: Requirements 8.1**

- [x] 6. Update BodyModel integration and wire everything together
  - [x] 6.1 Update `BodyModel.tsx` to pass expanded measurements to `computeHeatmap()`
    - In the heatmap `useEffect`, `estimatedMeasurements(inputs)` now returns all fields — pass the full object to `computeHeatmap()`
    - No changes needed to vertex processing, normal reading, or color assignment logic
    - Verify TypeScript compiles cleanly with the new `BodyMeasurementsInput` type
    - _Requirements: 7.1, 7.2_

  - [ ]* 6.2 Write integration tests for end-to-end heatmap flow
    - Test that `computeHeatmap()` with expanded measurements from `estimatedMeasurements()` returns non-null `HeatmapResult`
    - Test that `fitScoreToColor` mapping is unchanged: -1 → red, 0 → green, +1 → blue
    - Test behavior at extreme body measurements (very small/large)
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 7. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 7 correctness properties defined in the design document
- Unit tests validate specific examples, structural checks, and edge cases
- Vitest and fast-check must be installed first (task 1.1) since the project has no test framework yet
