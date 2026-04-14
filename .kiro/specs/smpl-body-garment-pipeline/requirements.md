# Requirements Document

## Introduction

Replace the current MakeHuman body model (214k vertices, 25 morph targets, non-standard topology) with an SMPL-based body model system (~6,890 vertices, standardized vertex topology across all body shapes), then build a production-quality garment rendering pipeline on top of SMPL's consistent mesh. SMPL's fixed vertex indices enable garment patterns to be defined relative to known body landmarks, making garment fitting deterministic and reliable — unlike the current approach where morph targets shift vertices unpredictably. The system uses SHAPY (open source, CVPR 2022) or an ONNX-exported SMPL model to regress body shape parameters from user measurements, with a preference for client-side inference via ONNX Runtime Web or TensorFlow.js to preserve the fully-client-side architecture. Production garment meshes replace the current parametric tube garments (POC only) with pre-modeled garment geometry that deforms via SMPL-aligned vertex correspondence.

## Glossary

- **SMPL**: Skinned Multi-Person Linear model — a parametric body model with ~6,890 vertices and consistent vertex topology across all body shapes. Controlled by 10 shape parameters (betas) and 72 pose parameters (thetas).
- **SMPL_Beta**: A vector of 10 floating-point shape coefficients that control body shape variation (height, weight, proportions) in the SMPL model. Each beta modifies the body mesh via learned principal components.
- **SMPL_Theta**: A vector of 72 floating-point pose parameters (24 joints × 3 rotation axes) that control body pose in the SMPL model. For this system, theta is fixed to a neutral standing pose (all zeros or a T-pose).
- **SHAPY**: An open-source system (CVPR 2022) that regresses SMPL body shape parameters from anthropometric measurements and semantic body attributes. Python-based.
- **SMPL_Regressor**: The module responsible for converting user measurements (height, weight, age, gender, optional body measurements) into SMPL_Beta parameters. May run server-side (SHAPY Python) or client-side (ONNX/TF.js exported model).
- **ONNX_Runtime_Web**: A JavaScript library for running ONNX-format neural network models in the browser using WebAssembly or WebGL backends, enabling client-side SMPL inference without a server.
- **SMPL_Forward_Pass**: The computation that takes SMPL_Beta and SMPL_Theta parameters and produces a 3D mesh (vertex positions). Involves shape blend shapes, pose blend shapes, and linear blend skinning.
- **Body_Engine**: The abstraction layer that provides a 3D body mesh from user inputs. The current Body_Engine uses MakeHuman + morph targets. The new Body_Engine uses SMPL.
- **Vertex_Correspondence**: The property of SMPL where vertex index N always refers to the same anatomical location (e.g., left shoulder tip, navel) regardless of body shape parameters. This enables garment patterns to reference fixed vertex indices.
- **Garment_Template**: A pre-modeled 3D garment mesh created in Blender, Marvelous Designer, or CLO3D, with vertices mapped to SMPL body vertex indices via Vertex_Correspondence. Each template defines the garment's rest shape on a reference body.
- **Garment_Deformer**: The runtime module that deforms a Garment_Template to fit the current SMPL body shape by transferring vertex displacements from the SMPL body mesh to the garment mesh using barycentric coordinates or nearest-vertex binding.
- **Barycentric_Binding**: A technique where each garment vertex is bound to a triangle on the SMPL body surface using barycentric coordinates (u, v, w) plus a normal offset. When the body deforms, the garment vertex follows by interpolating the triangle's new position.
- **Binding_Map**: A precomputed data structure that maps each garment vertex to its corresponding SMPL body triangle (face index) and barycentric coordinates (u, v, w) plus normal offset distance. Stored as a JSON or binary file alongside the garment GLB.
- **Normal_Offset**: The distance along the body surface normal at which a garment vertex sits above the body. Preserves fabric thickness and prevents z-fighting.
- **Measurement_Regressor**: The existing ML model (ANSUR II + NHANES gradient boosting) that predicts body measurements from height/weight/age/gender. Its output feeds into the SMPL_Regressor.
- **Heatmap_Engine**: The existing module (heatmapEngine.ts) that computes fit scores per body region by comparing garment measurements to body measurements. Adapted to work with SMPL vertex positions.
- **Garment_Registry**: A configuration file or module that lists all available Garment_Templates with their metadata (garment type, available sizes, binding map path, GLB path).

## Requirements

### Requirement 1: SMPL Model Integration and Forward Pass

**User Story:** As a developer, I want to run the SMPL forward pass in the browser, so that the system can generate body meshes with standardized topology from shape parameters without a server dependency.

#### Acceptance Criteria

1. THE Body_Engine SHALL load an SMPL model (weights, shape blend shapes, pose blend shapes, joint regressor, mesh template, face indices) from a bundled asset file in ONNX or JSON format
2. WHEN SMPL_Beta parameters are provided, THE Body_Engine SHALL compute the SMPL_Forward_Pass and produce a mesh with exactly 6,890 vertices and 13,776 triangular faces
3. THE Body_Engine SHALL execute the SMPL_Forward_Pass in the browser using ONNX Runtime Web (WebAssembly backend) or a pure TypeScript implementation, completing within 100ms on a mid-range laptop
4. WHEN SMPL_Beta parameters change, THE Body_Engine SHALL recompute vertex positions and update the Three.js BufferGeometry in place without creating a new mesh object
5. THE Body_Engine SHALL fix SMPL_Theta to a neutral standing pose (zero vector or predefined A-pose) for all body shape computations
6. THE Body_Engine SHALL output vertex positions in the same coordinate convention as the current system: Y-up, Z-negative as front (belly), Z-positive as back, feet at Y=0

### Requirement 2: Measurement-to-SMPL Regression

**User Story:** As a user, I want to enter my height, weight, age, and gender and see an accurate 3D body that matches my proportions, so that I can trust the fit visualization.

#### Acceptance Criteria

1. WHEN the user provides height, weight, age, and gender inputs, THE SMPL_Regressor SHALL produce a 10-dimensional SMPL_Beta vector that generates a body mesh matching those anthropometric proportions
2. THE SMPL_Regressor SHALL accept optional direct measurements (bust, waist, hip, inseam) and incorporate them to refine the SMPL_Beta prediction beyond what height/weight/age/gender alone provide
3. THE SMPL_Regressor SHALL run client-side using an exported ONNX model or a precomputed lookup table, completing regression within 50ms
4. WHEN the user changes any input, THE SMPL_Regressor SHALL recompute SMPL_Beta parameters and trigger a body mesh update with smooth animated interpolation between the old and new beta values (matching the current morph animation speed of ~10 damping factor)
5. THE SMPL_Regressor SHALL produce body meshes where the predicted chest, waist, and hip circumferences measured on the SMPL mesh are within 3cm of the values predicted by the existing Measurement_Regressor for the same inputs
6. IF the SMPL_Regressor model fails to load or inference fails, THEN THE Body_Engine SHALL fall back to the current MakeHuman morph target system and log a warning

### Requirement 3: SMPL Model Export and Asset Preparation

**User Story:** As a developer, I want an offline script that exports the SMPL model and regression weights into browser-compatible formats, so that the client-side system has all required assets.

#### Acceptance Criteria

1. THE export script SHALL convert the SMPL model (shape blend shapes, pose blend shapes, joint regressor, template vertices, face indices) from the original NumPy/pickle format into either ONNX format or a compact JSON/binary format loadable by the browser
2. THE export script SHALL convert the measurement-to-beta regression model (trained on SHAPY or custom data) into ONNX format compatible with ONNX Runtime Web
3. WHEN the exported SMPL model is loaded in the browser, THE SMPL_Forward_Pass SHALL produce vertex positions identical (within 0.1mm tolerance) to the original Python SMPL implementation for the same beta and theta inputs
4. THE export script SHALL produce a combined asset bundle under 15MB (gzipped) containing the SMPL model weights and regression model, suitable for web delivery
5. THE export script SHALL output the SMPL face index array (triangle connectivity) as a static asset, since SMPL topology is fixed across all shapes
6. THE export script SHALL generate a vertex landmark map that associates SMPL vertex indices with named anatomical landmarks (left shoulder, right shoulder, navel, left hip, right hip, left knee, right knee, left ankle, right ankle, neck base) for use by the Garment_Deformer and Heatmap_Engine

### Requirement 4: Body Engine Abstraction Layer

**User Story:** As a developer, I want a clean abstraction over the body model system, so that the rest of the application (heatmap, garment deformation, UI) does not depend on whether MakeHuman or SMPL is the active body engine.

#### Acceptance Criteria

1. THE Body_Engine SHALL expose a TypeScript interface with methods: `getVertexPositions(): Float32Array`, `getNormals(): Float32Array`, `getFaces(): Uint16Array | Uint32Array`, `getVertexCount(): number`, `getLandmark(name: string): THREE.Vector3`, and `update(inputs: UserInputs): void`
2. WHEN the application initializes, THE Body_Engine SHALL select the active implementation (SMPL or MakeHuman) based on a configuration flag or asset availability
3. THE Body_Engine SHALL emit a mesh-updated event after each `update()` call, which the Garment_Deformer and Heatmap_Engine subscribe to for recomputation
4. THE Body_Engine SHALL provide vertex positions in a format directly usable by Three.js BufferGeometry (Float32Array of interleaved x, y, z values)
5. WHILE the SMPL engine is active, THE Body_Engine SHALL provide Vertex_Correspondence guarantees (vertex index N always maps to the same anatomical location)
6. WHILE the MakeHuman engine is active, THE Body_Engine SHALL continue to use the existing morph target system with no behavioral changes

### Requirement 5: Garment Template Creation Pipeline

**User Story:** As a developer, I want an offline pipeline that creates production-quality garment meshes bound to the SMPL body, so that garments deform correctly with any body shape at runtime.

#### Acceptance Criteria

1. THE garment creation pipeline SHALL accept garment meshes modeled in Blender (or imported from Marvelous Designer/CLO3D) and compute a Binding_Map that maps each garment vertex to the nearest SMPL body surface triangle
2. FOR EACH garment vertex, THE pipeline SHALL compute barycentric coordinates (u, v, w) relative to the bound SMPL triangle and a Normal_Offset distance, storing the result in the Binding_Map
3. THE pipeline SHALL export each Garment_Template as a GLB file containing the garment mesh geometry (vertices, normals, UVs, face indices) without morph targets (deformation is handled at runtime via the Binding_Map)
4. THE pipeline SHALL export the Binding_Map as a companion JSON or binary file alongside each garment GLB, containing per-vertex entries: `{ faceIndex: number, baryU: number, baryV: number, baryW: number, normalOffset: number }`
5. THE pipeline SHALL validate that the Binding_Map covers all garment vertices and that no garment vertex is bound to a degenerate triangle (area < 0.0001 m²)
6. THE pipeline SHALL support garment types: T-Shirt, Oxford Shirt, Slim Jeans, and Straight Jeans, with one Garment_Template per type per size

### Requirement 6: Runtime Garment Deformation

**User Story:** As a user, I want garments to automatically reshape to fit my body when I change my measurements, so that the clothing visualization stays accurate for any body shape.

#### Acceptance Criteria

1. WHEN a Garment_Template and its Binding_Map are loaded, THE Garment_Deformer SHALL compute deformed garment vertex positions by evaluating each garment vertex's barycentric position on the current SMPL body mesh plus the Normal_Offset along the interpolated surface normal
2. WHEN the Body_Engine emits a mesh-updated event, THE Garment_Deformer SHALL recompute all garment vertex positions and update the garment BufferGeometry in place
3. THE Garment_Deformer SHALL complete garment deformation for a single garment (up to 10,000 vertices) within 16ms (one frame at 60fps) to maintain smooth animation
4. THE Garment_Deformer SHALL interpolate surface normals at each barycentric point using the three vertex normals of the bound triangle, producing smooth garment surfaces without faceting artifacts
5. IF a garment vertex's bound triangle becomes degenerate (collapsed to near-zero area due to extreme body deformation), THEN THE Garment_Deformer SHALL fall back to nearest-vertex position plus Normal_Offset along that vertex's normal
6. FOR ALL body shapes within the SMPL beta range of [-3, 3] per component, THE Garment_Deformer SHALL produce garment meshes with zero interpenetration with the body mesh (garment vertices remain outside the body surface)

### Requirement 7: Garment Material and Rendering

**User Story:** As a user, I want garments to look like realistic fabric on my body avatar, so that the visualization feels trustworthy and professional.

#### Acceptance Criteria

1. THE Garment_Material SHALL use Three.js MeshPhysicalMaterial with configurable properties per garment type: base color, roughness (0.6–0.95), metalness (0.0), opacity (0.75–1.0), and optional normal map for fabric texture detail
2. WHEN a garment type is T-Shirt or Oxford Shirt, THE Garment_Material SHALL apply a cotton-like appearance with roughness 0.8, slight sheen (0.05–0.15), and a light fabric normal map
3. WHEN a garment type is Slim Jeans or Straight Jeans, THE Garment_Material SHALL apply a denim-like appearance with roughness 0.9, no sheen, and a denim weave normal map
4. THE Garment_Material SHALL render with double-sided faces and depth write enabled (unlike the current POC semi-transparent approach) for opaque, production-quality appearance
5. WHILE the heatmap is enabled, THE Garment_Material SHALL blend vertex colors (fit heatmap) with the base fabric appearance using a configurable blend factor (default 0.7 heatmap, 0.3 fabric)
6. WHEN the heatmap is disabled, THE Garment_Material SHALL display the full fabric appearance without vertex color influence

### Requirement 8: Heatmap Adaptation for SMPL Body

**User Story:** As a user, I want the fit heatmap to work correctly on the SMPL body mesh, so that I can see where clothing fits tight or loose regardless of which body engine is active.

#### Acceptance Criteria

1. WHEN the SMPL engine is active, THE Heatmap_Engine SHALL compute garment coverage using SMPL vertex landmark positions instead of normalized height heuristics, mapping each vertex to the nearest anatomical region via the vertex landmark map
2. THE Heatmap_Engine SHALL compute fit scores using the same algorithm (ease = garment measurement - body measurement, scored against ease targets per fit preference) regardless of which Body_Engine is active
3. WHEN heatmap colors are applied to the SMPL body mesh, THE Heatmap_Engine SHALL use vertex colors on the SMPL BufferGeometry with Laplacian smoothing (2 passes, weight 0.5) consistent with the current smoothing approach
4. WHILE a Garment_Shell is loaded and heatmap is enabled, THE Heatmap_Engine SHALL apply heatmap colors to the garment mesh vertices instead of the body mesh, using the garment vertex positions to determine anatomical region membership
5. THE Heatmap_Engine SHALL support the existing arm detection logic (armScore = normalXAbs + xAbs * 3) adapted to use SMPL vertex normals for sleeve cutoff on T-Shirts

### Requirement 9: Garment Binding Map Serialization

**User Story:** As a developer, I want binding maps to be serializable and deserializable, so that they can be stored as files and loaded efficiently at runtime.

#### Acceptance Criteria

1. THE Binding_Map serializer SHALL write binding data as a compact binary format (ArrayBuffer) with a header containing vertex count and format version, followed by per-vertex records of (faceIndex: uint32, baryU: float32, baryV: float32, baryW: float32, normalOffset: float32)
2. THE Binding_Map deserializer SHALL parse the binary format back into a typed array structure usable by the Garment_Deformer
3. FOR ALL valid Binding_Map objects, serializing to binary and then deserializing SHALL produce a Binding_Map with identical values (round-trip property)
4. THE Binding_Map binary format SHALL include a magic number header (4 bytes) and version field (uint16) to detect format mismatches and enable future format evolution
5. IF a Binding_Map file has an unrecognized magic number or version, THEN THE deserializer SHALL reject the file with a descriptive error message

### Requirement 10: Garment Registry and Asset Loading

**User Story:** As a developer, I want a registry of available garment templates, so that the UI can enumerate garment options and the loader knows which assets to fetch.

#### Acceptance Criteria

1. THE Garment_Registry SHALL define a JSON configuration listing all available Garment_Templates with fields: garment type, display label, available sizes, GLB file path, and Binding_Map file path per size
2. WHEN the application initializes, THE Garment_Registry SHALL load the registry configuration and expose a list of available garment types and sizes to the UI
3. WHEN the user selects a garment type and size, THE Garment_Registry SHALL provide the correct GLB and Binding_Map file paths to the Garment_Deformer for loading
4. IF a garment GLB or Binding_Map file fails to load, THEN THE Garment_Registry SHALL mark that garment-size combination as unavailable and log a warning without crashing the application
5. THE Garment_Registry SHALL support adding new garment types by adding entries to the configuration file without modifying application code

### Requirement 11: Transition and Backward Compatibility

**User Story:** As a user, I want the application to continue working during the transition from MakeHuman to SMPL, so that existing functionality is not broken while the new system is being built.

#### Acceptance Criteria

1. WHILE the SMPL assets are not yet available, THE Body_Engine SHALL default to the MakeHuman morph target system with no changes to existing behavior
2. THE application SHALL support a runtime configuration flag (e.g., `bodyEngine: 'smpl' | 'makehuman'`) that selects the active Body_Engine without requiring a code change
3. WHEN switching from MakeHuman to SMPL engine, THE application SHALL preserve the user's current input values (height, weight, age, gender, custom measurements) and recompute the body mesh using the new engine
4. THE existing heatmap, fit advisor, size chart, and control panel components SHALL function correctly with both Body_Engine implementations without modification to those components
5. WHEN the SMPL engine is active, THE application SHALL hide morph target override sliders (which are MakeHuman-specific) and display SMPL beta parameter controls instead
6. IF the user has the garment shell enabled and switches body engines, THEN THE application SHALL reload garment assets compatible with the active engine (SMPL-bound garments for SMPL, morph-target garments for MakeHuman)

### Requirement 12: Body Composition Input

**User Story:** As a user, I want to specify my body composition (e.g., athletic, average, heavy/soft) in addition to height and weight, so that the system can distinguish between a muscular 90kg person and a soft 90kg person and produce a more accurate body shape.

#### Acceptance Criteria

1. THE ControlPanel SHALL display a body composition selector with at least three options: Athletic (muscular, low body fat), Average (moderate muscle and fat), and Heavy/Soft (higher body fat, less muscle definition)
2. WHEN the user selects a body composition, THE bodyStore SHALL store the selected value as a `bodyComposition` field on the UserInputs type
3. THE SMPL_Regressor SHALL accept a `bodyComposition` field in its RegressorInputs and use it as an additional input signal when computing SMPL_Beta parameters, biasing shape coefficients toward muscular or soft body shapes accordingly
4. WHEN two users have identical height, weight, age, and gender but different body compositions (e.g., Athletic vs Heavy/Soft), THE SMPL_Regressor SHALL produce different SMPL_Beta vectors that result in visibly different body meshes — the Athletic body SHALL have wider shoulders relative to waist and more defined limbs, while the Heavy/Soft body SHALL have a larger waist-to-shoulder ratio and softer limb contours
5. THE body composition selector SHALL default to "Average" and SHALL NOT require the user to make a selection (the system works without it, but benefits from the additional signal)
6. WHEN the SMPL engine is not active (MakeHuman-only mode), THE body composition selector SHALL still be visible and its value SHALL map to the existing `bodyType` morph modifiers in morphMapper.ts, providing a similar (though less precise) effect via the existing morph target system
7. THE body composition value SHALL be preserved when switching between SMPL and MakeHuman body engines
