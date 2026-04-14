/**
 * Subdivision Mapper — loads a precomputed subdivision mapping and
 * interpolates base SMPL mesh vertices onto the subdivided mesh.
 *
 * Binary format for smpl_subdiv_map.bin:
 *   Header (16 bytes):
 *     magic:           uint32 — 0x53554244 ("SUBD")
 *     version:         uint16 — 1
 *     reserved:        uint16 — 0
 *     baseVertCount:   uint32 — 6890
 *     subdivVertCount: uint32 — ~165,000
 *
 *   Per-vertex data (subdivVertCount × 16 bytes):
 *     faceIdx:  uint32  — index into base mesh face array
 *     bary0:    float32 — barycentric weight for vertex 0 of face
 *     bary1:    float32 — barycentric weight for vertex 1 of face
 *     bary2:    float32 — barycentric weight for vertex 2 of face
 */

import { SMPL_VERTEX_COUNT, SMPL_FACE_COUNT } from './smplForwardPass';

/** Magic number: "SUBD" in little-endian ASCII */
export const SUBDIV_MAGIC = 0x53554244;
export const SUBDIV_HEADER_BYTES = 16;
export const SUBDIV_PER_VERTEX_BYTES = 16;

/** Subdivision mapping data loaded from binary asset */
export interface SubdivisionMap {
  baseVertCount: number;       // 6890
  subdivVertCount: number;     // ~165,000
  faceIndices: Uint32Array;    // [subdivVertCount] — which base face
  baryCoords: Float32Array;    // [subdivVertCount × 3] — barycentric weights
}

/**
 * Parse the subdivision mapping binary buffer.
 *
 * Validates the header magic, version, and base vertex count,
 * then reads per-vertex face indices and barycentric coordinates.
 */
export function parseSubdivisionMap(buffer: ArrayBuffer): SubdivisionMap {
  if (buffer.byteLength < SUBDIV_HEADER_BYTES) {
    throw new Error(
      `Invalid subdivision map: buffer too small for header (${buffer.byteLength} bytes, need ${SUBDIV_HEADER_BYTES})`,
    );
  }

  const view = new DataView(buffer);

  const magic = view.getUint32(0, true);
  if (magic !== SUBDIV_MAGIC) {
    throw new Error(
      `Invalid subdivision map: expected magic 0x${SUBDIV_MAGIC.toString(16).toUpperCase()}, ` +
      `got 0x${magic.toString(16).toUpperCase()}`,
    );
  }

  const version = view.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`Invalid subdivision map: unsupported version ${version}`);
  }

  // reserved uint16 at offset 6 — skip
  const baseVertCount = view.getUint32(8, true);
  const subdivVertCount = view.getUint32(12, true);

  if (baseVertCount !== SMPL_VERTEX_COUNT) {
    throw new Error(
      `Invalid subdivision map: expected ${SMPL_VERTEX_COUNT} base vertices, got ${baseVertCount}`,
    );
  }

  if (subdivVertCount === 0) {
    throw new Error('Invalid subdivision map: subdivVertCount is 0');
  }

  const expectedSize = SUBDIV_HEADER_BYTES + subdivVertCount * SUBDIV_PER_VERTEX_BYTES;
  if (buffer.byteLength < expectedSize) {
    throw new Error(
      `Invalid subdivision map: buffer too small (${buffer.byteLength} bytes, need ${expectedSize})`,
    );
  }

  // Read per-vertex data
  const faceIndices = new Uint32Array(subdivVertCount);
  const baryCoords = new Float32Array(subdivVertCount * 3);

  let offset = SUBDIV_HEADER_BYTES;
  for (let i = 0; i < subdivVertCount; i++) {
    faceIndices[i] = view.getUint32(offset, true);
    baryCoords[i * 3 + 0] = view.getFloat32(offset + 4, true);
    baryCoords[i * 3 + 1] = view.getFloat32(offset + 8, true);
    baryCoords[i * 3 + 2] = view.getFloat32(offset + 12, true);
    offset += SUBDIV_PER_VERTEX_BYTES;
  }

  return { baseVertCount, subdivVertCount, faceIndices, baryCoords };
}


/**
 * Interpolate base mesh vertices onto the subdivided mesh.
 *
 * For each subdivided vertex i:
 *   faceIdx = map.faceIndices[i]
 *   v0 = baseFaces[faceIdx * 3 + 0]
 *   v1 = baseFaces[faceIdx * 3 + 1]
 *   v2 = baseFaces[faceIdx * 3 + 2]
 *   bary0 = map.baryCoords[i * 3 + 0]
 *   bary1 = map.baryCoords[i * 3 + 1]
 *   bary2 = map.baryCoords[i * 3 + 2]
 *   output[i*3+k] = bary0 * baseVertices[v0*3+k]
 *                  + bary1 * baseVertices[v1*3+k]
 *                  + bary2 * baseVertices[v2*3+k]   for k = 0,1,2
 *
 * @param baseVertices - 6890×3 Float32Array from forward pass
 * @param baseFaces    - 13776×3 Uint16Array face indices
 * @param map          - Precomputed subdivision mapping
 * @param output       - Pre-allocated Float32Array of length subdivVertCount×3
 */
export function interpolateSubdivision(
  baseVertices: Float32Array,
  baseFaces: Uint16Array,
  map: SubdivisionMap,
  output: Float32Array,
): void {
  const { subdivVertCount, faceIndices, baryCoords } = map;

  for (let i = 0; i < subdivVertCount; i++) {
    const faceIdx = faceIndices[i];
    const v0 = baseFaces[faceIdx * 3 + 0];
    const v1 = baseFaces[faceIdx * 3 + 1];
    const v2 = baseFaces[faceIdx * 3 + 2];

    const b0 = baryCoords[i * 3 + 0];
    const b1 = baryCoords[i * 3 + 1];
    const b2 = baryCoords[i * 3 + 2];

    const oi = i * 3;
    output[oi + 0] = b0 * baseVertices[v0 * 3 + 0] + b1 * baseVertices[v1 * 3 + 0] + b2 * baseVertices[v2 * 3 + 0];
    output[oi + 1] = b0 * baseVertices[v0 * 3 + 1] + b1 * baseVertices[v1 * 3 + 1] + b2 * baseVertices[v2 * 3 + 1];
    output[oi + 2] = b0 * baseVertices[v0 * 3 + 2] + b1 * baseVertices[v1 * 3 + 2] + b2 * baseVertices[v2 * 3 + 2];
  }
}

/**
 * Load subdivision mapping from a URL.
 *
 * Returns null on failure (network error, parse error) and logs a warning.
 */
export async function loadSubdivisionMap(url: string): Promise<SubdivisionMap | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[SubdivisionMapper] Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return null;
    }
    const buffer = await response.arrayBuffer();
    return parseSubdivisionMap(buffer);
  } catch (err) {
    console.warn('[SubdivisionMapper] Failed to load subdivision map:', err);
    return null;
  }
}
