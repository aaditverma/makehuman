# Implementation Plan: SHAPY Beta Calibration

## Overview

Replace heuristic regressor coefficients with data-driven coefficients calibrated against SHAPY synthetic data and validated via ANSUR II round-trip. The implementation proceeds in phases: (1) Python offline pipeline for data generation and coefficient training, (2) TypeScript runtime changes for coefficient loading and calibrated regression, (3) validation test suite and property-based tests. Python scripts produce a single JSON artifact (`src/data/calibrated_coefficients.json`) that the TypeScript regressor loads at runtime with graceful fallback to heuristics.

## Tasks

- [x] 1. Define CalibratedCoefficients TypeScript interface and coefficient loading
  - [x] 1.1 Create `CalibratedCoefficients` interface in `src/utils/smplRegressor.ts`
    - Add the full interface from the design: `version`, `generatedAt`, `regression` (intercepts, weights, features, normalization), `presetOffsets`, `compositionBias`, `sensitivityMap`, `fatDistribution` (per-gender weightToBeta and ageFactor vectors)
    - Add module-level `calibratedCoeffs: CalibratedCoefficients | null = null` and `EXPECTED_VERSION = '1.0.0'`
    - _Requirements: 9.1, 9.5_
  - [x] 1.2 Implement `loadCalibratedCoefficients()` async function
    - Fetch JSON from configurable URL (default `/data/calibrated_coefficients.json`)
    - Validate version matches `EXPECTED_VERSION`; log warning and return null on mismatch
    - Catch fetch/parse errors, log warning, return null (fallback to heuristic)
    - Store loaded coefficients in module-level `calibratedCoeffs`
    - _Requirements: 3.1, 3.2, 9.4_
  - [x] 1.3 Implement `applyCalibratedCoefficients()` to overwrite module-level constants
    - When coefficients are loaded, overwrite `SMPL_PRESET_OFFSETS` values with `calibratedCoeffs.presetOffsets`
    - Overwrite `COMPOSITION_BIAS` values with `calibratedCoeffs.compositionBias`
    - Overwrite `MEASUREMENT_BETA_MAP` values with `calibratedCoeffs.sensitivityMap`
    - _Requirements: 4.3, 4.4, 7.4, 3.5_
  - [x] 1.4 Write unit tests for coefficient loading and fallback
    - Test successful load with valid JSON
    - Test fallback on missing file, parse error, version mismatch
    - Test that `applyCalibratedCoefficients()` overwrites preset/composition/sensitivity constants
    - _Requirements: 3.2, 9.4, 12.4_

- [x] 2. Modify `lookupRegress()` to use calibrated coefficients
  - [x] 2.1 Add calibrated regression path in `lookupRegress()`
    - When `calibratedCoeffs` is non-null, compute features: `heightNorm`, `weightNorm`, `ageNorm`, `genderSign`, `bmiNorm`, `hwInteraction` (heightNorm × weightNorm), `bmiSq` (bmiNorm²)
    - Compute each beta as `β[i] = intercept[i] + Σ(weights[i][j] × feature[j])` using loaded coefficients
    - Apply fat distribution modulation: `β[i] += fatDistribution[gender].weightToBeta[i] × wNorm + fatDistribution[gender].ageFactor[i] × aNorm`
    - Clamp all betas to [-3, 3]
    - When `calibratedCoeffs` is null, run existing heuristic code unchanged
    - _Requirements: 3.1, 3.3, 3.4, 10.5, 11.3, 12.2, 12.3, 12.4_
  - [x] 2.2 Write unit tests for calibrated `lookupRegress()`
    - Test that with mock coefficients loaded, `lookupRegress()` uses the calibrated path
    - Test that without coefficients, output is identical to current heuristic
    - Test beta clamping to [-3, 3] for extreme inputs
    - _Requirements: 3.3, 3.4, 12.4_

- [x] 3. Checkpoint — Verify TypeScript changes compile and existing tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npx vitest --run` to confirm existing property-based and unit tests still pass with no coefficients loaded (heuristic fallback path).

- [x] 4. Create SHAPY data generation script (`scripts/generate-shapy-data.py`)
  - [x] 4.1 Implement ANSUR II measurement interpolation
    - Load `src/data/ansur2_male.csv` and `src/data/ansur2_female.csv`
    - Build a KD-tree from ANSUR II subjects indexed by (height, weight, age, gender)
    - For each population grid point, find k=5 nearest ANSUR II neighbors and interpolate chest, waist, hip, shoulder, inseam using inverse-distance weighting
    - _Requirements: 1.4_
  - [x] 4.2 Implement SHAPY A2S invocation across population grid
    - Define population grid: height 140–210cm (5cm steps), weight 40–160kg (5kg steps), ages [20, 30, 40, 50, 60], genders [male, female]
    - Filter out physiologically implausible combinations (BMI < 14 or > 50)
    - For each valid grid point, invoke SHAPY A2S with interpolated measurements to get 10 SMPL betas
    - Handle SHAPY failures (NaN, timeout, error) by logging and skipping without halting
    - _Requirements: 1.1, 1.2, 1.5_
  - [x] 4.3 Export calibration dataset as JSON
    - Write `scripts/data/calibration_dataset.json` with each entry containing: heightCm, weightKg, age, gender, chestCm, waistCm, hipCm, shoulderCm, inseamCm, and 10 betas
    - Validate minimum 5,000 valid entries covering the full population grid range
    - Log summary statistics: total entries, gender split, BMI range, failure count
    - _Requirements: 1.3, 1.6_

- [x] 5. Create coefficient training script (`scripts/train-beta-coefficients.py`)
  - [x] 5.1 Implement polynomial regression with interaction terms
    - Load `scripts/data/calibration_dataset.json`
    - Compute 7 normalized features: heightNorm, weightNorm, ageNorm, genderSign, bmiNorm, hwInteraction, bmiSq
    - Fit per-beta polynomial regression: `β[i] = intercept[i] + Σ(weights[i][j] × feature[j])`
    - Cross-validate and assert mean absolute error < 0.3 beta units per component
    - _Requirements: 2.1, 2.3, 11.1, 11.5_
  - [x] 5.2 Implement preset offset calibration
    - Filter calibration dataset by body type characteristics (Slim: BMI < 20, Athletic: high shoulder-to-waist ratio, Heavy: BMI > 30, Curvy: high hip-to-waist ratio)
    - Compute mean betas for each group, subtract Average baseline (BMI 20–25)
    - Scale offsets to ensure L2 distance between Athletic and Heavy ≥ 0.8
    - Ensure offset vectors affect ≥ 6 of 10 beta components
    - _Requirements: 4.1, 4.5, 4.8, 4.9_
  - [x] 5.3 Implement composition bias calibration
    - At each (height, weight) pair, compare betas for subjects with different body compositions
    - Compute mean beta differences from Average baseline for Athletic and Heavy
    - Ensure composition vectors affect ≥ 6 of 10 beta components
    - _Requirements: 4.2, 4.6, 4.7, 4.9_
  - [x] 5.4 Implement sensitivity map calibration
    - For each measurement (bust, waist, hip, inseam), perturb by ±5cm and re-run SHAPY A2S
    - Compute Δβ/Δmeasurement for each beta component
    - Keep entries where |sensitivity| > 0.02 per cm
    - _Requirements: 7.1, 7.2, 7.4_
  - [x] 5.5 Implement fat distribution extraction
    - Group calibration data by gender
    - Fit per-gender weight-to-beta mapping across BMI range
    - Extract per-gender weightToBeta and ageFactor vectors
    - Verify male android pattern (β1, β5 increase faster than β7) and female gynoid pattern (β7, β9 increase faster than β1)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [x] 5.6 Export `src/data/calibrated_coefficients.json`
    - Write the full CalibratedCoefficients JSON: version, generatedAt, regression (intercepts, weights, features, normalization), presetOffsets, compositionBias, sensitivityMap, fatDistribution
    - Validate file size < 50KB minified
    - _Requirements: 2.2, 2.5, 9.1, 9.2_

- [x] 6. Checkpoint — Verify offline pipeline produces valid coefficients
  - Ensure the Python scripts run end-to-end: `generate-shapy-data.py` → `train-beta-coefficients.py` → `src/data/calibrated_coefficients.json`.
  - Verify the JSON artifact loads correctly in TypeScript by running existing tests with coefficients present.
  - Ask the user if questions arise.

- [x] 7. Wire calibrated coefficients into runtime and integrate bodyEngine
  - [x] 7.1 Call `loadCalibratedCoefficients()` during engine initialization
    - Update `initSmplRegressor()` or `createBodyEngine()` in `src/utils/bodyEngine.ts` to call `loadCalibratedCoefficients()` before creating the SmplEngine
    - Ensure fallback: if load fails, engine still initializes with heuristic coefficients
    - _Requirements: 3.1, 3.2, 12.4_
  - [x] 7.2 Update `refineWithCustomMeasurements()` to use calibrated sensitivity map
    - When calibrated coefficients are loaded, use `calibratedCoeffs.sensitivityMap` entries instead of hardcoded `MEASUREMENT_BETA_MAP`
    - Preserve the same interface and convergence behavior
    - _Requirements: 3.5, 7.3_
  - [x] 7.3 Write unit tests for end-to-end calibrated pipeline
    - Test `computeSmplBetas()` with calibrated coefficients loaded produces finite betas in [-3, 3]
    - Test preset switching produces L2 distance ≥ 0.8 between Athletic and Heavy
    - Test composition switching produces measurable circumference differences per Requirement 4.6, 4.7
    - _Requirements: 4.6, 4.7, 4.8, 12.1_

- [x] 8. Create forward pass validation test suite
  - [x] 8.1 Implement ANSUR II round-trip validation in Vitest
    - Create `src/utils/__tests__/smplRegressor.validation.test.ts`
    - Load SMPL model binary from `public/models/smpl/smpl_model.bin` in `beforeAll`
    - Sample 100 ANSUR II subjects across BMI 18–35, both genders
    - For each subject: input measurements → `computeSmplBetas()` → `computeSmplVertices()` → `extractMeasurements()` → compare with ANSUR ground truth
    - Assert chest/waist/hip round-trip error < 5cm for ≥ 80% of subjects
    - Assert inseam round-trip error < 5cm for ≥ 80% of subjects
    - Produce summary report: per-measurement mean, median, p90 error, % within 3cm and 5cm
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [x] 8.2 Implement calibration mode for bias correction
    - Create `scripts/calibrate-validate.py`
    - Process 50+ curated ANSUR II subjects spanning BMI 18–35, both genders, ages 20–55
    - Compute per-measurement bias (mean signed error) and scale factor
    - If bias exceeds 2cm, output correction factors as JSON patch
    - Output `scripts/data/correction_factors.json` for the trainer to merge
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9. Checkpoint — Verify validation pipeline and accuracy thresholds
  - Ensure the forward pass validation test suite passes with calibrated coefficients.
  - If correction factors were generated, re-run the trainer with corrections merged and re-validate.
  - Ask the user if questions arise.

- [x] 10. Add round-trip property-based tests
  - [x] 10.1 Write property test: round-trip chest circumference within 8cm
    - Create or extend `src/utils/__tests__/smplRegressor.prop.test.ts`
    - Use fast-check to generate random valid inputs (height 150–200, weight 50–130, age 20–60, male/female)
    - Run full pipeline: inputs → `computeSmplBetas()` → `computeSmplVertices()` → `extractMeasurements()` → compare chest with ANSUR-predicted value
    - Assert round-trip chest error < 8cm for all generated inputs
    - Load SMPL model binary once in `beforeAll`
    - Run with at least 50 iterations
    - _Requirements: 6.1, 6.2, 6.5_
  - [x] 10.2 Write property test: round-trip waist circumference within 8cm
    - Same setup as 10.1 but assert waist round-trip error < 8cm
    - _Requirements: 6.1, 6.3, 6.5_
  - [x] 10.3 Write property test: round-trip hip circumference within 8cm
    - Same setup as 10.1 but assert hip round-trip error < 8cm
    - _Requirements: 6.1, 6.4, 6.5_

- [x] 11. Verify backward compatibility and existing tests
  - [x] 11.1 Verify existing property-based tests pass with calibrated coefficients
    - Run `npx vitest --run src/utils/__tests__/smplRegressor.prop.test.ts` with calibrated coefficients loaded
    - All existing properties (3, 6, 7, 8, 9, 10, 11, 12) must still pass
    - _Requirements: 12.5_
  - [x] 11.2 Verify existing unit tests pass
    - Run `npx vitest --run src/utils/__tests__/smplRegressor.unit.test.ts`
    - All existing unit tests must pass unchanged
    - _Requirements: 12.1, 12.2_
  - [x] 11.3 Verify heuristic fallback produces identical output when coefficients are absent
    - Temporarily remove/rename `calibrated_coefficients.json` and run full test suite
    - Confirm output is identical to pre-calibration heuristic behavior
    - _Requirements: 12.4_

- [x] 12. Add `npm run calibrate` script and final wiring
  - [x] 12.1 Add `calibrate` npm script to `package.json`
    - Script runs the full pipeline: `python scripts/generate-shapy-data.py && python scripts/train-beta-coefficients.py`
    - _Requirements: 9.3_
  - [x] 12.2 Verify the complete pipeline end-to-end
    - Run `npm run calibrate` to generate fresh coefficients
    - Run `npx vitest --run` to confirm all tests pass (existing + new validation + property tests)
    - Verify `src/data/calibrated_coefficients.json` is < 50KB and contains all required fields
    - _Requirements: 9.2, 9.3_

- [x] 13. Final checkpoint — All tests pass, calibration complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify the calibrated regressor produces visually distinct body shapes for different presets and compositions.

## Notes

- All tasks are compulsory
- Python scripts (tasks 4, 5, 8.2) require SHAPY installation and ANSUR II data already present in `src/data/`
- The existing `scripts/train-body-model.py` provides reference patterns for ANSUR II loading and sklearn usage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key integration points
- Property tests validate round-trip correctness using fast-check with the SMPL model binary
