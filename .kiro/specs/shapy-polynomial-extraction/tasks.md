# Implementation Plan: SHAPY Polynomial Extraction

## Overview

Extract SHAPY's internal A2S polynomial regression coefficients from the trained PyTorch model and replicate the exact computation in TypeScript. The extraction script inspects the SHAPY source, loads the checkpoint, extracts weight matrices, and exports a compact JSON artifact. A new TypeScript module (`shapyA2S.ts`) implements the polynomial feature expansion and matrix multiplication. The regressor gains a four-tier routing: A2S → 8-input → 4-input → heuristic.

## Tasks

- [ ] 1. Create A2S TypeScript module skeleton and interfaces
  - [ ] 1.1 Create `src/utils/shapyA2S.ts` with A2S interfaces and loading logic
    - Define `A2SMetadata`, `A2SNormalization`, `A2SCoefficients`, `A2SInputs` interfaces
    - Implement `loadA2SCoefficients(url?)` — fetches JSON artifact, validates metadata, stores in module-level variable
    - Implement `isA2SAvailable()` — returns whether coefficients are loaded
    - Implement `hasAllA2SInputs(inputs: RegressorInputs)` — checks if all required A2S fields are non-null
    - Implement `_resetA2SCoefficients()` for testing
    - _Requirements: 4.4, 4.6_
  - [ ] 1.2 Implement `expandPolynomialFeatures(normalizedInputs, degree)` function
    - For degree 2 with K inputs, produce: [1, x₁, x₂, ..., xₖ, x₁², x₁x₂, x₁x₃, ..., xₖ²]
    - Use graded lexicographic order (matching sklearn's `PolynomialFeatures` default — will be adjusted after SHAPY inspection if needed)
    - Return a number[] of length 1 + K + K*(K+1)/2
    - _Requirements: 4.2_
  - [ ] 1.3 Implement `computeA2SBetas(inputs)` function
    - Extract raw input vector from A2SInputs in the order specified by `coefficients.metadata.inputFeatures`
    - Normalize: `(input[i] - mean[i]) / std[i]`
    - Expand to polynomial features using `expandPolynomialFeatures()`
    - Matrix multiply: `betas[i] = Σ(weights[i][j] × features[j]) + bias[i]`
    - Clamp all betas to [-3, 3]
    - Return Float64Array(10)
    - _Requirements: 4.1, 4.3, 4.5_
  - [ ] 1.4 Write unit tests for A2S module
    - Test `expandPolynomialFeatures()` with known inputs (e.g., [1, 2] degree 2 → [1, 1, 2, 1, 2, 4])
    - Test `computeA2SBetas()` with mock coefficients and known inputs
    - Test `isA2SAvailable()` returns false before loading, true after
    - Test `hasAllA2SInputs()` with complete and incomplete inputs
    - Test clamping behavior for extreme inputs
    - Test loading invalid/malformed coefficient artifact returns null
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6_

- [ ] 2. Integrate A2S path into smplRegressor.ts
  - [ ] 2.1 Add `RegressionPath` type and tracking to `smplRegressor.ts`
    - Define `RegressionPath = 'a2s' | '8-input' | '8-input-hybrid' | '4-input' | 'heuristic'`
    - Add module-level `lastRegressionPath` variable
    - Export `getLastRegressionPath()` function
    - _Requirements: 5.5_
  - [ ] 2.2 Add A2S routing to `lookupRegress()`
    - Before existing calibrated/heuristic paths, check `isA2SAvailable() && hasAllA2SInputs(inputs)`
    - If true, call `computeA2SBetas()` with mapped inputs (bustCm → chestCm), set `lastRegressionPath = 'a2s'`, return result
    - If false, fall through to existing 8-input → 4-input → heuristic routing
    - Update existing path branches to set `lastRegressionPath` accordingly
    - _Requirements: 5.1, 5.2_
  - [ ] 2.3 Add A2S refinement skip in `computeSmplBetas()`
    - Detect when A2S path was used (check `lastRegressionPath === 'a2s'`)
    - Skip `refineWithCustomMeasurements()` when A2S path was used with all required measurements
    - Preserve existing refinement behavior for all other paths
    - _Requirements: 5.3, 5.4_
  - [ ] 2.4 Add A2S initialization to engine startup
    - In `engineInit.ts` or `bodyEngine.ts`, call `loadA2SCoefficients()` during initialization
    - A2S loading is independent and optional — failure does not block engine startup
    - _Requirements: 4.6_
  - [ ] 2.5 Write unit tests for A2S integration
    - Test that with A2S loaded and all required inputs, `lookupRegress()` uses A2S path
    - Test that with A2S loaded but missing inputs, falls back to 8-input or 4-input
    - Test that without A2S loaded, existing behavior is unchanged
    - Test `getLastRegressionPath()` returns correct path for each scenario
    - Test refinement skip when A2S path is used
    - Test that preset offsets and composition bias are still applied after A2S base regression
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 3. Checkpoint — Verify TypeScript changes compile and existing tests pass
  - Run `npx vitest --run` to confirm all existing property-based and unit tests still pass
  - Verify the 4-input and 8-input paths produce identical output (backward compatibility)
  - Verify A2S module compiles and unit tests pass with mock coefficients

- [ ] 4. Create Python A2S coefficient extraction script
  - [ ] 4.1 Create `scripts/extract-shapy-a2s.py` with SHAPY source inspection
    - Accept CLI arguments: `--checkpoint`, `--shapy-dir`, `--output`, `--validation-output`
    - Import SHAPY's A2S model class from the SHAPY repository
    - Inspect the model architecture: identify input features, polynomial degree, normalization, layer structure
    - Document findings in a comment block at the top of the script
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ] 4.2 Implement coefficient extraction from PyTorch checkpoint
    - Load the checkpoint using `torch.load()`
    - Extract the polynomial regression weight matrix and bias vector from the model's state dict
    - Extract input normalization parameters (mean, std) from the model or training config
    - Handle potential multi-stage models (e.g., per-gender routing) if discovered during inspection
    - _Requirements: 2.1, 2.2, 2.4_
  - [ ] 4.3 Implement extraction verification
    - Run 10 diverse test inputs through both the original PyTorch model and the extracted matrices
    - Assert outputs match within 1e-6 absolute tolerance per beta component
    - Log per-input comparison results
    - _Requirements: 2.5_
  - [ ] 4.4 Implement validation dataset generation
    - Generate 100+ diverse input combinations spanning the population range
    - Run each through the original PyTorch model to get ground-truth betas
    - Export as `scripts/data/a2s_validation_pairs.json`
    - _Requirements: 6.3_
  - [ ] 4.5 Implement JSON artifact export
    - Export weight matrix, bias vector, normalization params, polynomial degree, feature ordering, and metadata
    - Write to `src/data/shapy_a2s_coefficients.json`
    - Copy to `public/data/shapy_a2s_coefficients.json`
    - Verify file size < 100KB
    - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Run extraction script and generate artifacts
  - Run `python scripts/extract-shapy-a2s.py` with the SHAPY checkpoint
  - Verify `src/data/shapy_a2s_coefficients.json` contains all required fields
  - Verify `scripts/data/a2s_validation_pairs.json` contains 100+ pairs
  - Verify `public/data/shapy_a2s_coefficients.json` is in place
  - Verify artifact file size < 100KB
  - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4_

- [ ] 6. Update polynomial feature expansion to match SHAPY's actual implementation
  - After running the extraction script and inspecting SHAPY's source, update `expandPolynomialFeatures()` if SHAPY uses a different ordering or structure than the initial sklearn-style implementation
  - Update `A2SInputs` interface if SHAPY expects additional inputs (gender, age, etc.)
  - Update `hasAllA2SInputs()` to check for any additional required fields
  - Re-run unit tests to verify the updated expansion
  - _Requirements: 1.3, 4.2_

- [ ] 7. Checkpoint — Verify extraction artifacts load correctly in TypeScript
  - Run `npx vitest --run` to confirm all tests pass with real A2S coefficients
  - Verify `loadA2SCoefficients()` successfully loads the real artifact
  - Verify `computeA2SBetas()` produces reasonable betas with real coefficients

- [ ] 8. Add A2S validation test suite (TypeScript vs Python)
  - [ ] 8.1 Create `src/utils/__tests__/shapyA2S.validation.test.ts`
    - Load `scripts/data/a2s_validation_pairs.json` as test fixture
    - Load `src/data/shapy_a2s_coefficients.json` as A2S coefficients
    - For each validation pair, compute betas via TypeScript `computeA2SBetas()`
    - Assert per-component absolute difference < 1e-4 between TypeScript and Python betas
    - Log summary: mean/max per-component difference across all pairs
    - _Requirements: 6.1, 6.2, 6.4_
  - [ ] 8.2 Add round-trip accuracy comparison test
    - Run A2S path on ANSUR II validation subjects (100+): measurements → `computeA2SBetas()` → `computeSmplVertices()` → `extractMeasurements()` → compare with input measurements
    - Assert chest/waist/hip mean round-trip error < 4cm
    - Log comparison table: A2S vs 8-input vs 4-input accuracy side-by-side
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 9. Add A2S property-based tests
  - [ ] 9.1 [PBT] Write property test: A2S beta boundedness
    - Generate random valid A2S inputs (height 150–200, chest 75–130, waist 60–120, hip 80–135)
    - Assert `computeA2SBetas()` returns Float64Array(10) with all elements finite and in [-3, 3]
    - 100 iterations
    - _Requirements: 9.1, 9.2_
  - [ ] 9.2 [PBT] Write property test: polynomial feature expansion length invariant
    - Generate random input vectors of length 2–10 and degree 1–3
    - Assert `expandPolynomialFeatures()` returns array of expected length
    - For degree 2, length = 1 + K + K*(K+1)/2
    - 100 iterations
    - _Requirements: 4.2_
  - [ ] 9.3 [PBT] Write property test: A2S coefficient artifact parse-serialize round-trip
    - Generate random valid A2S coefficient structures
    - Assert `JSON.parse(JSON.stringify(artifact))` preserves all numeric values within 1e-10
    - 50 iterations
    - _Requirements: 3.5, 9.4_
  - [ ] 9.4 [PBT] Write property test: A2S beta continuity
    - Generate random valid A2S inputs
    - Perturb a single measurement by 1cm
    - Assert no beta component changes by more than 0.5 units
    - 50 iterations
    - _Requirements: 9.3_
  - [ ] 9.5 [PBT] Write property test: A2S round-trip chest within 5cm
    - Generate random valid A2S inputs
    - Run full pipeline: inputs → `computeA2SBetas()` → `computeSmplVertices()` → `extractMeasurements()`
    - Assert |extracted.chestCm - input.chestCm| < 5cm
    - 50 iterations, SMPL model loaded once in beforeAll
    - _Requirements: 8.1, 8.2_
  - [ ] 9.6 [PBT] Write property test: A2S round-trip waist within 5cm
    - Same setup as 9.5, assert |extracted.waistCm - input.waistCm| < 5cm
    - _Requirements: 8.1, 8.3_
  - [ ] 9.7 [PBT] Write property test: A2S round-trip hip within 5cm
    - Same setup as 9.5, assert |extracted.hipCm - input.hipCm| < 5cm
    - _Requirements: 8.1, 8.4_

- [ ] 10. Add backward compatibility and integration property tests
  - [ ] 10.1 [PBT] Write property test: A2S refinement skip
    - Generate random valid A2S inputs with all required measurements
    - Assert `computeSmplBetas()` output equals manually composed `computeA2SBetas()` + preset + composition + clamp (no refinement)
    - 50 iterations
    - _Requirements: 5.4_
  - [ ] 10.2 [PBT] Write property test: backward compatibility — 4-input path identity
    - Generate random demographics-only inputs (no custom measurements)
    - Assert output with A2S loaded is identical to output without A2S loaded
    - 100 iterations
    - _Requirements: 10.1_

- [ ] 11. Verify backward compatibility with existing tests
  - [ ] 11.1 Verify existing property-based tests pass with A2S coefficients loaded
    - Run `npx vitest --run src/utils/__tests__/smplRegressor.prop.test.ts`
    - All existing properties must still pass
    - _Requirements: 10.4_
  - [ ] 11.2 Verify existing unit tests pass
    - Run `npx vitest --run src/utils/__tests__/smplRegressor.unit.test.ts`
    - All existing unit tests must pass unchanged
    - _Requirements: 10.5_
  - [ ] 11.3 Verify heuristic fallback when no coefficient artifacts present
    - Temporarily remove both coefficient files and run test suite
    - Confirm output is identical to pre-calibration heuristic behavior
    - _Requirements: 10.1_

- [ ] 12. Final checkpoint — All tests pass, A2S extraction complete
  - Ensure all tests pass (existing + new validation + property tests)
  - Verify the A2S path produces measurably better accuracy than 8-input and 4-input paths
  - Confirm backward compatibility: all existing paths unchanged, all existing tests pass
  - Verify both coefficient artifacts are in `public/data/` for runtime access

## Notes

- All tasks are compulsory
- Tasks 4–6 require Python with PyTorch and the SHAPY repository installed. The SHAPY checkpoint file path must be provided.
- The exact A2S input features, polynomial degree, and normalization will be determined during task 4.1 (SHAPY source inspection). Tasks 1.2, 1.3, and 6 may need adjustment based on findings.
- Property-based tests (tasks 9.5–9.7) require the SMPL model binary at `public/models/smpl/smpl_model.bin`
- The `bustCm` field in `RegressorInputs` maps to `chestCm` in SHAPY's A2S model — they are treated as equivalent
- The A2S coefficient artifact is independent from `calibrated_coefficients.json` — they are loaded separately and can be updated independently
- Checkpoints at tasks 3, 7, and 12 ensure incremental validation
- If SHAPY's A2S model expects inputs beyond height/chest/waist/hip (e.g., gender, age), the `A2SInputs` interface and `hasAllA2SInputs()` will be updated in task 6
