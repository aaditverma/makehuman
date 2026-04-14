# Requirements Document

## Introduction

Extract SHAPY's internal A2S (Attributes-to-Shape) polynomial regression coefficients from the trained PyTorch model weights and replicate the exact computation in TypeScript — eliminating the current indirect approach of training our own regression on SHAPY's outputs. SHAPY (CVPR 2022) contains a polynomial regression model trained on the CAESAR dataset of 4,400+ 3D body scans that maps body measurements directly to SMPL beta parameters. By extracting the actual weight matrices and polynomial feature expansion logic, we can reproduce SHAPY's computation with floating-point-identical results in the browser, with no PyTorch dependency at runtime.

The current pipeline (`smplRegressor.ts`) uses a polynomial regression trained on SHAPY-generated synthetic data (`calibration_dataset.json`, 7,500 pairs). This is a regression-on-a-regression — we approximated SHAPY's outputs rather than using SHAPY's actual math. The extracted A2S path will serve as a higher-accuracy alternative to both the existing 4-input and 8-input regression paths when the user provides measurements that match SHAPY's expected inputs (height, chest, waist, hip, and potentially gender/age attributes).

## Glossary

- **SHAPY_A2S_Model**: The Attributes-to-Shape polynomial regression model inside the SHAPY codebase (https://github.com/muelea/shapy) that maps body measurements to SMPL-X beta parameters. Trained on the CAESAR dataset of 4,400+ 3D body scans. Stored as PyTorch checkpoint weights.
- **A2S_Coefficient_Extractor**: A Python script (`scripts/extract-shapy-a2s.py`) that loads the SHAPY A2S trained model weights from a PyTorch checkpoint, inspects the polynomial feature expansion, extracts the weight matrices and bias vectors, and exports them as a JSON artifact.
- **A2S_Coefficient_Artifact**: A JSON file (`src/data/shapy_a2s_coefficients.json`) containing the extracted polynomial regression weight matrix, bias vector, polynomial degree, feature ordering, and input normalization parameters from the SHAPY_A2S_Model. Loaded at runtime by the TypeScript A2S module.
- **Polynomial_Feature_Expander**: A function that takes raw measurement inputs and expands them into polynomial features (e.g., degree-2 expansion of N inputs produces N + N*(N+1)/2 features including cross-terms). Must replicate the exact expansion SHAPY uses internally.
- **A2S_TypeScript_Module**: A TypeScript module (`src/utils/shapyA2S.ts`) that implements SHAPY's A2S polynomial computation using the extracted coefficients — polynomial feature expansion followed by matrix multiplication to produce 10 SMPL betas.
- **SMPL_Regressor**: The `smplRegressor.ts` module containing `lookupRegress()`, `computeSmplBetas()`, and the layered beta pipeline.
- **SMPL_Forward_Pass**: The `smplForwardPass.ts` module that computes vertex positions from beta parameters: V = T + Σ(βᵢ × Sᵢ).
- **Measurement_Extractor**: The `measurementExtractor.ts` module that computes circumferences from the deformed SMPL mesh at anatomical cross-sections.
- **Round_Trip_Error**: The absolute difference (in cm) between an input measurement and the measurement extracted from the SMPL mesh after the full pipeline: input → A2S → betas → forward pass → mesh → measurement extraction.
- **CAESAR_Dataset**: The Civilian American and European Surface Anthropometry Resource dataset of 4,400+ 3D body scans used to train SHAPY's A2S model.
- **Calibrated_Coefficients**: The existing `calibrated_coefficients.json` file containing the 4-input and (upcoming) 8-input regression weights, preset offsets, composition bias, sensitivity map, and fat distribution vectors.
- **A2S_Input_Vector**: The specific set of measurements SHAPY's A2S model expects as input (to be determined by inspecting the SHAPY source code — likely height, chest, waist, hip, and possibly gender, age, or other semantic attributes).
- **Validation_Suite**: A test suite that compares the TypeScript A2S output against SHAPY's Python A2S output for a large set of inputs to verify extraction correctness.

## Requirements

### Requirement 1: SHAPY A2S Source Code Inspection and Documentation

**User Story:** As a developer, I want to understand exactly how SHAPY's A2S model constructs polynomial features and maps them to betas, so that I can extract and replicate the computation faithfully.

#### Acceptance Criteria

1. THE A2S_Coefficient_Extractor SHALL inspect the SHAPY source code to determine: the exact input features the A2S model expects (measurement names and units), the polynomial degree used for feature expansion, the order of polynomial terms in the expanded feature vector, and any input normalization or preprocessing applied before polynomial expansion
2. THE A2S_Coefficient_Extractor SHALL document the discovered A2S architecture in a comment block at the top of the extraction script, including: input feature names, polynomial degree, number of expanded features, output dimensionality (number of betas), and any preprocessing steps
3. WHEN the SHAPY A2S model uses a polynomial feature expansion different from sklearn's `PolynomialFeatures` (e.g., custom ordering, missing interaction terms, or additional features), THE A2S_Coefficient_Extractor SHALL document the exact differences and replicate the custom expansion

### Requirement 2: A2S Coefficient Extraction Script

**User Story:** As a developer, I want a Python script that extracts the polynomial regression weight matrices from SHAPY's trained A2S model checkpoint, so that I have the exact coefficients needed for TypeScript replication.

#### Acceptance Criteria

1. THE A2S_Coefficient_Extractor SHALL load the SHAPY A2S trained model weights from a PyTorch checkpoint file (path provided as a command-line argument or configuration)
2. THE A2S_Coefficient_Extractor SHALL extract the polynomial regression weight matrix (mapping expanded polynomial features to beta components) and bias vector from the loaded model
3. THE A2S_Coefficient_Extractor SHALL export the extracted coefficients as the A2S_Coefficient_Artifact JSON file containing: the weight matrix (as a 2D array), the bias vector (as a 1D array), the polynomial degree, the ordered list of input feature names, any input normalization parameters (mean, std, min, max), and the number of output betas
4. IF the SHAPY A2S model contains multiple regression stages or layers (e.g., separate models per gender, or cascaded regressions), THEN THE A2S_Coefficient_Extractor SHALL extract all stages and document the routing logic
5. THE A2S_Coefficient_Extractor SHALL verify the extraction by running a set of 10 test inputs through both the original PyTorch model and the extracted matrices, asserting that the outputs match within 1e-6 absolute tolerance

### Requirement 3: A2S Coefficient Artifact Format

**User Story:** As a developer, I want the extracted coefficients stored in a well-defined JSON format, so that the TypeScript module can load and use them reliably.

#### Acceptance Criteria

1. THE A2S_Coefficient_Artifact SHALL be a single JSON file at `src/data/shapy_a2s_coefficients.json` containing all information needed to replicate the A2S computation without access to the SHAPY codebase or PyTorch
2. THE A2S_Coefficient_Artifact SHALL include a `metadata` section with: extraction date, SHAPY model version or checkpoint path hash, polynomial degree, number of input features, number of expanded features, and number of output betas
3. THE A2S_Coefficient_Artifact SHALL be less than 100KB in size (minified JSON), ensuring fast loading in the browser
4. THE A2S_Coefficient_Artifact SHALL also be copied to `public/data/shapy_a2s_coefficients.json` for runtime access by the browser application
5. FOR ALL valid A2S_Coefficient_Artifact JSON files, parsing the JSON then serializing it back to JSON then parsing again SHALL produce an object with identical weight matrix and bias vector values (within floating-point precision of 1e-10)

### Requirement 4: TypeScript A2S Polynomial Computation

**User Story:** As a developer, I want a TypeScript module that replicates SHAPY's A2S polynomial regression using the extracted coefficients, so that I can compute SHAPY-quality betas in the browser without PyTorch.

#### Acceptance Criteria

1. THE A2S_TypeScript_Module SHALL implement a function `computeA2SBetas(inputs)` that takes the same measurement inputs the SHAPY_A2S_Model expects and returns a Float64Array of 10 SMPL beta parameters
2. THE A2S_TypeScript_Module SHALL implement the Polynomial_Feature_Expander that replicates the exact polynomial feature expansion SHAPY uses internally, producing the same number of expanded features in the same order
3. THE A2S_TypeScript_Module SHALL compute betas as: `betas = polynomialFeatures(normalizedInputs) × weightMatrix + biasVector`, matching the SHAPY A2S computation exactly
4. THE A2S_TypeScript_Module SHALL load the A2S_Coefficient_Artifact at initialization and validate that the metadata (polynomial degree, feature count, beta count) matches the expected values
5. WHEN the A2S_TypeScript_Module receives inputs outside the training range of the SHAPY_A2S_Model (e.g., height < 140cm or > 210cm), THE A2S_TypeScript_Module SHALL clamp the output betas to [-3, 3] and log a warning
6. THE A2S_TypeScript_Module SHALL export a `loadA2SCoefficients(url?)` async function for loading the coefficient artifact, and an `isA2SAvailable()` function that returns whether coefficients have been loaded

### Requirement 5: Integration with Existing Regressor Pipeline

**User Story:** As a developer, I want the A2S path integrated into the existing beta pipeline as a higher-accuracy alternative, so that users get the best possible betas when they provide measurements that match SHAPY's expected inputs.

#### Acceptance Criteria

1. WHEN the A2S_Coefficient_Artifact is loaded and the user provides all measurements that the SHAPY_A2S_Model expects, THE SMPL_Regressor SHALL use the A2S path in `lookupRegress()` instead of the 4-input or 8-input regression paths
2. WHEN the user provides measurements that do not fully match the SHAPY A2S expected inputs (e.g., missing chest or hip), THE SMPL_Regressor SHALL fall back to the 8-input regression path (if available) or the 4-input path
3. THE SMPL_Regressor SHALL apply the same layered pipeline after the A2S base regression: preset offsets → composition bias → clamp [-3, 3]. The A2S path replaces only the base regression step.
4. WHEN the A2S path is used with all required measurements, THE `computeSmplBetas()` pipeline SHALL skip the `refineWithCustomMeasurements()` loop, since the A2S betas already incorporate the measurements directly
5. THE SMPL_Regressor SHALL expose a way to determine which regression path was used (A2S, 8-input, 4-input, or heuristic) for debugging and logging purposes

### Requirement 6: Validation Against SHAPY Python Output

**User Story:** As a developer, I want to verify that the TypeScript A2S module produces identical betas to running SHAPY's Python A2S model, so that I can be confident the extraction is correct.

#### Acceptance Criteria

1. THE Validation_Suite SHALL compare the TypeScript A2S output against the Python SHAPY A2S output for at least 100 diverse input combinations spanning the population range (height 150–200cm, chest 75–130cm, waist 60–120cm, hip 80–135cm, both genders)
2. FOR ALL validation inputs, THE absolute difference between the TypeScript A2S betas and the Python SHAPY A2S betas SHALL be less than 1e-4 per beta component (allowing for floating-point differences between Python float64 and TypeScript number)
3. THE A2S_Coefficient_Extractor SHALL generate a validation dataset file (`scripts/data/a2s_validation_pairs.json`) containing input measurements and the corresponding Python-computed betas, which the TypeScript test suite can load and compare against
4. THE Validation_Suite SHALL be runnable as a Vitest test that loads the validation dataset and the A2S_Coefficient_Artifact, computes betas via the TypeScript A2S module, and asserts per-component accuracy

### Requirement 7: Round-Trip Accuracy Improvement

**User Story:** As a developer, I want the A2S path to produce significantly better round-trip accuracy than the current regression paths, so that the avatar closely matches the user's actual measurements.

#### Acceptance Criteria

1. WHEN the A2S path is used with ground-truth measurements from the ANSUR II validation set (100+ subjects), THE Round_Trip_Error for chest circumference SHALL have a mean of less than 4cm
2. WHEN the A2S path is used with ground-truth measurements, THE Round_Trip_Error for waist circumference SHALL have a mean of less than 4cm
3. WHEN the A2S path is used with ground-truth measurements, THE Round_Trip_Error for hip circumference SHALL have a mean of less than 4cm
4. THE Validation_Suite SHALL produce a comparison report showing per-measurement round-trip accuracy for the A2S path, the 8-input regression path, and the 4-input regression path side-by-side, demonstrating the A2S path's improvement

### Requirement 8: Round-Trip Property for A2S Path

**User Story:** As a developer, I want property-based tests that verify the A2S round-trip holds for random inputs, so that regressions are caught automatically.

#### Acceptance Criteria

1. THE test suite SHALL include a property-based test using fast-check that generates random valid A2S input combinations and verifies the round-trip pipeline (inputs → `computeA2SBetas()` → `computeSmplVertices()` → `extractMeasurements()`) produces extracted measurements within a defined tolerance of the input measurements
2. FOR ALL randomly generated A2S inputs, THE round-trip chest circumference error SHALL be less than 5cm
3. FOR ALL randomly generated A2S inputs, THE round-trip waist circumference error SHALL be less than 5cm
4. FOR ALL randomly generated A2S inputs, THE round-trip hip circumference error SHALL be less than 5cm
5. THE property-based tests SHALL run with at least 50 iterations per property, using the SMPL model binary loaded once in a beforeAll hook

### Requirement 9: A2S Beta Boundedness and Structural Properties

**User Story:** As a developer, I want structural property tests that verify the A2S module produces valid, bounded betas for all inputs, so that the forward pass never receives degenerate values.

#### Acceptance Criteria

1. FOR ALL valid A2S input combinations (within the SHAPY training range), THE `computeA2SBetas()` function SHALL return a Float64Array of length 10 where every element is a finite number
2. FOR ALL valid A2S input combinations, THE output betas SHALL be in the range [-3, 3] after clamping
3. THE A2S_TypeScript_Module SHALL produce continuous beta changes as inputs vary smoothly — no discontinuities greater than 0.5 beta units per 1cm change in any single input measurement
4. FOR ALL valid A2S_Coefficient_Artifact JSON files, parsing then serializing then parsing again SHALL produce an object with identical weight matrix and bias vector values (within 1e-10)

### Requirement 10: Backward Compatibility

**User Story:** As a user, I want the existing 4-input and 8-input regression paths to remain unchanged, so that the A2S path is an additional option and not a forced replacement.

#### Acceptance Criteria

1. WHEN the A2S_Coefficient_Artifact is not present (not loaded or file missing), THE SMPL_Regressor SHALL produce identical output to the current implementation using the 4-input or 8-input regression paths
2. THE SMPL_Regressor SHALL maintain the same public API: `computeSmplBetas(inputs, model?)` returning `Float64Array(10)`, `lookupRegress(inputs)` returning `Float64Array(10)`, and all existing exported types and interfaces
3. THE SMPL_Regressor SHALL maintain the same layered pipeline order: base regression → preset offsets → composition bias → custom measurement refinement (when applicable) → clamp [-3, 3]
4. THE existing property-based tests (`smplRegressor.prop.test.ts`) SHALL continue to pass with the A2S coefficients loaded
5. THE existing unit tests (`smplRegressor.unit.test.ts`) SHALL continue to pass without modification
