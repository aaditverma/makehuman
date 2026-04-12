# Implementation Plan: Heatmap Color Smoothing

## Overview

Implement a Laplacian smoothing post-processing pass for heatmap vertex colors. The smoothing engine is a pure utility module operating on typed arrays, integrated into BodyModel.tsx's existing heatmap pipeline. The adjacency map is built once from the mesh index buffer and cached; smoothing runs after per-vertex color computation and before `setAttribute('color', ...)`.

## Tasks

- [x] 1. Create smoothing engine module with core functions
  - [x] 1.1 Implement `buildAdjacency()` in `src/utils/smoothingEngine.ts`
    - Create the new file with `AdjacencyMap` type, `SmoothingOptions` interface, and `buildAdjacency()` function
    - Iterate triangle index buffer in steps of 3, adding symmetric edges (i0↔i1, i1↔i2, i2↔i0)
    - Deduplicate neighbor lists using `Set` then convert to `Uint32Array`
    - Add defensive bounds check: ignore indices ≥ vertexCount
    - Return empty adjacency map for empty index buffer
    - _Requirements: 1.1, 1.2, 1.4_

  - [ ]* 1.2 Write property test: Adjacency completeness (Property 1)
    - **Property 1: Adjacency completeness**
    - Generate random triangle index buffers (valid indices, length divisible by 3) and vertex counts
    - Assert: for every triangle (i0, i1, i2), each vertex appears in its edge-partner's neighbor array
    - **Validates: Requirements 1.1**

  - [ ]* 1.3 Write property test: Adjacency symmetry (Property 2)
    - **Property 2: Adjacency symmetry**
    - Generate random triangle index buffers and vertex counts
    - Assert: for all (a, b), if a ∈ adjacency[b] then b ∈ adjacency[a]
    - **Validates: Requirements 1.2**

  - [x] 1.4 Implement `smoothColors()` in `src/utils/smoothingEngine.ts`
    - Implement Laplacian smoothing with double-buffer strategy (two Float32Arrays, swap between passes)
    - For each pass: iterate covered vertices, compute average of covered neighbors' colors, blend with weight
    - Formula: `newColor = (1 - weight) × currentColor + weight × averageNeighborColor`
    - Skip uncovered vertices (copy unchanged)
    - Retain color for covered vertices with zero covered neighbors
    - Clamp iterations ≥ 0 and weight to [0, 1]
    - Validate buffer lengths; return input copy on mismatch
    - Default options: iterations = 2, weight = 0.5
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 5.2_

  - [ ]* 1.5 Write property test: Single-pass smoothing formula (Property 3)
    - **Property 3: Single-pass smoothing formula**
    - Generate random color buffers, coverage masks, and adjacency maps
    - Run smoothColors with iterations=1 and random weight
    - Assert: each covered vertex's output matches `(1-w)×input + w×mean(coveredNeighborColors)`; zero-covered-neighbor vertices unchanged
    - **Validates: Requirements 2.1, 2.2, 2.4**

  - [ ]* 1.6 Write property test: Boundary preservation (Property 4)
    - **Property 4: Boundary preservation**
    - Generate random color buffers, coverage masks, adjacency maps, and iteration counts
    - Assert: uncovered vertices' colors are identical in input and output
    - Assert: covered vertices' smoothed values were computed only from covered neighbors
    - **Validates: Requirements 2.3, 2.5, 3.1**

  - [ ]* 1.7 Write property test: Zero-iteration identity (Property 5)
    - **Property 5: Zero-iteration identity**
    - Generate random color buffers and coverage masks
    - Run smoothColors with iterations=0
    - Assert: output buffer contents are identical to input buffer
    - **Validates: Requirements 2.7**

  - [ ]* 1.8 Write unit tests for smoothing engine
    - Test: no index buffer → `smoothColors` returns original colors unchanged (Req 1.4)
    - Test: default options are iterations=2, weight=0.5 (Req 2.6)
    - Test: single triangle mesh, all covered, 1 pass — verify exact numeric output (Req 2.1)
    - Test: isolated covered vertex with no covered neighbors retains its color (Req 2.4)
    - Test: edge-faded colors (values between heatmap color and white) are smoothed, not reset (Req 3.2)
    - _Requirements: 1.4, 2.1, 2.4, 2.6, 3.2_

- [x] 2. Checkpoint — Verify smoothing engine
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Integrate smoothing into BodyModel.tsx heatmap pipeline
  - [x] 3.1 Build coverage mask alongside vertex colors in heatmap useEffect
    - Add `const coverageMask: boolean[] = new Array(count)` in the per-vertex color loop
    - Set `coverageMask[i] = true` when `covered && edgeFade > 0.01`, else `false`
    - _Requirements: 4.2_

  - [x] 3.2 Add adjacency caching via useRef and call smoothColors before setAttribute
    - Import `buildAdjacency`, `smoothColors`, and `AdjacencyMap` from `smoothingEngine`
    - Add `const adjacencyRef = useRef<AdjacencyMap | null>(null)` to BodyModel
    - In heatmap useEffect, after color loop: build adjacency from `geometry.index.array` on first render (cache in ref)
    - If geometry has no index buffer, skip smoothing
    - Call `smoothColors(colors, coverageMask, adjacencyRef.current, { iterations: 2, weight: 0.5 })`
    - Apply the returned smoothed buffer to `geometry.setAttribute('color', ...)`
    - Ensure smoothing is skipped when `!heatmapEnabled || garmentType === 'none'`
    - _Requirements: 1.3, 4.1, 4.2, 4.3_

  - [ ]* 3.3 Write integration tests for BodyModel smoothing integration
    - Test: adjacency is cached across heatmap re-renders (useRef reuse) (Req 1.3)
    - Test: smoothColors is called before setAttribute (Req 4.1)
    - Test: correct arguments passed to smoothColors (colors, mask, adjacency) (Req 4.2)
    - Test: smoothing skipped when heatmap disabled or garment is 'none' (Req 4.3)
    - _Requirements: 1.3, 4.1, 4.2, 4.3_

- [x] 4. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate the 5 correctness properties from the design document
- The smoothing engine is a pure module with no React/Three.js dependencies, making it straightforward to test
- TypeScript is used throughout, matching the existing codebase
- Test infrastructure (Vitest + fast-check) is already set up
