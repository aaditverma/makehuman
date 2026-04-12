# Requirements Document

## Introduction

The heatmap system currently assigns vertex colors based on per-vertex fit scores from `getVertexFit()`. Because fit scores change discretely at region boundaries (e.g., chest → waist), the resulting heatmap can show abrupt color transitions even though the mesh has 214k vertices. This feature adds a spatial smoothing pass that averages each vertex's color with its mesh neighbors, producing cleaner gradients across region boundaries while preserving the overall fit signal.

## Glossary

- **Smoothing_Engine**: The module responsible for building the vertex adjacency structure and performing spatial color smoothing on the heatmap vertex color buffer.
- **Adjacency_Map**: A data structure that maps each vertex index to the set of vertex indices that share a mesh edge with it, derived from the mesh's index buffer.
- **Vertex_Color_Buffer**: The `Float32Array` of RGB triplets (length = vertexCount × 3) that stores per-vertex heatmap colors before they are applied to the geometry.
- **Smoothing_Pass**: A single iteration of replacing each vertex's color with a weighted blend of its own color and the average color of its neighbors.
- **Smoothing_Iterations**: The number of consecutive smoothing passes applied to the vertex color buffer.
- **Smoothing_Weight**: A value between 0 and 1 that controls how much of the neighbor average is blended into each vertex's color per pass (0 = no smoothing, 1 = full neighbor average).
- **Covered_Vertex**: A vertex whose heatmap result has `covered: true` and `edgeFade > 0.01`, meaning it is inside the garment boundary.
- **Uncovered_Vertex**: A vertex whose heatmap result has `covered: false` or `edgeFade <= 0.01`, rendered as white (1, 1, 1).

## Requirements

### Requirement 1: Build Vertex Adjacency Map from Mesh Index Data

**User Story:** As a developer, I want to compute a vertex adjacency map from the mesh's face/index data, so that the smoothing pass knows which vertices are spatial neighbors.

#### Acceptance Criteria

1. WHEN the mesh geometry contains an index buffer, THE Smoothing_Engine SHALL build an Adjacency_Map where each vertex maps to all vertices that share at least one triangle edge with it.
2. WHEN two vertices share a triangle edge, THE Smoothing_Engine SHALL include each vertex in the other's neighbor set (the adjacency relationship is symmetric).
3. THE Smoothing_Engine SHALL build the Adjacency_Map once per mesh and cache it for reuse across heatmap updates.
4. IF the mesh geometry does not contain an index buffer, THEN THE Smoothing_Engine SHALL skip smoothing and return the original vertex color buffer unchanged.

### Requirement 2: Apply Spatial Smoothing to Heatmap Vertex Colors

**User Story:** As a user, I want the heatmap colors to transition smoothly across region boundaries, so that the fit visualization looks clean and professional on the 3D body model.

#### Acceptance Criteria

1. WHEN heatmap vertex colors have been computed, THE Smoothing_Engine SHALL perform Smoothing_Iterations passes over the Vertex_Color_Buffer, where each pass replaces each Covered_Vertex's color with a weighted blend of its current color and the average color of its covered neighbors.
2. THE Smoothing_Engine SHALL use the formula: `newColor = (1 - Smoothing_Weight) × currentColor + Smoothing_Weight × averageNeighborColor` for each smoothing pass.
3. WHILE computing the neighbor average for a Covered_Vertex, THE Smoothing_Engine SHALL only include neighbors that are also Covered_Vertices (neighbors that are Uncovered_Vertices are excluded from the average).
4. IF a Covered_Vertex has zero covered neighbors, THEN THE Smoothing_Engine SHALL retain that vertex's original color unchanged.
5. THE Smoothing_Engine SHALL not modify the color of any Uncovered_Vertex (uncovered vertices remain white).
6. THE Smoothing_Engine SHALL default to 2 smoothing iterations and a smoothing weight of 0.5.
7. FOR ALL valid Vertex_Color_Buffers, applying zero smoothing iterations SHALL return a buffer identical to the input buffer (identity property).

### Requirement 3: Preserve Garment Boundary Sharpness

**User Story:** As a user, I want the garment edges (hem, neckline, sleeve ends) to remain visually crisp after smoothing, so that the garment shape is still clearly visible on the body.

#### Acceptance Criteria

1. THE Smoothing_Engine SHALL not blend colors across the covered/uncovered boundary (a Covered_Vertex's smoothing average excludes Uncovered_Vertices, and Uncovered_Vertices are never modified).
2. WHEN a Covered_Vertex has edge fade applied (edgeFade < 1.0), THE Smoothing_Engine SHALL smooth the already-faded color values, preserving the edge fade gradient.

### Requirement 4: Integrate Smoothing into the Heatmap Rendering Pipeline

**User Story:** As a developer, I want the smoothing pass to be called automatically after vertex color computation in BodyModel.tsx, so that smoothing is applied without manual intervention.

#### Acceptance Criteria

1. WHEN the heatmap useEffect in BodyModel.tsx computes the Vertex_Color_Buffer, THE BodyModel SHALL invoke the Smoothing_Engine to smooth the buffer before applying it to the geometry via `setAttribute('color', ...)`.
2. THE BodyModel SHALL pass the Adjacency_Map and a coverage mask (boolean per vertex indicating covered status) to the Smoothing_Engine along with the Vertex_Color_Buffer.
3. WHEN heatmap is disabled or garment type is 'none', THE BodyModel SHALL skip the smoothing step entirely.

### Requirement 5: Smoothing Performance on 214k Vertex Mesh

**User Story:** As a user, I want the heatmap with smoothing to render without noticeable delay, so that changing garment or size feels responsive.

#### Acceptance Criteria

1. THE Smoothing_Engine SHALL complete 2 smoothing passes on a 214k-vertex mesh in under 50 milliseconds on a modern desktop browser.
2. THE Smoothing_Engine SHALL operate in-place or use a double-buffer strategy to avoid excessive memory allocation during smoothing passes.
