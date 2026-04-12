/**
 * Smoothing engine for heatmap vertex colors.
 * Pure utility module — no React or Three.js dependencies.
 * Operates on raw typed arrays for cache-friendly performance.
 */

/**
 * Adjacency map: vertex index → array of neighbor vertex indices.
 * Stored as a flat structure for cache-friendly iteration.
 */
export type AdjacencyMap = Uint32Array[];

/**
 * Options for the smoothing pass.
 */
export interface SmoothingOptions {
  iterations: number; // default: 2
  weight: number; // default: 0.5, range [0, 1]
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
): AdjacencyMap {
  // Collect neighbors in Sets for automatic deduplication
  const neighborSets: Set<number>[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    neighborSets[i] = new Set();
  }

  // Walk the index buffer in steps of 3 (one triangle per step)
  for (let t = 0; t + 2 < indexBuffer.length; t += 3) {
    const i0 = indexBuffer[t];
    const i1 = indexBuffer[t + 1];
    const i2 = indexBuffer[t + 2];

    // Defensive bounds check: ignore indices ≥ vertexCount
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
      continue;
    }

    // Add symmetric edges: i0↔i1, i1↔i2, i2↔i0
    neighborSets[i0].add(i1);
    neighborSets[i0].add(i2);

    neighborSets[i1].add(i0);
    neighborSets[i1].add(i2);

    neighborSets[i2].add(i0);
    neighborSets[i2].add(i1);
  }

  // Convert Sets to Uint32Arrays for cache-friendly iteration
  const adjacency: AdjacencyMap = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    adjacency[i] = new Uint32Array(neighborSets[i]);
  }

  return adjacency;
}

/**
 * Apply Laplacian smoothing to a vertex color buffer.
 * Only covered vertices participate in smoothing; uncovered vertices are untouched.
 * Each covered vertex's neighbor average only includes covered neighbors.
 *
 * Uses a double-buffer strategy: two Float32Arrays are allocated once and swapped
 * between passes to avoid per-pass allocation.
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
): Float32Array {
  const iterations = Math.max(0, options?.iterations ?? 2);
  const weight = Math.min(1, Math.max(0, options?.weight ?? 0.5));

  const vertexCount = adjacency.length;

  // Validate buffer lengths; return input copy on mismatch
  if (
    colors.length !== vertexCount * 3 ||
    coverageMask.length !== vertexCount
  ) {
    return new Float32Array(colors);
  }

  // Early exit: no work to do
  if (iterations === 0 || weight === 0) {
    return new Float32Array(colors);
  }

  // Double-buffer strategy: allocate two buffers, swap between passes
  let src = new Float32Array(colors);
  let dst = new Float32Array(colors.length);

  for (let iter = 0; iter < iterations; iter++) {
    for (let v = 0; v < vertexCount; v++) {
      const base = v * 3;

      // Uncovered vertices: copy unchanged
      if (!coverageMask[v]) {
        dst[base] = src[base];
        dst[base + 1] = src[base + 1];
        dst[base + 2] = src[base + 2];
        continue;
      }

      // Covered vertex: compute average of covered neighbors' colors
      const neighbors = adjacency[v];
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let coveredCount = 0;

      for (let n = 0; n < neighbors.length; n++) {
        const ni = neighbors[n];
        if (coverageMask[ni]) {
          const nb = ni * 3;
          sumR += src[nb];
          sumG += src[nb + 1];
          sumB += src[nb + 2];
          coveredCount++;
        }
      }

      // Zero covered neighbors: retain current color
      if (coveredCount === 0) {
        dst[base] = src[base];
        dst[base + 1] = src[base + 1];
        dst[base + 2] = src[base + 2];
        continue;
      }

      // Blend: newColor = (1 - weight) × currentColor + weight × averageNeighborColor
      const invWeight = 1 - weight;
      const avgR = sumR / coveredCount;
      const avgG = sumG / coveredCount;
      const avgB = sumB / coveredCount;

      dst[base] = invWeight * src[base] + weight * avgR;
      dst[base + 1] = invWeight * src[base + 1] + weight * avgG;
      dst[base + 2] = invWeight * src[base + 2] + weight * avgB;
    }

    // Swap buffers for next pass
    const tmp = src;
    src = dst;
    dst = tmp;
  }

  // After all passes, result is in `src` (due to the final swap)
  return src;
}
