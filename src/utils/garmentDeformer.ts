/**
 * garmentDeformer.ts — Runtime Garment Deformation
 *
 * Deforms garment template meshes to fit the current SMPL body shape
 * using precomputed barycentric binding maps.
 *
 * Performance target: <16ms for a 10k-vertex garment (zero-allocation inner loop).
 */

import type { BindingMap } from './bindingMapCodec';

/** Result of binding map validation */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  vertexIndex: number;
  reason: 'degenerate_triangle' | 'invalid_barycentric' | 'out_of_bounds_face';
  detail: string;
}

/**
 * Compute per-vertex normals for an SMPL mesh from face normals.
 *
 * For each face, computes the face normal (cross product of two edges),
 * then accumulates it onto each of the face's three vertices.
 * Finally normalizes each vertex normal to unit length.
 *
 * Writes to outputNormals in place (zero-allocation).
 *
 * @param vertices  - Vertex positions (vertexCount × 3 floats)
 * @param faces     - Triangle face indices (faceCount × 3)
 * @param outputNormals - Pre-allocated Float32Array (vertexCount × 3), written in place
 */
export function computeSmplNormals(
  vertices: Float32Array,
  faces: Uint16Array,
  outputNormals: Float32Array,
): void {
  // Zero out normals
  outputNormals.fill(0);

  const faceCount = faces.length / 3;

  for (let f = 0; f < faceCount; f++) {
    const fi = f * 3;
    const i0 = faces[fi];
    const i1 = faces[fi + 1];
    const i2 = faces[fi + 2];

    const i0x3 = i0 * 3;
    const i1x3 = i1 * 3;
    const i2x3 = i2 * 3;

    // Edge vectors
    const e1x = vertices[i1x3] - vertices[i0x3];
    const e1y = vertices[i1x3 + 1] - vertices[i0x3 + 1];
    const e1z = vertices[i1x3 + 2] - vertices[i0x3 + 2];

    const e2x = vertices[i2x3] - vertices[i0x3];
    const e2y = vertices[i2x3 + 1] - vertices[i0x3 + 1];
    const e2z = vertices[i2x3 + 2] - vertices[i0x3 + 2];

    // Cross product (face normal, not normalized — area-weighted)
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate onto each vertex of the face
    outputNormals[i0x3] += nx;
    outputNormals[i0x3 + 1] += ny;
    outputNormals[i0x3 + 2] += nz;

    outputNormals[i1x3] += nx;
    outputNormals[i1x3 + 1] += ny;
    outputNormals[i1x3 + 2] += nz;

    outputNormals[i2x3] += nx;
    outputNormals[i2x3 + 1] += ny;
    outputNormals[i2x3 + 2] += nz;
  }

  // Normalize each vertex normal to unit length
  const vertexCount = outputNormals.length / 3;
  for (let v = 0; v < vertexCount; v++) {
    const vx3 = v * 3;
    const x = outputNormals[vx3];
    const y = outputNormals[vx3 + 1];
    const z = outputNormals[vx3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-10) {
      const invLen = 1.0 / len;
      outputNormals[vx3] = x * invLen;
      outputNormals[vx3 + 1] = y * invLen;
      outputNormals[vx3 + 2] = z * invLen;
    }
    // If len ≈ 0, leave as zero (degenerate vertex)
  }
}

/**
 * Deform garment vertices based on current SMPL body mesh.
 *
 * For each garment vertex:
 *   1. Look up bound SMPL triangle from binding map
 *   2. Interpolate position using barycentric coords on current SMPL verts
 *   3. Interpolate normal from triangle vertex normals
 *   4. Offset along interpolated normal by normalOffset
 *   5. Write to output buffer
 *
 * Handles degenerate triangles by falling back to nearest vertex
 * (the vertex with the largest barycentric weight).
 *
 * Writes to outputPositions in place (zero-allocation).
 *
 * @param bindingMap      - Precomputed garment-to-SMPL binding
 * @param smplVertices    - Current SMPL vertex positions (6890 × 3)
 * @param smplNormals     - Current SMPL vertex normals (6890 × 3)
 * @param smplFaces       - SMPL face indices (13776 × 3)
 * @param outputPositions - Garment vertex positions (written in place)
 */
export function deformGarment(
  bindingMap: BindingMap,
  smplVertices: Float32Array,
  smplNormals: Float32Array,
  smplFaces: Uint16Array,
  outputPositions: Float32Array,
): void {
  const entries = bindingMap.entries;
  const count = bindingMap.vertexCount;
  const faceCount = smplFaces.length / 3;

  for (let i = 0; i < count; i++) {
    const entry = entries[i];
    const { faceIndex, baryU, baryV, baryW, normalOffset } = entry;
    const outIdx = i * 3;

    // Out-of-bounds face index: skip (retain whatever was in output)
    if (faceIndex >= faceCount) {
      continue;
    }

    const fi = faceIndex * 3;
    const vi0 = smplFaces[fi];
    const vi1 = smplFaces[fi + 1];
    const vi2 = smplFaces[fi + 2];

    const v0x3 = vi0 * 3;
    const v1x3 = vi1 * 3;
    const v2x3 = vi2 * 3;

    // Check for degenerate triangle (near-zero area)
    const e1x = smplVertices[v1x3] - smplVertices[v0x3];
    const e1y = smplVertices[v1x3 + 1] - smplVertices[v0x3 + 1];
    const e1z = smplVertices[v1x3 + 2] - smplVertices[v0x3 + 2];
    const e2x = smplVertices[v2x3] - smplVertices[v0x3];
    const e2y = smplVertices[v2x3 + 1] - smplVertices[v0x3 + 1];
    const e2z = smplVertices[v2x3 + 2] - smplVertices[v0x3 + 2];

    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const areaSquared = cx * cx + cy * cy + cz * cz;

    // Degenerate threshold: area < 0.0001 m² → area² < 1e-8 * 4 ≈ 4e-8
    // area = 0.5 * |cross|, so area² = 0.25 * |cross|², threshold: 0.25 * |cross|² < (0.0001)² → |cross|² < 4e-8
    const DEGENERATE_AREA_SQ_THRESHOLD = 4e-8;

    if (areaSquared < DEGENERATE_AREA_SQ_THRESHOLD) {
      // Fallback: use nearest vertex (largest barycentric weight)
      let nearestVx3: number;
      if (baryU >= baryV && baryU >= baryW) {
        nearestVx3 = v0x3;
      } else if (baryV >= baryW) {
        nearestVx3 = v1x3;
      } else {
        nearestVx3 = v2x3;
      }

      // Position = nearest vertex + normalOffset * vertex normal
      const nx = smplNormals[nearestVx3];
      const ny = smplNormals[nearestVx3 + 1];
      const nz = smplNormals[nearestVx3 + 2];

      outputPositions[outIdx] = smplVertices[nearestVx3] + normalOffset * nx;
      outputPositions[outIdx + 1] = smplVertices[nearestVx3 + 1] + normalOffset * ny;
      outputPositions[outIdx + 2] = smplVertices[nearestVx3 + 2] + normalOffset * nz;
      continue;
    }

    // Barycentric interpolation of position
    // P = u * V0 + v * V1 + w * V2
    const px = baryU * smplVertices[v0x3] + baryV * smplVertices[v1x3] + baryW * smplVertices[v2x3];
    const py = baryU * smplVertices[v0x3 + 1] + baryV * smplVertices[v1x3 + 1] + baryW * smplVertices[v2x3 + 1];
    const pz = baryU * smplVertices[v0x3 + 2] + baryV * smplVertices[v1x3 + 2] + baryW * smplVertices[v2x3 + 2];

    // Barycentric interpolation of normal
    // N = u * N0 + v * N1 + w * N2 (then normalize)
    let inx = baryU * smplNormals[v0x3] + baryV * smplNormals[v1x3] + baryW * smplNormals[v2x3];
    let iny = baryU * smplNormals[v0x3 + 1] + baryV * smplNormals[v1x3 + 1] + baryW * smplNormals[v2x3 + 1];
    let inz = baryU * smplNormals[v0x3 + 2] + baryV * smplNormals[v1x3 + 2] + baryW * smplNormals[v2x3 + 2];

    const nLen = Math.sqrt(inx * inx + iny * iny + inz * inz);
    if (nLen > 1e-10) {
      const invNLen = 1.0 / nLen;
      inx *= invNLen;
      iny *= invNLen;
      inz *= invNLen;
    }

    // Final position = interpolated position + normalOffset * interpolated normal
    outputPositions[outIdx] = px + normalOffset * inx;
    outputPositions[outIdx + 1] = py + normalOffset * iny;
    outputPositions[outIdx + 2] = pz + normalOffset * inz;
  }
}

/**
 * Validate a binding map against SMPL mesh data.
 *
 * Checks for:
 * - Degenerate triangles (area < 0.0001 m²)
 * - Invalid barycentric coords (u+v+w deviates from 1.0 by more than 0.001, or any component < 0)
 * - Out-of-bounds face indices
 *
 * @param bindingMap   - The binding map to validate
 * @param smplVertices - SMPL vertex positions (6890 × 3)
 * @param smplFaces    - SMPL face indices (13776 × 3)
 * @returns Validation result with list of errors
 */
export function validateBindingMap(
  bindingMap: BindingMap,
  smplVertices: Float32Array,
  smplFaces: Uint16Array,
): ValidationResult {
  const errors: ValidationError[] = [];
  const faceCount = smplFaces.length / 3;

  for (let i = 0; i < bindingMap.vertexCount; i++) {
    const entry = bindingMap.entries[i];
    const { faceIndex, baryU, baryV, baryW } = entry;

    // Check out-of-bounds face index
    if (faceIndex >= faceCount) {
      errors.push({
        vertexIndex: i,
        reason: 'out_of_bounds_face',
        detail: `Face index ${faceIndex} exceeds face count ${faceCount}`,
      });
      continue; // Can't check triangle area if face is out of bounds
    }

    // Check invalid barycentric coords
    const barySum = baryU + baryV + baryW;
    if (baryU < 0 || baryV < 0 || baryW < 0) {
      errors.push({
        vertexIndex: i,
        reason: 'invalid_barycentric',
        detail: `Negative barycentric coord: u=${baryU}, v=${baryV}, w=${baryW}`,
      });
    } else if (Math.abs(barySum - 1.0) > 0.001) {
      errors.push({
        vertexIndex: i,
        reason: 'invalid_barycentric',
        detail: `Barycentric sum ${barySum} deviates from 1.0 by ${Math.abs(barySum - 1.0).toFixed(6)}`,
      });
    }

    // Check degenerate triangle
    const fi = faceIndex * 3;
    const vi0 = smplFaces[fi];
    const vi1 = smplFaces[fi + 1];
    const vi2 = smplFaces[fi + 2];

    const v0x3 = vi0 * 3;
    const v1x3 = vi1 * 3;
    const v2x3 = vi2 * 3;

    const e1x = smplVertices[v1x3] - smplVertices[v0x3];
    const e1y = smplVertices[v1x3 + 1] - smplVertices[v0x3 + 1];
    const e1z = smplVertices[v1x3 + 2] - smplVertices[v0x3 + 2];
    const e2x = smplVertices[v2x3] - smplVertices[v0x3];
    const e2y = smplVertices[v2x3 + 1] - smplVertices[v0x3 + 1];
    const e2z = smplVertices[v2x3 + 2] - smplVertices[v0x3 + 2];

    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    // area = 0.5 * |cross|
    const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);

    if (area < 0.0001) {
      errors.push({
        vertexIndex: i,
        reason: 'degenerate_triangle',
        detail: `Triangle area ${area.toExponential(4)} < 0.0001 m²`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
