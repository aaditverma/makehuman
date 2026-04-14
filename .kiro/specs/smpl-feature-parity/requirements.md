# Requirements Document

## Introduction

Bring the SMPL body engine to full feature parity with the MakeHuman engine. Session 005 built the SMPL infrastructure (forward pass, regressor, measurement extractor, body engine abstraction, dual engine toggle) but left several functional gaps: morph targets only support positive beta values (no thinner-than-average bodies), body type presets and custom measurement inputs are not wired to the SMPL regressor, heatmap vertex coloring is not rendered on the SMPL mesh, estimated measurements are not displayed in SMPL mode, and beta transitions are not animated. This spec closes all those gaps so that a user switching from MakeHuman to SMPL mode experiences identical UI capabilities and visual quality.

## Glossary

- **SMPL_Engine**: The SmplEngine class in bodyEngine.ts that drives the SMPL body model via beta parameters computed by the SMPL_Regressor.
- **MakeHuman_Engine**: The MakeHumanEngine class in bodyEngine.ts that drives the MakeHuman body model via 25 hand-crafted morph targets.
- **SMPL_Beta**: A vector of 10 floating-point shape coefficients in the range [-3, 3] that control body shape variation in the SMPL model. Positive values enlarge features; negative values reduce them below the mean shape.
- **Beta_Morph_Target**: A Three.js morph target (shape key) baked into the SMPL GLB file that corresponds to one SMPL beta principal component. Currently only positive-direction targets exist (Beta0–Beta9).
- **Negative_Beta_Target**: A morph target representing the negative direction of a beta principal component (e.g., Beta0Neg), enabling bodies thinner, shorter, or narrower than the mean shape.
- **Body_Type_Preset**: A named body shape profile (Slim, Average, Athletic, Curvy, Heavy) that maps to a predefined combination of SMPL_Beta values, analogous to the bodyProfiles.json morph response curves used by MakeHuman.
- **SMPL_Regressor**: The smplRegressor.ts module that converts user measurements (height, weight, age, gender, body composition, optional custom measurements) into 10 SMPL_Beta values via a heuristic lookup table or ONNX model.
- **Custom_Measurement**: A user-entered body measurement (bust, waist, hip, high hip, inseam) in cm or inches that overrides the ML-predicted value and feeds into the SMPL_Regressor for more accurate beta computation.
- **Heatmap_Engine**: The heatmapEngine.ts module that computes garment fit scores per vertex and applies color overlays. Includes computeHeatmapSmpl() for SMPL landmark-based region mapping.
- **Estimated_Measurements_Panel**: The UI section in ControlPanel.tsx that displays predicted body measurements (BMI, bust, waist, hip, inseam, etc.) derived from the active body engine.
- **Measurement_Extractor**: The measurementExtractor.ts module that computes circumferences from the deformed SMPL mesh at anatomical cross-sections.
- **ControlPanel**: The React component (ControlPanel.tsx) that renders all user input controls, body type selectors, and measurement displays.
- **BodyModel**: The React component (BodyModel.tsx) that loads 3D models, drives morph targets, applies heatmap vertex colors, and handles animation.
- **Blender_Export_Script**: The generate-smpl-model.py script that converts the SMPL pickle into a GLB file with morph targets, subdivision, and skin texture.
- **Body_Composition**: A user-selected attribute (Athletic, Average, Heavy) that distinguishes muscular vs soft builds at the same weight, stored in bodyStore as bodyComposition.

## Requirements

### Requirement 1: Negative Beta Support

**User Story:** As a user, I want the SMPL body to represent bodies thinner, shorter, or narrower than average, so that slim or petite body shapes are accurately visualized.

#### Acceptance Criteria

1. THE Blender_Export_Script SHALL generate paired morph targets for each beta component: a positive-direction target (Beta0–Beta9) and a Negative_Beta_Target (Beta0Neg–Beta9Neg), producing 20 total shape keys in the SMPL GLB file
2. WHEN the SMPL_Regressor produces a negative beta value for component i, THE BodyModel SHALL set the influence of BetaiNeg to `abs(beta[i]) / 3.0` (clamped to [0, 1]) and set the influence of Betai to 0
3. WHEN the SMPL_Regressor produces a positive beta value for component i, THE BodyModel SHALL set the influence of Betai to `beta[i] / 3.0` (clamped to [0, 1]) and set the influence of BetaiNeg to 0
4. FOR ALL beta values in the range [-3, 3], THE BodyModel SHALL produce a visually correct mesh with no vertex artifacts, self-intersections, or collapsed geometry
5. THE Blender_Export_Script SHALL compute each Negative_Beta_Target by applying a beta value of -3.0 to the corresponding principal component and storing the vertex displacement relative to the template mesh
6. WHEN the SMPL GLB is regenerated with paired morph targets, THE file size SHALL remain under 120 MB (approximately double the current 53.6 MB due to doubled shape key count)

### Requirement 2: Height/Weight/Age/Gender to Beta Mapping

**User Story:** As a user, I want my basic body inputs (height, weight, age, gender) to produce an accurate SMPL body shape, so that the 3D avatar matches my proportions without entering custom measurements.

#### Acceptance Criteria

1. WHEN the user changes height, weight, age, or gender inputs, THE SMPL_Regressor SHALL recompute the 10-dimensional SMPL_Beta vector and trigger a body mesh update within 50ms
2. THE SMPL_Regressor SHALL produce beta vectors where the resulting SMPL mesh height (max Y minus min Y, in model units, scaled to cm) is within 5% of the user-specified heightCm
3. THE SMPL_Regressor SHALL produce beta vectors where the resulting SMPL mesh chest, waist, and hip circumferences (extracted by the Measurement_Extractor) are within 5cm of the values predicted by the ANSUR II lookup table for the same height/weight/age/gender inputs
4. WHEN gender is set to male, THE SMPL_Regressor SHALL bias beta values toward wider shoulders relative to hips; WHEN gender is set to female, THE SMPL_Regressor SHALL bias beta values toward wider hips relative to shoulders
5. THE SMPL_Regressor SHALL incorporate age as a secondary signal, producing slightly larger waist and torso width betas for older ages (age > 40) compared to younger ages with the same height and weight

### Requirement 3: Body Type Presets for SMPL

**User Story:** As a user, I want to select a body type preset (Slim, Average, Athletic, Curvy, Heavy) and see the SMPL body change accordingly, so that I get a quick approximation without entering detailed measurements.

#### Acceptance Criteria

1. WHEN the user selects a Body_Type_Preset in the ControlPanel, THE SMPL_Regressor SHALL apply preset-specific beta offsets on top of the base height/weight/age/gender beta vector
2. THE system SHALL define beta offset vectors for each of the five presets (Slim, Average, Athletic, Curvy, Heavy) in a configuration data structure analogous to bodyProfiles.json
3. WHEN the Slim preset is selected, THE SMPL_Regressor SHALL reduce overall body size betas (β1 weight/BMI reduced, β5 torso width reduced) producing a visibly leaner body than the Average preset at the same height and weight
4. WHEN the Athletic preset is selected, THE SMPL_Regressor SHALL increase shoulder-to-hip ratio betas (β3 increased) and limb thickness betas (β8, β9 increased) producing a visibly more muscular body than the Average preset
5. WHEN the Heavy preset is selected, THE SMPL_Regressor SHALL increase weight/BMI betas (β1 increased) and torso width betas (β5 increased) producing a visibly larger body than the Average preset
6. WHEN the Curvy preset is selected, THE SMPL_Regressor SHALL increase hip width betas (β7 increased) and chest depth betas (β6 increased) while reducing waist width, producing a visibly curvier body than the Average preset
7. THE Average preset SHALL apply zero beta offsets, producing the same result as no preset selection

### Requirement 4: Custom Measurement to Beta Mapping

**User Story:** As a user, I want to enter my actual bust, waist, hip, and inseam measurements and have the SMPL body match those measurements, so that the fit visualization is as accurate as possible.

#### Acceptance Criteria

1. WHEN the user enters a custom bust/chest measurement, THE SMPL_Regressor SHALL adjust chest-related betas (β6 chest depth, β5 torso width) so that the Measurement_Extractor reports a chest circumference within 3cm of the user-entered value
2. WHEN the user enters a custom waist measurement, THE SMPL_Regressor SHALL adjust waist-related betas (β1 weight/BMI, β5 torso width) so that the Measurement_Extractor reports a waist circumference within 3cm of the user-entered value
3. WHEN the user enters a custom hip measurement, THE SMPL_Regressor SHALL adjust hip-related betas (β7 hip width) so that the Measurement_Extractor reports a hip circumference within 3cm of the user-entered value
4. WHEN the user enters a custom inseam measurement, THE SMPL_Regressor SHALL adjust limb proportion betas (β4 limb proportions) so that the Measurement_Extractor reports an inseam length within 3cm of the user-entered value
5. WHEN the user clears a custom measurement (sets it to null), THE SMPL_Regressor SHALL revert to the ML-predicted value for that measurement and recompute betas accordingly
6. THE SMPL_Regressor SHALL apply custom measurement adjustments as refinement deltas on top of the base beta vector (from height/weight/age/gender + body type preset), preserving the overall body shape while correcting specific regions

### Requirement 5: Heatmap Rendering on SMPL Mesh

**User Story:** As a user, I want to see the fit heatmap on the SMPL body mesh, so that I can visualize where clothing fits tight or loose when using the SMPL engine.

#### Acceptance Criteria

1. WHEN the SMPL_Engine is active and heatmap is enabled, THE BodyModel SHALL compute heatmap vertex colors using computeHeatmapSmpl() with SMPL landmark-based region mapping and apply them to the SMPL mesh BufferGeometry
2. THE BodyModel SHALL read vertex normals from the SMPL mesh geometry and pass normalXAbs and normalYAbs to the heatmap getVertexFit() function for arm detection (armScore = normalXAbs + xAbs * 3)
3. WHEN heatmap colors are applied to the SMPL mesh, THE BodyModel SHALL apply Laplacian smoothing (2 passes, weight 0.5) using the existing smoothingEngine, consistent with MakeHuman heatmap rendering
4. WHEN the heatmap is disabled while the SMPL_Engine is active, THE BodyModel SHALL restore the skin material (MeshPhysicalMaterial with texture) on the SMPL mesh
5. THE heatmap on the SMPL mesh SHALL produce visually equivalent coverage regions (torso, sleeves, legs) and fit score colors (red=tight, green=balanced, blue=loose) as the MakeHuman heatmap for the same user inputs and garment selection
6. WHEN the user switches between SMPL and MakeHuman engines with heatmap enabled, THE BodyModel SHALL recompute and reapply heatmap colors for the newly active mesh within one frame

### Requirement 6: Estimated Measurements Display in SMPL Mode

**User Story:** As a user, I want to see my estimated body measurements when using the SMPL engine, so that I can verify the avatar matches my proportions and use the measurements for size selection.

#### Acceptance Criteria

1. WHEN the SMPL_Engine is active, THE Estimated_Measurements_Panel SHALL display measurements extracted from the deformed SMPL mesh by the Measurement_Extractor (chest, waist, hip, inseam, shoulder, neck, bicep, thigh, calf, wrist, BMI)
2. WHEN the user changes any input (height, weight, age, gender, body type, body composition, custom measurements), THE Estimated_Measurements_Panel SHALL update within 200ms to reflect the new SMPL mesh measurements
3. THE Estimated_Measurements_Panel SHALL display identical measurement labels and formatting (rounded to nearest cm, grid layout) regardless of whether the SMPL or MakeHuman engine is active
4. WHEN the user has entered a custom measurement that differs from the SMPL-extracted value by more than 3cm, THE Estimated_Measurements_Panel SHALL display the SMPL-extracted value (reflecting the actual mesh shape) rather than the user-entered value
5. THE Estimated_Measurements_Panel SHALL display BMI computed from the user's height and weight inputs, not extracted from the mesh

### Requirement 7: Body Composition to SMPL Regressor Wiring

**User Story:** As a user, I want my body composition selection (Athletic, Average, Heavy) to visibly change the SMPL body shape, so that the system distinguishes between muscular and soft builds at the same weight.

#### Acceptance Criteria

1. WHEN the user selects Athletic body composition, THE SMPL_Regressor SHALL bias the beta vector toward wider shoulders (β3 increased), thicker limbs (β8, β9 increased), and narrower waist (β5 decreased) compared to Average composition at the same height and weight
2. WHEN the user selects Heavy body composition, THE SMPL_Regressor SHALL bias the beta vector toward larger waist (β1, β5 increased), softer limbs (β8, β9 decreased relative to Athletic), and wider hips (β7 increased) compared to Average composition
3. WHEN two users have identical height, weight, age, and gender but different body compositions (Athletic vs Heavy), THE SMPL_Regressor SHALL produce SMPL_Beta vectors where the resulting meshes have visibly different shoulder-to-waist ratios and limb definitions
4. THE body composition effect SHALL combine additively with body type preset offsets and custom measurement adjustments, applied in order: base (height/weight/age/gender) → body type preset → body composition bias → custom measurement refinement
5. WHEN the user changes body composition, THE BodyModel SHALL animate the transition between the old and new beta values using the same damping factor as other morph transitions

### Requirement 8: Smooth Animated Transitions for SMPL Beta Changes

**User Story:** As a user, I want the SMPL body to animate smoothly between shapes when I change inputs, so that the experience feels polished and I can see the body morphing rather than snapping.

#### Acceptance Criteria

1. WHEN any user input changes that affects SMPL_Beta values, THE BodyModel SHALL interpolate morph target influences from current values to target values using exponential damping with a speed factor of 10 (matching the existing MakeHuman SMOOTH constant)
2. THE BodyModel SHALL update morph target influences every frame via useFrame(), applying the damping function `current + (target - current) * (1 - exp(-speed * deltaTime))` to each of the 20 morph target influences (10 positive + 10 negative Beta_Morph_Targets)
3. WHEN a beta value transitions from positive to negative (or vice versa), THE BodyModel SHALL smoothly decrease the outgoing morph target influence to 0 while simultaneously increasing the incoming morph target influence, producing a continuous visual transition through the mean shape
4. THE animation system SHALL cap deltaTime at 50ms per frame to prevent large jumps after tab-switch or frame drops
5. WHEN height scaling changes, THE BodyModel SHALL animate the Y-scale and width compensation using the same damping function, consistent with the existing MakeHuman height animation behavior

### Requirement 9: Engine Migration Evaluation

**User Story:** As a developer, I want a documented evaluation of whether to keep the dual engine system or plan a migration to SMPL-only, so that the team can make an informed architectural decision.

#### Acceptance Criteria

1. WHEN all SMPL feature parity requirements (1–8) are implemented, THE developer SHALL document a comparison of SMPL vs MakeHuman across these dimensions: visual quality, measurement accuracy, file size, rendering performance, and feature completeness
2. THE evaluation document SHALL include a recommendation (keep dual engine, deprecate MakeHuman, or migrate to SMPL-only) with justification based on the comparison results
3. THE evaluation document SHALL identify any remaining MakeHuman-only capabilities that SMPL cannot replicate (e.g., facial features, specific morph targets) and assess their importance to the product
4. IF the recommendation is to migrate to SMPL-only, THEN THE evaluation document SHALL include a migration plan with steps to remove MakeHuman dependencies without breaking existing functionality
