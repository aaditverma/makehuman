# Design Document: Heatmap Color Smoothing

## Overview

The heatmap system in BodyModel.tsx assigns per-vertex colors based on fit scores from `getVertexFit()`. Because fit scores are computed from discrete body measurement regions (chest, waist, hip, etc.) with Gaussian blending, color transitions at region boundaries can appear abrupt — especially where two regions with different fit scores meet.

This feature introduces a post-processing smoothing pass using **Laplacian smoothing** on the vertex color buffer. The smoothing engine:

1. Builds a vertex adjacency map from the mesh's triangle index buffer (cached per mesh)
2. Iteratively blends each covered vertex's color with the average of its covered neighbors
3. Respects the covered/uncovered boundary so garment edges stay crisp

The smoothing is applied after `computeHeatmap()` + the per-vertex color loop, and before `geometry.setAttribute('color', ...)` in BodyModel.tsx.

**Key parameters:** 2 iterations, weight 0.5 (configurable).

## Architecture

```mermaid
flowchart TD
    A[BodyModel.tsx heatmap useEffect] --> B[computeHeatmap → HeatmapResult]
    B --> C[Per-vertex color loop → Float32Array colors + boolean[] coverageMask]
    C --> D[smoothingEngine.buildAdjacency → cached AdjacencyMap]
    D --> E[smoothingEngine.smoothColors → smoothed Float32Array]
    E --> F[geometry.setAttribute 'color', smoothedColors]
```

The smoothing engine is a **pure utility module** (`src/utils/smoothingEngine.ts`) with no React or Three.js dependencies. It operates on raw typed arrays:

- **Input:** `Float32Array` (RGB×vertexCount), `boolean[]` (coverage mask), `Uint32Array` (index buffer)
- **Output:** `Float32Array` (smoothed RGB×vertexCount)

### Data Flow

1. **BodyModel.tsx** computes per-vertex colors and a coverage mask in the existing heatmap `useEffect`
2. **BodyModel.tsx** calls `buildAdjacency(indexBuffer)` once (cached via `useRef`)
3. **BodyModel.tsx** calls `smoothColors(colors, coverageMask, adjacency, { iterations: 2, weight: 0.5 })`
4. The smoothed buffer is applied to the geometry

### Caching Strategy

The adjacency map depends only on the mesh topology (index buffer), which never changes at runtime. It is built once on first heatmap render and stored in a `useRef`. Subsequent heatmap updates (garment/size/fit changes) reuse the cached adjacency.

## Components and Interfaces

### Module: `src/utils/smoothingEngine.ts`

```typescript
/**
 * Adjacency map: vertex index → array of neighbor vertex indices.
 * Stored as a flat structure for cache-friendly iteration.
 */
export type AdjacencyMap = Uint32Array[];

/**
 * Options for the smoothing pass.
 */
export interface SmoothingOptions {
  iterations: number;  // default: 2
  weight: number;      // default: 0.5, range [0, 1]
}

/**
 * Build an adjacency map from a mesh index buffer.
 * Each triangle (i0, i1, i2) contributes edges: i0↔i1, i1↔i2, i2↔i0.
 * The result maps each vertex to a deduplicated array of neighbor indices.
 *
 * @param indexBuffer - The mesh's triangle index buffer (length divisible by 3)
 * @param vertexCount - Total number of vertices in the mesh
 * @returns AdjacencyMap where adjacency[v] is the array of v's neighbors
 */
export function buildAdjacency(
  indexBuffer: Uint16Array | Uint32Array,
  vertexCount: number,
): AdjacencyMap;

/**
 * Apply Laplacian smoothing to a vertex color buffer.
 * Only covered vertices participate in smoothing; uncovered vertices are untouched.
 * Each covered vertex's neighbor average only includes covered neighbors.
 *
 * @param colors - RGB color buffer (Float32Array, length = vertexCount × 3)
 * @param coverageMask - Boolean per vertex: true = covered (participates in smoothing)
 * @param adjacency - Precomputed adjacency map from buildAdjacency()
 * @param options - Smoothing parameters (iterations, weight)
 * @returns New Float32Array with smoothed colors (input is not mutated)
 */
export function smoothColors(
  colors: Float32Array,
  coverageMask: boolean[],
  adjacency: AdjacencyMap,
  options?: Partial<SmoothingOptions>,
): Float32Array;
```

### Integration Point: `src/components/BodyModel.tsx`

Changes to the heatmap `useEffect`:

1. After the per-vertex color loop, build a `coverageMask: boolean[]` alongside the `colors` buffer
2. Call `buildAdjacency()` on first render (cache in `useRef`)
3. Call `smoothColors()` with the colors, mask, and cached adjacency
4. Apply the returned smoothed buffer to the geometry

New refs added:
```typescript
const adjacencyRef = useRef<AdjacencyMap | null>(null);
```

## Data Models

### AdjacencyMap

```
AdjacencyMap = Uint32Array[]
```

- Index: vertex index (0 to vertexCount-1)
- Value: `Uint32Array` of neighbor vertex indices (deduplicated, unordered)
- Memory: ~214k entries × ~6 neighbors average × 4 bytes ≈ ~5 MB
- Built once, cached for mesh lifetime

### Vertex Color Buffer

```
Float32Array, length = vertexCount × 3
```

- Layout: `[r0, g0, b0, r1, g1, b1, ...]`
- Values in range [0, 1]
- Covered vertices: heatmap colors (possibly edge-faded toward white)
- Uncovered vertices: white (1, 1, 1)

### Coverage Mask

```
boolean[], length = vertexCount
```

- `true` = vertex is covered by garment (covered && edgeFade > 0.01)
- `false` = vertex is uncovered (white)
- Used to prevent color bleed across garment boundaries

### Smoothing Double-Buffer

During each smoothing pass, a second `Float32Array` of the same size is used as the write target. The two buffers are swapped between passes to avoid allocating new arrays per pass. Only 2 buffers total are allocated regardless of iteration count.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Adjacency completeness

*For any* valid triangle index buffer and vertex count, the adjacency map built by `buildAdjacency` SHALL contain both vertices of every triangle edge — that is, for every triangle (i0, i1, i2), i1 must appear in adjacency[i0], i2 must appear in adjacency[i1], and i0 must appear in adjacency[i2] (and vice versa for each edge).

**Validates: Requirements 1.1**

### Property 2: Adjacency symmetry

*For any* adjacency map built by `buildAdjacency`, the neighbor relationship SHALL be symmetric: for all vertex pairs (a, b), if a appears in adjacency[b] then b must appear in adjacency[a].

**Validates: Requirements 1.2**

### Property 3: Single-pass smoothing formula

*For any* vertex color buffer, coverage mask, and adjacency map, after a single smoothing pass with weight `w`, each covered vertex's output color SHALL equal `(1 - w) × inputColor + w × mean(coveredNeighborColors)`. If a covered vertex has zero covered neighbors, its color SHALL be unchanged.

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 4: Boundary preservation

*For any* vertex color buffer, coverage mask, and adjacency map, after any number of smoothing passes: (a) every uncovered vertex's color in the output SHALL be identical to its color in the input, and (b) every covered vertex's smoothed color SHALL have been computed using only covered neighbors (uncovered neighbor colors never influence the result).

**Validates: Requirements 2.3, 2.5, 3.1**

### Property 5: Zero-iteration identity

*For any* valid vertex color buffer and coverage mask, applying `smoothColors` with `iterations = 0` SHALL return a buffer whose contents are identical to the input buffer.

**Validates: Requirements 2.7**

## Error Handling

| Scenario | Handling |
|---|---|
| No index buffer on geometry | `smoothColors` returns a copy of the input buffer unchanged (no adjacency → no smoothing) |
| Empty index buffer (length 0) | `buildAdjacency` returns an empty adjacency map; `smoothColors` returns input unchanged |
| Vertex index out of range in index buffer | `buildAdjacency` ignores indices ≥ vertexCount (defensive bounds check) |
| Color buffer length mismatch | `smoothColors` validates `colors.length === vertexCount × 3`; returns input copy if mismatched |
| Coverage mask length mismatch | `smoothColors` validates `coverageMask.length` matches vertex count; returns input copy if mismatched |
| iterations < 0 or weight outside [0,1] | Clamp to valid range: iterations = max(0, iterations), weight = clamp(0, 1, weight) |
| NaN/Infinity in color values | Treated as normal floats — no special handling (upstream responsibility) |

## Testing Strategy

### Property-Based Tests (fast-check + Vitest)

The smoothing engine is a set of pure functions operating on typed arrays — ideal for property-based testing. Each correctness property maps to a single `fc.assert(fc.property(...))` test.

**Library:** `fast-check` (already in devDependencies)
**Runner:** Vitest (`vitest --run`)
**Iterations:** Minimum 100 per property test
**Tag format:** `Feature: heatmap-color-smoothing, Property N: <title>`

**Generators needed:**
- Random triangle index buffers (valid indices within vertex count, length divisible by 3)
- Random vertex color buffers (Float32Array, values in [0, 1])
- Random coverage masks (boolean arrays)
- Random smoothing options (iterations 0–5, weight 0–1)

**Test file:** `src/utils/__tests__/smoothingEngine.test.ts`

### Unit Tests (example-based)

| Test | Validates |
|---|---|
| No index buffer → returns original colors | Req 1.4 |
| Default options are iterations=2, weight=0.5 | Req 2.6 |
| Edge-faded colors are smoothed (not reset) | Req 3.2 |
| Single triangle mesh, all covered, 1 pass — verify exact output | Req 2.1 |
| Isolated covered vertex (no covered neighbors) retains color | Req 2.4 |

### Integration Tests

| Test | Validates |
|---|---|
| Adjacency cached across heatmap re-renders (useRef) | Req 1.3 |
| Smoothing called before setAttribute in BodyModel | Req 4.1 |
| Correct arguments passed to smoothColors | Req 4.2 |
| Smoothing skipped when heatmap disabled | Req 4.3 |

### Performance Benchmark

| Test | Validates |
|---|---|
| 2 passes on 214k vertices completes in < 50ms | Req 5.1 |

Run as a separate benchmark (not in CI) using `performance.now()` timing.
