# Implementation Plan: 8-Input Regression

## Overview

Extend the SMPL beta regressor from 4 demographic inputs to 8 inputs (+ chest, waist, hip, inseam) by training a second regression model from the existing calibration dataset and adding runtime routing logic. The training script produces both 4-input and 8-input models in a single coefficient table (v2.0.0). The runtime selects the appropriate model based on which custom measurements the user provides. The 4-input path remains unchanged for backward compatibility.

## Tasks

- [x] 1. Extend CalibratedCoefficients interface and version loading
  - [x] 1.1 Add `RegressionBlock` type and optional `regression8` field to `CalibratedCoefficients` in `src/utils/smplRegressor.ts`
    - Extract the existing regression field structure into a shared `RegressionBlock` interface (intercepts, weights, features, normalization)
    - Add `regression8?: RegressionBlock` to `CalibratedCoefficients`
    - _Requirements: 8.4_
  - [x] 1.2 Update `loadCalibratedCoefficients()` to accept both v1.0.0 and v2.0.0
    - Change `EXPECTED_VERSION` to `ACCEPTED_VERSIONS = ['1.0.0', '2.0.0']`
    - When v1.0.0 is loaded (no `regression8`), log info message and proceed with 4-input only
    - When v2.0.0 is loaded, validate `regression8` key is present
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 1.3 Write unit tests for version loading logic
    - Test loading v1.0.0 coefficient table succeeds with 4-input only
    - Test loading v2.0.0 coefficient table succeeds with both models
    - Test loading unsupported version (e.g., "3.0.0") returns null with warning
    - Test missing `regression8` in v2.0.0 logs warning but still loads 4-input
    - _Requirements: 2.5, 8.2, 8.3_

- [x] 2. Implement 8-input regression path in `lookupRegress()`
  - [x] 2.1 Add `imputeMissingMeasurements()` helper function
    - When custom measurements are partially provided, fill missing values from ANSUR lookup (if loaded) or `predictMeasurementsFromDemographics()`
    - Return an object with all 4 measurement values plus boolean flags indicating which are real vs imputed
    - _Requirements: 3.1, 3.2_
  - [x] 2.2 Add `regress8Input()` internal function
    - Compute 11 normalized features: heightNorm, weightNorm, ageNorm, genderSign, chestNorm, waistNorm, hipNorm, inseamNorm, bmiNorm, whrNorm (waist/hip ratio), cwrNorm (chest/waist ratio)
    - Apply confidence scaling: multiply imputed measurement features by 0.7
    - Compute `β[i] = intercept8[i] + Σ(weight8[i][j] × feature[j])` using `regression8` coefficients
    - Apply fat distribution modulation (same as existing 4-input path)
    - Clamp to [-3, 3]
    - _Requirements: 2.1, 2.3, 3.3_
  - [x] 2.3 Add three-way routing logic in `lookupRegress()`
    - Count non-null custom measurements (bustCm, waistCm, hipCm, inseamCm)
    - If count > 0 and `regression8` is available: call `regress8Input()` with imputation for missing
    - If count == 0 or `regression8` not available: use existing 4-input path (unchanged)
    - _Requirements: 2.1, 2.2, 2.4, 2.5_
  - [x] 2.4 Write unit tests for 8-input regression path
    - Test that with all 4 measurements and mock 8-input coefficients, `lookupRegress()` uses the 8-input path
    - Test that with no measurements, output is identical to 4-input path
    - Test that with 1-3 measurements, hybrid path is used (output differs from both 4-input and full 8-input)
    - Test beta clamping to [-3, 3] for extreme 8-input values
    - _Requirements: 2.1, 2.2, 2.4, 3.1_

- [x] 3. Modify `computeSmplBetas()` to skip refinement for full 8-input
  - [x] 3.1 Add refinement skip logic in `computeSmplBetas()`
    - Detect when 8-input model was used with all 4 custom measurements provided
    - Skip the `refineWithCustomMeasurements()` call in that case
    - Preserve existing refinement behavior for 4-input and hybrid paths
    - _Requirements: 4.3, 4.2_
  - [x] 3.2 Write unit tests for refinement skip
    - Test that with all 4 measurements and 8-input model, `computeSmplBetas()` output equals `lookupRegress()` + preset + composition + clamp (no refinement)
    - Test that with 4-input path, refinement still runs when custom measurements are provided
    - _Requirements: 4.3_

- [x] 4. Checkpoint — Verify TypeScript changes compile and existing tests pass
  - Run `npx vitest --run` to confirm all existing property-based and unit tests still pass
  - Verify the 4-input path produces identical output (backward compatibility)

- [x] 5. Extend training script for dual-model export
  - [x] 5.1 Add 8-input feature computation to `train-beta-coefficients.py`
    - Add `compute_features_8input(entry)` function that computes 11 normalized features from a calibration dataset entry: heightNorm, weightNorm, ageNorm, genderSign, chestNorm, waistNorm, hipNorm, inseamNorm, bmiNorm, whrNorm, cwrNorm
    - Add `build_feature_matrix_8input(data)` to build the 11-column feature matrix
    - Define normalization parameters: chestNorm (center=96, range=15), waistNorm (center=82, range=15), hipNorm (center=98, range=15), inseamNorm (center=80, range=10), whrNorm (center=0.85, range=0.15), cwrNorm (center=1.15, range=0.2)
    - _Requirements: 1.1_
  - [x] 5.2 Add `train_regression_8input()` function
    - Fit per-beta Ridge regression on the 11-feature matrix
    - 5-fold cross-validate, assert MAE < 0.15 per beta component
    - Log per-beta MAE and comparison with 4-input model
    - Return dict with intercepts [10], weights [10][11], features, normalization
    - _Requirements: 1.2, 1.5_
  - [x] 5.3 Update `export_coefficients()` to include `regression8` key
    - Add `regression8` parameter to the export function
    - Include it in the output JSON alongside existing `regression` key
    - Bump version to `"2.0.0"`
    - Validate file size < 100KB minified
    - _Requirements: 1.3, 1.4, 7.1, 7.2, 7.3, 8.1_
  - [x] 5.4 Update `main()` to train and export both models
    - Call existing `train_regression()` for 4-input model
    - Call new `train_regression_8input()` for 8-input model
    - Log comparison summary of both models' MAE
    - Pass both to `export_coefficients()`
    - _Requirements: 7.1, 7.4_

- [x] 6. Run training script and generate extended coefficient table
  - Run `python scripts/train-beta-coefficients.py` to produce the v2.0.0 coefficient table
  - Verify `src/data/calibrated_coefficients.json` contains both `regression` and `regression8` keys
  - Copy updated file to `public/data/calibrated_coefficients.json`
  - Verify file size < 100KB
  - _Requirements: 7.5, 8.1_

- [x] 7. Checkpoint — Verify extended coefficient table loads correctly
  - Run `npx vitest --run` to confirm all tests pass with the v2.0.0 coefficient table
  - Verify the 4-input path still produces identical output
  - Verify the 8-input path produces different (better) output when measurements are provided

- [x] 8. Add 8-input validation test suite
  - [x] 8.1 Extend `smplRegressor.validation.test.ts` with 8-input validation
    - Add test cases that provide ANSUR II ground-truth measurements as custom inputs
    - Run full pipeline: demographics + measurements → `computeSmplBetas()` → `computeSmplVertices()` → `extractMeasurements()` → compare with input measurements
    - Assert chest/waist/hip/inseam round-trip error < 5cm for ≥ 80% of subjects
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 8.2 Add comparison report test
    - Run both 4-input (demographics-only) and 8-input (with measurements) paths on the same ANSUR II subjects
    - Log side-by-side accuracy table: per-measurement mean error, ≤5cm %, for both models
    - Assert 8-input model improves mean error by at least 40% on chest/waist/hip
    - _Requirements: 5.5_

- [x] 9. Add 8-input round-trip property-based tests
  - [x] 9.1 [PBT] Write property test: 8-input round-trip chest within 5cm
    - Generate random valid 8-input combinations (height 150–200, weight 50–130, age 20–60, male/female, chest 75–130, waist 60–120, hip 80–135, inseam 65–95)
    - Run full pipeline: inputs → `computeSmplBetas()` → `computeSmplVertices()` → `extractMeasurements()`
    - Assert |extracted.chestCm - input.bustCm| < 5cm
    - 50 iterations, SMPL model loaded once in beforeAll
    - _Requirements: 6.1, 6.2_
  - [x] 9.2 [PBT] Write property test: 8-input round-trip waist within 5cm
    - Same setup as 9.1, assert |extracted.waistCm - input.waistCm| < 5cm
    - _Requirements: 6.1, 6.3_
  - [x] 9.3 [PBT] Write property test: 8-input round-trip hip within 5cm
    - Same setup as 9.1, assert |extracted.hipCm - input.hipCm| < 5cm
    - _Requirements: 6.1, 6.4_
  - [x] 9.4 [PBT] Write property test: 8-input round-trip inseam within 5cm
    - Same setup as 9.1, assert |extracted.inseamCm - input.inseamCm| < 5cm
    - _Requirements: 6.1, 6.5_

- [x] 10. Add structural and backward-compatibility property tests
  - [x] 10.1 [PBT] Write property test: 8-input beta boundedness
    - Generate random valid 8-input combinations across full range
    - Assert `lookupRegress()` returns Float64Array(10) with all elements finite and in [-3, 3]
    - 100 iterations
    - _Requirements: 2.4_
  - [x] 10.2 [PBT] Write property test: 4-input path identity
    - Generate random demographics-only inputs (no custom measurements)
    - Assert output with v2.0.0 coefficient table is identical to output with v1.0.0 table
    - 100 iterations
    - _Requirements: 9.1_
  - [x] 10.3 [PBT] Write property test: refinement skip for full 8-input
    - Generate random valid 8-input combinations
    - Assert `computeSmplBetas()` output equals manually composed `lookupRegress()` + preset + composition + clamp
    - 50 iterations
    - _Requirements: 4.3_
  - [x] 10.4 [PBT] Write property test: coefficient table parse-serialize round-trip
    - Generate random valid coefficient table structures with both `regression` and `regression8`
    - Assert `JSON.parse(JSON.stringify(table))` preserves all numeric values within 1e-10
    - 50 iterations
    - _Requirements: 10.1, 10.2_

- [x] 11. Verify backward compatibility with existing tests
  - [x] 11.1 Verify existing property-based tests pass with v2.0.0 coefficients
    - Run `npx vitest --run src/utils/__tests__/smplRegressor.prop.test.ts`
    - All existing properties (3, 6, 7, 8, 9, 10, 11, 12) must still pass
    - _Requirements: 9.4_
  - [x] 11.2 Verify existing unit tests pass
    - Run `npx vitest --run src/utils/__tests__/smplRegressor.unit.test.ts`
    - All existing unit tests must pass unchanged
    - _Requirements: 9.5_
  - [x] 11.3 Verify heuristic fallback when coefficient table absent
    - Temporarily remove coefficients and run test suite
    - Confirm output is identical to pre-calibration heuristic behavior
    - _Requirements: 9.6_

- [x] 12. Update `npm run calibrate` script and final wiring
  - [x] 12.1 Update `calibrate` npm script if needed
    - Ensure `npm run calibrate` runs the updated training script that produces both models
    - _Requirements: 7.5_
  - [x] 12.2 Verify complete pipeline end-to-end
    - Run training script to generate fresh v2.0.0 coefficients
    - Copy to `public/data/`
    - Run `npx vitest --run` to confirm all tests pass (existing + new validation + property tests)
    - Verify coefficient table is < 100KB and contains all required fields
    - _Requirements: 7.3, 7.5_

- [x] 13. Final checkpoint — All tests pass, 8-input regression complete
  - Ensure all tests pass
  - Verify the 8-input regressor produces measurably better accuracy than the 4-input path
  - Confirm backward compatibility: 4-input path unchanged, all existing tests pass

## Notes

- All tasks are compulsory
- The calibration dataset at `scripts/data/calibration_dataset.json` already exists from the completed SHAPY calibration spec — no new data generation needed
- Tasks 5–6 require Python with sklearn installed (same as the existing training script)
- Property-based tests (tasks 9–10) require the SMPL model binary at `public/models/smpl/smpl_model.bin`
- The `bustCm` field in `RegressorInputs` maps to `chestCm` in the calibration dataset — they are treated as equivalent
- Each task references specific requirements for traceability
- Checkpoints at tasks 4, 7, and 13 ensure incremental validation
