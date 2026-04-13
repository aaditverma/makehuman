# Requirements Document

## Introduction

Phase 2 of the body editor / clothing fit platform: **Generated Garment Shell from Specs**. The system generates 3D garment meshes (T-Shirt, Oxford Shirt, Slim Jeans, Straight Jeans) that sit on the body as separate scene objects. Garment shapes are pre-baked in Blender using cloth simulation against multiple body shapes, exported as GLB files with morph targets. At runtime in Three.js, the system blends between pre-computed garment shapes based on user measurements. Heatmap fit colors are applied to the garment shell. Any brand can plug in their own size chart to drive garment shape. The system remains fully client-side with no server dependency.

## Glossary

- **Garment_Shell**: A separate 3D mesh representing a clothing item (e.g., T-Shirt, Oxford Shirt, Slim Jeans, Straight Jeans) that sits on top of the body model as an independent Three.js scene object
- **Blender_Pipeline**: The set of Python scripts executed in Blender (headless mode) that create garment meshes, run cloth simulation, bake morph targets, and export GLB files
- **Cloth_Simulation**: Blender's built-in cloth physics solver used offline to drape garment pattern meshes onto body shapes, producing realistic fabric behavior (folds, drape, tension)
- **Morph_Target**: A shape key (blend shape) stored in the GLB file that encodes the vertex displacement between a base garment shape and a variant garment shape (e.g., garment on a heavier body vs. base body)
- **Body_Morph_Target**: An existing shape key on the body model (human-male.glb) that deforms the body mesh (e.g., Heavier, WiderShoulders)
- **Garment_Morph_Target**: A shape key on a garment GLB that deforms the garment mesh to match a corresponding body shape variation
- **Size_Chart**: A JSON data structure defining garment measurements (chest, waist, hip, etc.) per size label (XS–XXL for tops, 28–38 for jeans) for a specific brand
- **Default_Size_Chart**: The built-in size chart currently defined in heatmapEngine.ts, used when no brand-specific chart is provided
- **Brand_Size_Chart**: A size chart provided by an external brand that overrides the default measurements for garment generation and fit calculation
- **Garment_Loader**: The Three.js module responsible for loading garment GLB files, applying morph target influences, and adding the garment mesh to the scene
- **Fit_Heatmap**: The color overlay (red=tight, green=balanced, blue=loose) applied to garment shell vertices based on the difference between body measurements and garment measurements for a given fit preference
- **Garment_Material**: A semi-transparent MeshPhysicalMaterial applied to garment shells so the body skin is partially visible underneath
- **Base_Body_Shape**: The default body mesh pose (average male, 175cm, 75kg) against which the base garment shape is simulated
- **Variant_Body_Shape**: A body mesh with one or more morph targets applied (e.g., Heavier at 100%) against which a variant garment simulation is run to produce a garment morph target
- **Garment_Pattern**: A 2D sewing pattern converted to a 3D mesh positioned around the body, used as the starting state for cloth simulation in Blender
- **Offset_Distance**: The gap (in meters) between the garment shell surface and the body skin surface, preventing z-fighting and simulating fabric thickness

## Requirements

### Requirement 1: Blender Garment Pattern Creation

**User Story:** As a developer, I want a Blender script that creates parametric garment pattern meshes for each garment type, so that cloth simulation has a starting shape to drape onto the body.

#### Acceptance Criteria

1. WHEN the Blender script is executed with a garment type parameter (tee, oxford, slim-jeans, straight-jeans), THE Blender_Pipeline SHALL create a 3D garment pattern mesh positioned around the imported body model
2. THE Blender_Pipeline SHALL generate garment patterns with dimensions derived from the Size_Chart measurements for the specified size (default: M for tops, 32 for jeans)
3. WHEN a T-Shirt pattern is requested, THE Blender_Pipeline SHALL create a tubular torso piece with short sleeve extensions, a round neckline cutout, and a hem at normalized body height 0.44
4. WHEN an Oxford Shirt pattern is requested, THE Blender_Pipeline SHALL create a tubular torso piece with long sleeve extensions to the wrist, a collar neckline, and a hem at normalized body height 0.44
5. WHEN Slim Jeans are requested, THE Blender_Pipeline SHALL create two tubular leg pieces joined at the waist with a waistband, tapering from hip width to a narrow ankle opening
6. WHEN Straight Jeans are requested, THE Blender_Pipeline SHALL create two tubular leg pieces joined at the waist with a waistband, maintaining a consistent width from knee to ankle
7. THE Blender_Pipeline SHALL position each garment pattern mesh with an Offset_Distance of 0.003 to 0.008 meters from the body surface to prevent z-fighting

### Requirement 2: Cloth Simulation Baking

**User Story:** As a developer, I want the Blender pipeline to run cloth simulation on garment patterns against the body, so that garment meshes have realistic drape and fabric behavior.

#### Acceptance Criteria

1. WHEN a garment pattern mesh is created, THE Blender_Pipeline SHALL pin the garment at anchor points (waistband for jeans, shoulder seams for tops) and run Blender cloth simulation against the body mesh acting as a collision object
2. THE Blender_Pipeline SHALL configure cloth simulation with fabric-appropriate parameters: cotton weight (0.3 kg/m²), structural stiffness (15–40), and bending stiffness (0.5–5.0)
3. WHEN cloth simulation completes, THE Blender_Pipeline SHALL bake the final simulated frame as the garment rest shape
4. THE Blender_Pipeline SHALL verify that the baked garment mesh has zero interpenetration with the body mesh (no garment vertices inside the body volume)
5. IF cloth simulation produces interpenetrating vertices, THEN THE Blender_Pipeline SHALL push those vertices outward along the body surface normal by the minimum Offset_Distance

### Requirement 3: Garment Morph Target Generation

**User Story:** As a developer, I want the Blender pipeline to generate morph targets for each garment by simulating cloth drape on multiple body shape variants, so that garments adapt to different body shapes at runtime.

#### Acceptance Criteria

1. FOR EACH garment type and size combination, THE Blender_Pipeline SHALL simulate cloth drape on the Base_Body_Shape to produce the basis shape key
2. FOR EACH relevant Body_Morph_Target (Heavier, Thinner, WiderShoulders, WiderHips, BiggerChest, BiggerStomach, ThickerThighs, ThickerCalves at 100% influence), THE Blender_Pipeline SHALL simulate cloth drape on the corresponding Variant_Body_Shape and store the result as a Garment_Morph_Target with the same name
3. THE Blender_Pipeline SHALL apply Laplacian smoothing (minimum 4 passes) to each Garment_Morph_Target displacement to prevent spiky artifacts, consistent with the body morph smoothing approach in generate-morphs.py
4. THE Blender_Pipeline SHALL export each garment as a separate GLB file containing the basis mesh and all Garment_Morph_Targets, with morph normals disabled to reduce file size
5. THE Blender_Pipeline SHALL name exported files following the pattern: garment-{type}-{size}.glb (e.g., garment-tee-M.glb, garment-slim-jeans-32.glb)

### Requirement 4: Garment GLB Loading and Scene Integration

**User Story:** As a user, I want to see a 3D garment mesh appear on my body avatar when I select a garment type and size, so that I can visualize how clothing looks on my body shape.

#### Acceptance Criteria

1. WHEN the user selects a garment type and size in the control panel, THE Garment_Loader SHALL load the corresponding garment GLB file and add the garment mesh as a separate child object in the Three.js scene
2. WHEN a garment GLB is loaded, THE Garment_Loader SHALL apply Garment_Morph_Target influences that match the current Body_Morph_Target influences on the body mesh
3. WHEN the user changes body inputs (height, weight, age, body type, or custom measurements), THE Garment_Loader SHALL update Garment_Morph_Target influences to match the recalculated Body_Morph_Target influences with smooth animated transitions (matching the body morph animation speed)
4. WHEN the user switches garment type or size, THE Garment_Loader SHALL remove the previous garment mesh from the scene and load the new garment GLB
5. THE Garment_Loader SHALL scale the garment mesh using the same height and width scaling factors applied to the body model group
6. IF a garment GLB file fails to load, THEN THE Garment_Loader SHALL log a warning to the console and continue displaying the body model without a garment shell

### Requirement 5: Garment Material and Rendering

**User Story:** As a user, I want the garment shell to appear as semi-transparent fabric over my body, so that I can see both the clothing shape and my body underneath.

#### Acceptance Criteria

1. THE Garment_Material SHALL use a MeshPhysicalMaterial with opacity between 0.6 and 0.85, transparency enabled, and double-sided rendering
2. THE Garment_Material SHALL render with a roughness between 0.7 and 0.9 to simulate fabric surface appearance
3. THE Garment_Material SHALL use depth write disabled and a render order higher than the body mesh to prevent z-fighting artifacts between the garment and body surfaces
4. WHILE the heatmap is disabled, THE Garment_Material SHALL display a neutral fabric color (light gray or white)

### Requirement 6: Heatmap on Garment Shell

**User Story:** As a user, I want fit heatmap colors displayed on the garment shell instead of the body skin, so that I can see fit information directly on the clothing.

#### Acceptance Criteria

1. WHILE the heatmap is enabled and a Garment_Shell is loaded, THE Fit_Heatmap SHALL apply vertex colors to the garment mesh vertices using the same fit scoring algorithm (computeHeatmap) currently used for body skin vertices
2. WHEN heatmap colors are applied to the Garment_Shell, THE Fit_Heatmap SHALL use the garment vertex positions (normalized height, distance from center) to look up fit scores from the heatmap engine
3. THE Fit_Heatmap SHALL apply Laplacian color smoothing to garment vertex colors using the existing smoothingEngine (buildAdjacency + smoothColors) with the same parameters (2 iterations, weight 0.5)
4. WHILE the heatmap is enabled and a Garment_Shell is visible, THE body skin underneath SHALL display without heatmap colors (skin texture only) to avoid visual clutter from overlapping color layers
5. WHEN the user toggles the heatmap off, THE Garment_Shell SHALL revert to the neutral Garment_Material without vertex colors

### Requirement 7: Brand Size Chart System

**User Story:** As a brand integrator, I want to provide my own size chart data, so that the garment shell and fit calculations use my brand's specific measurements.

#### Acceptance Criteria

1. THE Size_Chart system SHALL define a JSON schema for brand size charts containing: brand name, garment type, size labels, and measurement values (chest, waist, hip, shoulder, neck, bicep, thigh, calf, inseam, wrist) per size
2. WHEN a Brand_Size_Chart is loaded, THE Size_Chart system SHALL validate that all required measurement fields are present for each declared size and that all values are positive numbers
3. WHEN a valid Brand_Size_Chart is active, THE Fit_Heatmap SHALL use the brand measurements instead of the Default_Size_Chart measurements for fit score calculation
4. WHEN no Brand_Size_Chart is provided, THE Size_Chart system SHALL fall back to the Default_Size_Chart defined in heatmapEngine.ts
5. THE Size_Chart system SHALL expose a TypeScript interface (BrandSizeChart) that brands can implement to provide their measurement data
6. IF a Brand_Size_Chart contains invalid data (missing fields, non-positive values, unknown garment type), THEN THE Size_Chart system SHALL reject the chart with a descriptive error message and continue using the Default_Size_Chart

### Requirement 8: Garment Shell Coordinate Alignment

**User Story:** As a developer, I want garment meshes to align correctly with the body model in the Three.js scene, so that clothing sits naturally on the avatar regardless of body shape.

#### Acceptance Criteria

1. THE Blender_Pipeline SHALL export garment GLB files using the same coordinate conventions as the body model: Y-up, Z-negative as front (belly), Z-positive as back
2. THE Garment_Loader SHALL position the garment mesh at the same origin as the body mesh (feet on ground plane, centered on X and Z axes)
3. WHEN body morph targets change the body shape, THE Garment_Shell vertices SHALL remain outside the body surface (no interpenetration visible to the user)
4. THE Blender_Pipeline SHALL use the same orientation fix (-90° X rotation) and Y-up GLB export settings as generate-morphs.py to maintain coordinate system consistency

### Requirement 9: Garment Size Chart Serialization

**User Story:** As a developer, I want the garment size chart data to be serializable as JSON, so that brand size charts can be loaded from external files or API responses at runtime.

#### Acceptance Criteria

1. THE Size_Chart system SHALL parse Brand_Size_Chart data from a JSON string using a dedicated parse function
2. THE Size_Chart system SHALL serialize any active Size_Chart (default or brand) to a JSON string using a dedicated stringify function
3. FOR ALL valid Size_Chart objects, parsing the serialized JSON string and then serializing the result SHALL produce an equivalent JSON string (round-trip property)
4. FOR ALL valid Brand_Size_Chart JSON strings, parsing and then serializing SHALL produce a JSON string that parses to an equivalent Size_Chart object (round-trip property)

### Requirement 10: Pipeline Execution and Asset Management

**User Story:** As a developer, I want a single command to regenerate all garment assets, so that the build pipeline is reproducible and automated.

#### Acceptance Criteria

1. WHEN the garment generation script is executed, THE Blender_Pipeline SHALL process all four garment types (tee, oxford, slim-jeans, straight-jeans) for a configurable set of sizes
2. THE Blender_Pipeline SHALL output garment GLB files to the public/models/garments/ directory
3. THE Blender_Pipeline SHALL log progress for each garment-size combination including: pattern creation, simulation status, morph target count, vertex count, and export path
4. WHEN a garment GLB already exists at the output path, THE Blender_Pipeline SHALL overwrite the existing file
5. THE Blender_Pipeline SHALL complete processing of a single garment-size combination within 5 minutes on a machine with a modern CPU (to keep the full pipeline under 1 hour for all combinations)
