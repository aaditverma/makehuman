# Requirements Document

## Introduction

The current heatmap fit calculation uses a limited set of measurement points per garment: tops compare only chest, waist, and shoulder; bottoms compare only waist, hip, and thigh. Several body measurements already predicted by the ML model (neck, bicep, calf, wrist, inseam) are unused in fit scoring. Additionally, some measurements used in fit scoring are rough estimates derived from other measurements (thigh estimated as hip × 0.56, shoulder estimated as chest × 0.45) rather than using the ML model's direct predictions. This feature expands the measurement point coverage per garment, uses ML-predicted values directly, adds new height-to-measurement regions, and introduces per-measurement weighting so that the heatmap produces more accurate and granular fit visualizations.

## Glossary

- **Heatmap_Engine**: The module (`src/utils/heatmapEngine.ts`) that computes per-vertex fit scores for garment visualization on the 3D body model.
- **ML_Model**: The gradient boosting lookup table (`src/data/ansur2_model.json`) that predicts body measurements from height, weight, age, and gender via trilinear interpolation.
- **Morph_Mapper**: The module (`src/utils/morphMapper.ts`) that converts user inputs to morph target influences and provides `estimatedMeasurements()`.
- **Fit_Score**: A value from -1 (tight) through 0 (balanced) to +1 (loose) representing how a garment measurement compares to the corresponding body measurement given a fit preference.
- **Ease**: The difference in centimeters between a garment measurement and the corresponding body measurement (garment − body).
- **Height_Region**: A mapping entry that associates a normalized body height position (0–1) with a named body measurement, used for Gaussian-weighted blending of fit scores across vertices.
- **Ease_Target**: A per-measurement, per-fit-preference range `[min, max]` in centimeters defining the ideal ease for a balanced fit score.
- **Body_Store**: The Zustand state store (`src/stores/bodyStore.ts`) holding user inputs, garment selection, and heatmap state.
- **Size_Chart**: A record mapping size labels to measurement values in centimeters for a specific garment.
- **Measurement_Weight**: A numeric value (0–1) indicating how much a given measurement contributes to the blended fit score in regions where multiple measurements overlap.

## Requirements

### Requirement 1: Expand Estimated Measurements to Include All ML-Predicted Values

**User Story:** As a developer integrating the heatmap engine, I want `estimatedMeasurements()` to return all measurements predicted by the ML model, so that the heatmap engine can use direct predictions instead of rough estimates.

#### Acceptance Criteria

1. THE Morph_Mapper `estimatedMeasurements()` function SHALL return an object containing all of the following measurement fields in centimeters: `bustCm`, `waistCm`, `hipCm`, `highHipCm`, `inseamCm`, `shoulderCm`, `neckCm`, `bicepCm`, `thighCm`, `calfCm`, `wristCm`, and `bmi`.
2. WHEN a user has provided a custom measurement override for a field, THE Morph_Mapper SHALL use the override value for that field instead of the ML-predicted value.
3. WHEN no custom override is provided, THE Morph_Mapper SHALL use the ML_Model lookup with trilinear interpolation to produce the measurement value.

### Requirement 2: Add New Height Regions for Unused Measurements

**User Story:** As a user viewing the heatmap, I want the fit visualization to reflect more body zones (neck, bicep, calf, wrist), so that I can see fit accuracy across the full garment coverage area.

#### Acceptance Criteria

1. THE Heatmap_Engine `heightToMeasurement` array SHALL include Height_Region entries for at least the following measurements: shoulder, chest, waist, hip, thigh, neck, bicep, calf, and wrist.
2. WHEN a new Height_Region is added, THE Heatmap_Engine SHALL assign an `hCenter` value corresponding to the body landmark's normalized height position as documented in PROJECT_MASTER.md (neck at 0.85, bicep at approximately 0.62, calf at 0.18, wrist at approximately 0.48).
3. WHEN a new Height_Region is added, THE Heatmap_Engine SHALL assign an `hWidth` value that produces smooth Gaussian blending without visible banding between adjacent regions.

### Requirement 3: Expand Garment Size Charts with Additional Measurement Points

**User Story:** As a user trying on a garment, I want the size chart to include more measurement points (e.g., neck and bicep for tops, calf and inseam for bottoms), so that the fit heatmap reflects how the garment fits across more body zones.

#### Acceptance Criteria

1. THE Heatmap_Engine size chart for top-type garments (tee, oxford) SHALL include measurement values for at least: chest, waist, shoulder, neck, and bicep.
2. THE Heatmap_Engine size chart for the oxford garment SHALL additionally include a wrist measurement value, since the oxford has long sleeves extending to the wrist.
3. THE Heatmap_Engine size chart for bottom-type garments (slim-jeans, straight-jeans) SHALL include measurement values for at least: waist, hip, thigh, calf, and inseam.
4. WHEN a garment size chart includes a measurement, THE Heatmap_Engine SHALL use that measurement in the fit score calculation for the corresponding Height_Region.

### Requirement 4: Replace Derived Estimates with ML-Predicted Measurements in Fit Calculation

**User Story:** As a user, I want the fit calculation to use accurate body measurements from the ML model rather than rough ratios, so that the heatmap reflects my actual body proportions.

#### Acceptance Criteria

1. THE Heatmap_Engine `computeHeatmap` function SHALL accept a body measurements object that includes all fields returned by `estimatedMeasurements()` (shoulder, neck, bicep, thigh, calf, wrist, inseam in addition to bust, waist, hip).
2. THE Heatmap_Engine SHALL use the provided thigh measurement directly instead of estimating thigh as `hipCm × 0.56`.
3. THE Heatmap_Engine SHALL use the provided shoulder measurement directly instead of estimating shoulder as `bustCm × 0.45`.
4. WHEN the Heatmap_Engine builds its internal `bodyMap`, THE Heatmap_Engine SHALL populate each measurement key from the corresponding field in the body measurements object.

### Requirement 5: Expand Ease Targets for New Measurements

**User Story:** As a developer, I want ease target ranges defined for every measurement used in fit scoring, so that the fit score calculation can evaluate all measurement points against the user's fit preference.

#### Acceptance Criteria

1. THE Heatmap_Engine `easeTargets` record SHALL define `[min, max]` ease ranges for every measurement present in any garment size chart, including neck, bicep, calf, wrist, and inseam.
2. THE Heatmap_Engine `easeTargets` record SHALL define ease ranges for all five fit preferences: compression, slim, regular, relaxed, and oversized.
3. WHEN a new measurement is added to `easeTargets`, THE Heatmap_Engine SHALL use anatomically appropriate ease ranges (e.g., neck ease ranges are smaller than chest ease ranges because neck fit tolerance is tighter).

### Requirement 6: Introduce Per-Measurement Weighting in Fit Score Blending

**User Story:** As a user, I want primary fit zones (chest, waist, hip) to have more influence on the heatmap than secondary zones (wrist, calf), so that the visualization prioritizes the measurements that matter most for garment fit.

#### Acceptance Criteria

1. THE Heatmap_Engine SHALL assign a Measurement_Weight to each Height_Region entry.
2. WHEN blending fit scores across Height_Regions using Gaussian weights, THE Heatmap_Engine SHALL multiply each region's Gaussian weight by its Measurement_Weight before computing the weighted average.
3. THE Heatmap_Engine SHALL assign higher Measurement_Weight values (0.8–1.0) to primary fit measurements (chest, waist, hip, thigh) and lower values (0.4–0.7) to secondary measurements (neck, bicep, calf, wrist, inseam).
4. WHEN all Measurement_Weights are set to 1.0, THE Heatmap_Engine SHALL produce the same result as the current unweighted blending behavior.

### Requirement 7: Update BodyModel Heatmap Integration

**User Story:** As a developer, I want the BodyModel component to pass the expanded measurements object to the heatmap engine, so that the new measurement points are used in the 3D visualization.

#### Acceptance Criteria

1. WHEN the heatmap is enabled, THE BodyModel component SHALL call `estimatedMeasurements()` and pass the full returned object to `computeHeatmap()`.
2. THE BodyModel component SHALL require no changes to vertex processing, normal reading, or color assignment logic beyond updating the measurements object passed to `computeHeatmap()`.

### Requirement 8: Maintain Backward Compatibility of Fit Score Range

**User Story:** As a user, I want the heatmap color mapping to remain consistent after the fit calculation improvements, so that I can interpret the visualization the same way as before.

#### Acceptance Criteria

1. THE Heatmap_Engine `computeHeatmap` function SHALL continue to produce Fit_Score values in the range [-1, +1].
2. THE `fitScoreToColor` function SHALL remain unchanged: -1 maps to red (tight), 0 maps to green (balanced), +1 maps to blue (loose).
3. WHEN a garment size chart does not include a particular measurement, THE Heatmap_Engine SHALL skip that measurement in the fit score calculation rather than using a default or zero value.
